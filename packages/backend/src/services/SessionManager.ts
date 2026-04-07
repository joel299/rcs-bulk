import fs from 'fs'
import { Page } from 'playwright'
import { db } from '../db/client'
import { browserPool } from './BrowserPool'
import { Selectors } from '../playwright/selectors'
import { randomDelay } from '../playwright/actions'
import {
  getStorageStatePath,
  logSessionsDirDiagnostics,
} from '../config/sessionsRoot'

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
  storageKeepaliveInterval: NodeJS.Timeout | null
}

class SessionManager {
  private sessions = new Map<string, SessionState>()

  private async saveStorageState(numberId: string, page: Page): Promise<void> {
    const sessionPath = getStorageStatePath(numberId)
    try {
      await page.context().storageState({ path: sessionPath })
      console.log(`[SessionManager] Session saved: ${sessionPath}`)
    } catch (err) {
      console.error(`[SessionManager] Failed to save session for ${numberId}:`, err)
    }
  }

  /** Persiste cookies antes de fechar browser (shutdown / destroy). */
  private async flushStorageState(numberId: string, page: Page | null): Promise<void> {
    if (!page || page.isClosed()) return
    try {
      const sessionPath = getStorageStatePath(numberId)
      await page.context().storageState({ path: sessionPath })
      console.log(`[SessionManager] Flushed storageState before close: ${sessionPath}`)
    } catch (err) {
      console.warn(`[SessionManager] flushStorageState failed for ${numberId}:`, err)
    }
  }

  private async tryMinimizeBrowserWindow(page: Page): Promise<void> {
    if (process.env.PLAYWRIGHT_HEADLESS !== 'false') return
    try {
      const cdp = await page.context().newCDPSession(page)
      type PageInternal = Page & { _target?: { _targetId?: string } }
      const targetId = (page as PageInternal)._target?._targetId
      if (!targetId) {
        console.warn('[SessionManager] Could not minimize (no targetId)')
        return
      }
      const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId })
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' },
      })
      console.log(`[SessionManager] Browser window minimized`)
    } catch {
      console.warn('[SessionManager] Could not minimize browser window (non-critical)')
    }
  }

  /** Página ainda utilizável e browser conectado (quando exposto pelo Playwright). */
  private isPlaywrightSessionAlive(page: Page): boolean {
    try {
      if (page.isClosed()) return false
      const browser = page.context().browser()
      if (browser !== null && !browser.isConnected()) return false
      return true
    } catch {
      return false
    }
  }

  /** Remove estado em memória; opcionalmente fecha o pool se ainda estiver aberto. */
  private async clearLocalSession(numberId: string): Promise<void> {
    const session = this.sessions.get(numberId)
    if (session?.keepaliveInterval) clearInterval(session.keepaliveInterval)
    if (session?.storageKeepaliveInterval) clearInterval(session.storageKeepaliveInterval)
    if (session?.page) await this.flushStorageState(numberId, session.page)
    this.sessions.delete(numberId)
    if (browserPool.isOpen(numberId)) {
      await browserPool.close(numberId)
    }
  }

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

          await this.saveStorageState(numberId, page)
          await this.tryMinimizeBrowserWindow(page)

          const session: SessionState = {
            page,
            status: 'authenticated',
            keepaliveInterval: this.startKeepalive(numberId, page),
            storageKeepaliveInterval: this.startStorageKeepalive(numberId, page),
          }
          this.sessions.set(numberId, session)
          console.log(
            `[SessionManager] Session registered for dispatch for ${numberId} (storageState + keepalive)`
          )
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
            if (session.storageKeepaliveInterval) clearInterval(session.storageKeepaliveInterval)
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

  /** Salva storageState a cada 5 min (cookies frescos). */
  private startStorageKeepalive(numberId: string, page: Page): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const s = this.sessions.get(numberId)
        if (!s?.page || s.page.isClosed()) return
        if (!browserPool.isOpen(numberId)) return
        await this.saveStorageState(numberId, s.page)
      } catch (err) {
        console.warn(`[SessionManager] Keepalive storage save failed for ${numberId}:`, err)
      }
    }, 5 * 60 * 1000)
  }

  /**
   * Retorna a página ativa do número para envio.
   * Para restauração após restart do servidor, reabre browser visível com perfil salvo.
   */
  async getPage(numberId: string): Promise<Page | null> {
    const existing = this.sessions.get(numberId)
    if (existing?.page) {
      const alive = this.isPlaywrightSessionAlive(existing.page)
      if (alive && browserPool.isOpen(numberId)) {
        // Reseta TTL idle — sem isso o BrowserPool fecha o Chromium entre jobs da fila
        await browserPool.get(numberId)
        // Garante janela minimizada a cada dispatch (não só na primeira autenticação)
        await this.tryMinimizeBrowserWindow(existing.page)
        return existing.page
      }
      if (!alive) {
        console.error(
          `[SessionManager] Browser disconnected for ${numberId} — marking disconnected`
        )
        try {
          await db.query(
            `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
            [numberId]
          )
        } catch (err) {
          console.warn(`[SessionManager] Could not mark number disconnected:`, err)
        }
      } else {
        console.warn(
          `[SessionManager] Pool closed for ${numberId} — clearing local session before re-bind`
        )
      }
      await this.clearLocalSession(numberId)
    }

    // Verifica se está autenticado no banco
    const numRow = await db.query(
      'SELECT status FROM rcs.numbers WHERE id = $1',
      [numberId]
    )
    if (numRow.rows[0]?.status !== 'authenticated') return null

    const storagePath = getStorageStatePath(numberId)
    if (!fs.existsSync(storagePath)) {
      console.warn(
        `[SessionManager] No storageState file for ${numberId} — restoring from Chrome profile only. Expected: ${storagePath}`
      )
    }

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
      console.warn(`[SessionManager] Session expired for ${numberId} — QR code required`)
      if (fs.existsSync(storagePath)) {
        try {
          fs.unlinkSync(storagePath)
          console.warn(
            `[SessionManager] Removed invalid storageState (expired session): ${storagePath}`
          )
        } catch (e) {
          console.warn(`[SessionManager] Could not remove storageState file:`, e)
        }
      }
      await db.query(
        `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
        [numberId]
      )
      await browserPool.close(numberId)
      return null
    }

    await this.saveStorageState(numberId, page)
    await this.tryMinimizeBrowserWindow(page)

    const session: SessionState = {
      page,
      status: 'authenticated',
      keepaliveInterval: this.startKeepalive(numberId, page),
      storageKeepaliveInterval: this.startStorageKeepalive(numberId, page),
    }
    this.sessions.set(numberId, session)
    console.log(`[SessionManager] Session restored and authenticated for ${numberId}`)

    return page
  }

  async destroySession(numberId: string): Promise<void> {
    await this.clearLocalSession(numberId)
  }

  /** Encerra todas as sessões (timers + browsers) — graceful shutdown */
  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    if (ids.length === 0) {
      console.log('[SessionManager] closeAll — no in-memory sessions')
      return
    }
    console.log(`[SessionManager] Closing ${ids.length} session(s)...`)
    await Promise.allSettled(ids.map((id) => this.destroySession(id)))
  }

  /**
   * Registra quais números têm sessão autenticada para restore lazy.
   * NÃO abre browsers no startup — sessões são restauradas em getPage()
   * na primeira vez que o worker de dispatch precisar, evitando ERR_ABORTED
   * quando o servidor reinicia antes de o browser terminar de carregar.
   */
  async restoreActiveSessions(): Promise<void> {
    logSessionsDirDiagnostics()
    const result = await db.query(
      `SELECT id, phone_label FROM rcs.numbers WHERE status = 'authenticated'`
    )
    if (result.rows.length === 0) {
      console.log('[SessionManager] No authenticated numbers to restore')
      return
    }
    for (const row of result.rows) {
      const id = String(row.id)
      const phone = row.phone_label ?? ''
      const stPath = getStorageStatePath(id)
      console.log(
        `[SessionManager] Number ${id} (${phone}) will restore lazily on first dispatch.` +
        (fs.existsSync(stPath) ? ' storageState found.' : ' No storageState — will use Chrome profile.')
      )
    }
  }
}

export const sessionManager = new SessionManager()
