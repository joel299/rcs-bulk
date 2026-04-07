import path from 'path'
import fs from 'fs'
import { BrowserContext } from 'playwright'
import { launchStealthContext } from '../playwright/stealth'
import {
  getChromeProfileDir,
  getStorageStatePath,
  ensureValidStorageStateFileOrRemove,
} from '../config/sessionsRoot'

interface PoolEntry {
  context: BrowserContext
  lastUsed: number
  timer: NodeJS.Timeout | null
}

/**
 * Pool de browsers com lazy loading e TTL.
 * Cada número tem no máximo 1 instância Chromium.
 * Browsers ociosos são fechados após BROWSER_IDLE_TTL_MS.
 * Lock por numberId evita aberturas concorrentes do mesmo perfil.
 */
class BrowserPool {
  private pool = new Map<string, PoolEntry>()
  private opening = new Map<string, Promise<BrowserContext>>() // lock de abertura
  private idleTtl: number

  constructor() {
    this.idleTtl = Number(process.env.BROWSER_IDLE_TTL_MS ?? 600_000) // 10min padrão
  }

  async get(numberId: string): Promise<BrowserContext> {
    const entry = this.pool.get(numberId)
    if (entry) {
      this.resetIdleTimer(numberId)
      entry.lastUsed = Date.now()
      return entry.context
    }
    return this.open(numberId)
  }

  async open(numberId: string, headless = true): Promise<BrowserContext> {
    // Se já há uma abertura em andamento para este número, aguarda ela
    const pending = this.opening.get(numberId)
    if (pending) {
      console.log(`[BrowserPool] Waiting for pending open for ${numberId}`)
      return pending
    }

    // Se já está no pool (aberto por outra via), retorna
    const existing = this.pool.get(numberId)
    if (existing) {
      this.resetIdleTimer(numberId)
      existing.lastUsed = Date.now()
      return existing.context
    }

    const openPromise = this._doOpen(numberId, headless)
    this.opening.set(numberId, openPromise)

    try {
      const context = await openPromise
      return context
    } finally {
      this.opening.delete(numberId)
    }
  }

  private async _doOpen(numberId: string, headless: boolean): Promise<BrowserContext> {
    ensureValidStorageStateFileOrRemove(numberId)
    const sessionPath = getChromeProfileDir(numberId)
    const storageStatePath = getStorageStatePath(numberId)

    // Garante que o diretório do perfil Chromium existe
    fs.mkdirSync(sessionPath, { recursive: true })

    // Remove SingletonLock se o browser anterior crashou sem limpar
    const lockFile = path.join(sessionPath, 'SingletonLock')
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile) } catch {}
    }
    const socketFile = path.join(sessionPath, 'SingletonSocket')
    if (fs.existsSync(socketFile)) {
      try { fs.unlinkSync(socketFile) } catch {}
    }
    const cookieFile = path.join(sessionPath, 'SingletonCookie')
    if (fs.existsSync(cookieFile)) {
      try { fs.unlinkSync(cookieFile) } catch {}
    }

    const context = await launchStealthContext(sessionPath, headless, {
      storageStatePath,
    })

    const entry: PoolEntry = {
      context,
      lastUsed: Date.now(),
      timer: null,
    }

    this.pool.set(numberId, entry)
    this.resetIdleTimer(numberId)

    context.on('close', () => {
      const e = this.pool.get(numberId)
      if (e?.timer) clearTimeout(e.timer)
      this.pool.delete(numberId)
    })

    return context
  }

  async close(numberId: string): Promise<void> {
    const entry = this.pool.get(numberId)
    if (!entry) return

    if (entry.timer) clearTimeout(entry.timer)
    this.pool.delete(numberId)

    try {
      await entry.context.close()
    } catch {
      // ignora erros ao fechar
    }
  }

  isOpen(numberId: string): boolean {
    return this.pool.has(numberId)
  }

  private resetIdleTimer(numberId: string): void {
    const entry = this.pool.get(numberId)
    if (!entry) return

    if (entry.timer) clearTimeout(entry.timer)

    entry.timer = setTimeout(async () => {
      console.log(`[BrowserPool] Closing idle browser for number ${numberId}`)
      await this.close(numberId)
    }, this.idleTtl)
  }

  async closeAll(): Promise<void> {
    const ids = [...this.pool.keys()]
    await Promise.allSettled(ids.map((id) => this.close(id)))
  }
}

export const browserPool = new BrowserPool()
