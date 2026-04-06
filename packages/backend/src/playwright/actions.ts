import { Page } from 'playwright'
import { Selectors } from './selectors'
import type { MessageType } from '@rcs/shared'

const CRITICAL_WAIT_MS = 30_000
const SEND_WAIT_MS = 12_000

/** Delay aleatório entre min e max ms */
export async function randomDelay(min: number, max: number): Promise<void> {
  await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)))
}

/** Digita caractere a caractere com delay humano */
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char)
    await randomDelay(50, 130)
  }
}

/** Scroll suave para simular leitura */
export async function humanScroll(page: Page): Promise<void> {
  const delta = 50 + Math.random() * 150
  await page.mouse.wheel(0, delta)
  await randomDelay(200, 500)
}

function safeScreenshotSlug(phone: string): string {
  return phone.replace(/[^\dA-Za-z+]/g, '_').slice(0, 32) || 'unknown'
}

async function resetPageForSend(_page: Page): Promise<void> {
  // Não navega para about:blank — isso pode quebrar o contexto da SPA do Google Messages
  await randomDelay(300, 600)
}

/**
 * Envia mensagem RCS via Google Messages Web.
 *
 * Fluxo:
 * 1. Limpa estado da aba e navega para /conversations/new
 * 2. Clica em "Iniciar chat" (FAB)
 * 3. Digita o número no campo de destinatário
 * 4. Clica no botão de seleção do contato
 * 5. Aguarda carregar a conversa
 * 6. Anexa imagem (se houver)
 * 7. Digita o texto
 * 8. Clica em Enviar
 */
export async function sendMessage(
  page: Page,
  phone: string,
  message: string,
  localImagePath?: string
): Promise<{ success: boolean; messageType: MessageType; error?: string }> {
  try {
    console.log(`[sendMessage] Reset tab state before send to ${phone}`)
    await resetPageForSend(page)

    // 1. Navega para nova conversa
    console.log(`[sendMessage] Navigating to new conversation for ${phone}`)
    await page.goto('https://messages.google.com/web/conversations/new', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await randomDelay(4000, 6000)

    // 2. Clica em "Iniciar chat" (botão FAB)
    console.log(`[sendMessage] Clicking start chat button`)
    const startBtn = page.locator(Selectors.startChatBtn).first()
    await startBtn.waitFor({ state: 'visible', timeout: CRITICAL_WAIT_MS })
    await startBtn.click()
    await randomDelay(2500, 4000)

    // 3. Digita o número no campo de destinatário
    console.log(`[sendMessage] Typing phone number: ${phone}`)
    const recipientInput = page.locator(Selectors.recipientInput).first()
    await recipientInput.waitFor({ state: 'visible', timeout: CRITICAL_WAIT_MS })
    await recipientInput.click()
    await randomDelay(300, 600)
    await humanType(page, phone)
    await randomDelay(1200, 2000)

    // 4. Clica no botão de seleção do contato sugerido
    console.log(`[sendMessage] Clicking contact selector button`)
    const contactBtn = page.locator(Selectors.contactSelectorBtn).first()
    await contactBtn.waitFor({ state: 'visible', timeout: CRITICAL_WAIT_MS })
    await contactBtn.click()

    // 5. Aguarda a URL mudar para uma thread de conversa
    console.log(`[sendMessage] Waiting for conversation thread to open`)
    try {
      await page.waitForURL(
        (url) => url.href.includes('/conversations/') && !url.href.includes('/conversations/new'),
        { timeout: 10_000 }
      )
      console.log(`[sendMessage] Conversation opened at: ${page.url()}`)
    } catch {
      // A conversa pode já existir na lista — tenta clicar nela
      console.log(`[sendMessage] URL didn't change, trying to click existing conversation`)
      const convLink = page.locator(`mws-conversation-list-item a, mws-conversations-list a`).first()
      if (await convLink.count() > 0) {
        await convLink.click()
        await randomDelay(2000, 3000)
      }
    }

    // Verifica se ainda estamos autenticados
    const currentUrl = page.url()
    console.log(`[sendMessage] Current URL: ${currentUrl}`)
    if (!currentUrl.includes('messages.google.com/web/conversations/') || currentUrl.includes('/authentication')) {
      throw new Error(`Session lost or conversation not opened. URL: ${currentUrl}`)
    }

    // Aguarda o compose input dentro do shadow DOM ficar disponível
    console.log(`[sendMessage] Waiting for compose input in shadow DOM`)
    await page.waitForFunction(`
      (() => {
        function findInput(root) {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.contentEditable === 'true' || el.tagName === 'TEXTAREA') return el
            if (el.shadowRoot) {
              const found = findInput(el.shadowRoot)
              if (found) return found
            }
          }
          return null
        }
        return findInput(document) !== null
      })()
    `, { timeout: CRITICAL_WAIT_MS })
    await randomDelay(500, 1000)

    // Detecta tipo de mensagem
    const messageType = await detectMessageType(page)
    console.log(`[sendMessage] Message type: ${messageType}`)

    // 6. Anexa imagem se houver
    if (localImagePath) {
      console.log(`[sendMessage] Attaching image: ${localImagePath}`)
      await attachImage(page, localImagePath)
      await randomDelay(500, 1000)
    }

    // 7. Foca e digita no compose (shadow DOM)
    console.log(`[sendMessage] Clicking compose and typing message`)
    await page.evaluate(`
      (() => {
        function findInput(root) {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.contentEditable === 'true' || el.tagName === 'TEXTAREA') return el
            if (el.shadowRoot) {
              const found = findInput(el.shadowRoot)
              if (found) return found
            }
          }
          return null
        }
        const el = findInput(document)
        if (el) { el.focus(); el.click() }
      })()
    `)
    await randomDelay(400, 700)
    await page.keyboard.type(message, { delay: 80 })
    await randomDelay(700, 1200)

    // 8. Clica em Enviar (XPath exato fornecido pelo usuário)
    console.log(`[sendMessage] Clicking send button`)
    try {
      const sendBtn = page.locator(Selectors.sendBtn).first()
      await sendBtn.waitFor({ state: 'visible', timeout: SEND_WAIT_MS })
      await sendBtn.click()
    } catch {
      // Fallback: Enter para enviar
      console.log(`[sendMessage] Send button not found, using Enter key`)
      await page.keyboard.press('Enter')
    }
    await randomDelay(1500, 2500)

    console.log(`[sendMessage] Message sent successfully to ${phone}`)
    return { success: true, messageType }
  } catch (err) {
    const slug = safeScreenshotSlug(phone)
    const screenshotPath = `/tmp/debug-rcs-${slug}-${Date.now()}.png`
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true })
      console.error(`[sendMessage] Screenshot saved: ${screenshotPath}`)
    } catch {
      console.error(`[sendMessage] Could not save screenshot for ${phone}`)
    }
    console.error(`[sendMessage] Error sending to ${phone}:`, String(err))
    return { success: false, messageType: 'rcs', error: String(err) }
  }
}

/**
 * Tenta anexar imagem diretamente via input[type="file"] (sem abrir menus).
 * Playwright consegue setar arquivos em inputs ocultos.
 */
async function attachImage(page: Page, localImagePath: string): Promise<void> {
  try {
    // Tenta setar diretamente no input file (funciona mesmo oculto no Playwright)
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(localImagePath, { timeout: 5_000 })
    console.log(`[sendMessage] Image attached via file input`)
    await randomDelay(1000, 2000)
  } catch (err) {
    console.warn(`[sendMessage] Could not attach image, skipping:`, String(err))
  }
}

/**
 * Detecta se a conversa será enviada como RCS ou SMS.
 */
export async function detectMessageType(page: Page): Promise<MessageType> {
  try {
    const smsIndicator = await page.locator(Selectors.smsBadge).count()
    return smsIndicator > 0 ? 'sms' : 'rcs'
  } catch {
    return 'rcs'
  }
}
