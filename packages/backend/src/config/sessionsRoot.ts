import path from 'path'
import fs from 'fs'

/**
 * Resolve após dotenv — não leia process.env no load do módulo (imports rodam antes de config()).
 */
let cachedRoot: string | null = null

export function getSessionsRoot(): string {
  if (cachedRoot) return cachedRoot
  const fromEnv = process.env.SESSIONS_DIR?.trim()
  cachedRoot = fromEnv
    ? path.resolve(fromEnv)
    : path.resolve(process.cwd(), 'data', 'sessions')
  if (!fs.existsSync(cachedRoot)) {
    fs.mkdirSync(cachedRoot, { recursive: true })
    console.log(`[Sessions] Created directory: ${cachedRoot}`)
  }
  return cachedRoot
}

/** Perfil Chromium persistente por número (BrowserPool). */
export function getChromeProfileDir(numberId: string): string {
  return path.join(getSessionsRoot(), numberId)
}

/** Playwright storageState (cookies + storage) — backup / restore explícito. */
export function getStorageStatePath(numberId: string): string {
  return path.join(getSessionsRoot(), `session-${numberId}.json`)
}

/**
 * Remove JSON inválido (evita falha silenciosa no launch).
 * Retorna false se removeu arquivo; true se OK ou arquivo inexistente.
 */
export function ensureValidStorageStateFileOrRemove(numberId: string): boolean {
  const p = getStorageStatePath(numberId)
  if (!fs.existsSync(p)) return true
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    JSON.parse(raw)
    return true
  } catch (err) {
    console.error(
      `[Sessions] Storage state corrupted for ${numberId} — deleting file (will rely on Chrome profile if any): ${p}`,
      err
    )
    try {
      fs.unlinkSync(p)
    } catch (unlinkErr) {
      console.warn(`[Sessions] Could not delete corrupted storage file:`, unlinkErr)
    }
    return false
  }
}

export function logSessionsDirDiagnostics(): void {
  const root = getSessionsRoot()
  console.log(`[SessionManager] Sessions directory (absolute): ${root}`)
  try {
    const files = fs.readdirSync(root)
    const jsonCount = files.filter((f) => f.endsWith('.json')).length
    console.log(`[SessionManager] StorageState .json files in directory: ${jsonCount}`)
  } catch (err) {
    console.warn(`[SessionManager] Could not list sessions directory:`, err)
  }
}
