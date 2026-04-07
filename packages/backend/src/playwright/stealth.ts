import fs from 'fs'
import { chromium, BrowserContext } from 'playwright'

// playwright-extra com stealth
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium: chromiumExtra } = require('playwright-extra')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

chromiumExtra.use(StealthPlugin())

const HEADLESS_VIEWPORT = { width: 1280, height: 800 }

const VIEWPORTS_HEADED = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
]

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

const LINUX_HEADLESS_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export function randomViewport() {
  return VIEWPORTS_HEADED[Math.floor(Math.random() * VIEWPORTS_HEADED.length)]
}

export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

export type LaunchStealthOptions = {
  /** Se existir, aplicado no launch (cookies/localStorage exportados pelo Playwright). */
  storageStatePath?: string
}

export async function launchStealthContext(
  sessionDir: string,
  headless = true,
  options?: LaunchStealthOptions
): Promise<BrowserContext> {
  const slowMo = Number(process.env.PLAYWRIGHT_SLOW_MO) || 0
  const executablePath = process.env.CHROME_EXECUTABLE_PATH?.trim() || undefined

  const viewport = headless ? HEADLESS_VIEWPORT : randomViewport()
  const userAgent = headless ? LINUX_HEADLESS_UA : randomUserAgent()

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    `--window-size=${viewport.width},${viewport.height}`,
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (headless) {
    args.push('--disable-gpu')
  } else {
    args.push('--start-maximized')
  }

  const storageStatePath = options?.storageStatePath
  const useStorageState =
    storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined
  if (storageStatePath && !useStorageState) {
    console.warn(`[stealth] storageState path missing on disk, skipping: ${storageStatePath}`)
  }

  const context: BrowserContext = await (chromiumExtra as typeof chromium).launchPersistentContext(
    sessionDir,
    {
      headless,
      slowMo,
      executablePath,
      args,
      viewport: headless ? viewport : null,
      userAgent,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      permissions: ['notifications'],
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      ...(useStorageState ? { storageState: useStorageState } : {}),
    }
  )

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Google Chrome', version: '124' },
          { brand: 'Chromium', version: '124' },
        ],
        mobile: false,
        platform: 'Linux',
      }),
    });
  `)

  return context
}
