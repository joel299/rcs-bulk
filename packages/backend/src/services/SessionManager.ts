import { Page } from 'playwright'
import { db } from '../db/client'
import { browserPool } from './BrowserPool'
import { Selectors } from '../playwright/selectors'
import { randomDelay } from '../playwright/actions'

/** Headless para fila de envio (default true). false = janela visível para debug. */
function dispatchHeadless(): boolean {
  return process.env.PLAYWRIGHT_HEADLESS !== 'false'
}

/** Headless na tela de QR (default false — precisa escanear). */
function authHeadless(): boolean {
  return process.env.PLAYWRIGHT_AUTH_HEADLESS === 'true'
}

interface SessionState {
  page: Page | null
  status: 'pending_auth' | 'authenticated' | 'disconnected'
  keepaliveInterval: NodeJS.Timeout | null
}

class SessionManager {
  private sessions = new Map<string, SessionState>()

  async initSession(numberId: string, orgId: string): Promise<void> {
    console.log(`[SessionManager] Initializing session for number ${numberId}`)

    // Fecha sessão anterior se existir
    await this.destroySession(numberId)

    const headless = authHeadless()
    const context = await browserPool.open(numberId, headless)
    console.log(
      `[SessionManager] Browser opened for ${numberId} (auth headless=${headless}, dispatch headless=${dispatchHeadless()})`
    )

    const page = await context.newPage()

    await page.goto('https://messages.google.com/web/authentication', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })

    console.log(`[SessionManager] Waiting 5s for SPA QR for ${numberId}`)
    await page.waitForTimeout(5_000)
    console.log(`[SessionManager] Ready — scan QR for ${numberId}`)

    this.watchAuthStateVisible(numberId, page, orgId)
  }

  private watchAuthStateVisible(numberId: string, page: Page, orgId: string): void {
    const poll = setInterval(async () => {
      try {
        const url = page.url()
        console.log(`[SessionManager] Auth poll for ${numberId}: ${url}`)

        const authenticated = url.includes('messages.google.com') && !url.includes('/authentication')

        if (authenticated) {
          clearInterval(poll)
          console.log(`[SessionManager] Authenticated for ${numberId} — keeping browser for dispatch`)

          await db.query(
            `UPDATE rcs.numbers SET status = 'authenticated', updated_at = NOW() WHERE id = $1`,
            [numberId]
          )

          // Navega para /conversations e deixa browser aberto para dispatch
          await page.goto('https://messages.google.com/web/conversations', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await page.waitForTimeout(2_000)

          const session: SessionState = {
            page,
            status: 'authenticated',
            keepaliveInterval: this.startKeepalive(numberId, page),
          }
          this.sessions.set(numberId, session)
          console.log(`[SessionManager] Session registered for dispatch for ${numberId}`)
        }
      } catch (err) {
        console.error(`[SessionManager] Auth poll error for ${numberId}:`, String(err))
      }
    }, 2_000)

    setTimeout(() => clearInterval(poll), 10 * 60 * 1_000)
  }

  private startKeepalive(numberId: string, page: Page): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        if (!browserPool.isOpen(numberId)) return

        // Reseta o timer de idle do BrowserPool
        await browserPool.get(numberId)

        const isAlive = await page.locator(Selectors.conversationList).count() > 0

        if (!isAlive) {
          console.log(`[SessionManager] Session lost for number ${numberId}, marking disconnected`)
          await db.query(
            `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
            [numberId]
          )
          const session = this.sessions.get(numberId)
          if (session) {
            session.status = 'disconnected'
            if (session.keepaliveInterval) clearInterval(session.keepaliveInterval)
          }
          return
        }

        // Scroll suave para simular atividade
        await page.mouse.wheel(0, 10)
        await randomDelay(100, 300)
        await page.mouse.wheel(0, -10)

      } catch {
        // ignora erros de keepalive
      }
    }, 4 * 60 * 1000)
  }

  /**
   * Retorna a página ativa do número para envio.
   * Para restauração após restart do servidor, reabre browser visível com perfil salvo.
   */
  async getPage(numberId: string): Promise<Page | null> {
    // Sessão já em memória — retorna diretamente
    const existing = this.sessions.get(numberId)
    if (existing?.page) return existing.page

    // Verifica se está autenticado no banco
    const numRow = await db.query(
      'SELECT status FROM rcs.numbers WHERE id = $1',
      [numberId]
    )
    if (numRow.rows[0]?.status !== 'authenticated') return null

    // Google Messages SPA crasha em headless — sempre abre visível para restauração
    console.log(`[SessionManager] Restoring session for ${numberId} (headless=false)`)

    const context = await browserPool.open(numberId, false)
    const pages = context.pages()
    const page = pages[0] ?? await context.newPage()

    // Navega para /conversations se não estiver lá
    if (!page.url().includes('messages.google.com/web/conversations')) {
      await page.goto('https://messages.google.com/web/conversations', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      await page.waitForTimeout(3_000)
    }

    // Verifica se realmente está autenticado (não caiu na tela de auth)
    const url = page.url()
    if (url.includes('/authentication')) {
      console.warn(`[SessionManager] Session expired for ${numberId}`)
      await db.query(
        `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
        [numberId]
      )
      await browserPool.close(numberId)
      return null
    }

    const session: SessionState = {
      page,
      status: 'authenticated',
      keepaliveInterval: this.startKeepalive(numberId, page),
    }
    this.sessions.set(numberId, session)
    console.log(`[SessionManager] Session restored for ${numberId}`)

    return page
  }

  async destroySession(numberId: string): Promise<void> {
    const session = this.sessions.get(numberId)
    if (session?.keepaliveInterval) clearInterval(session.keepaliveInterval)
    this.sessions.delete(numberId)
    await browserPool.close(numberId)
  }

  /** Restaura sessões de números autenticados no startup do servidor */
  async restoreActiveSessions(): Promise<void> {
    const result = await db.query(
      `SELECT id FROM rcs.numbers WHERE status = 'authenticated'`
    )
    console.log(`[SessionManager] Restoring ${result.rows.length} active sessions...`)
    for (const row of result.rows) {
      this.getPage(row.id).catch((err) => {
        console.warn(`[SessionManager] Could not restore session for ${row.id}:`, String(err))
      })
    }
  }
}

export const sessionManager = new SessionManager()
