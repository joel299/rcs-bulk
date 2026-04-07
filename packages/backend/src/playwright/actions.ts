import { Page } from 'playwright'
import { Selectors } from './selectors'
import type { MessageType } from '@rcs/shared'

const CRITICAL_WAIT_MS = 30_000
const SEND_WAIT_MS = 12_000

/** Seletores para tentar confirmar que a mensagem apareceu na thread após enviar */
const SENT_MESSAGE_CONFIRM =
  'mw-message-part, .message-wrapper, [class*="outgoing"], mws-message-bubble, [data-e2e-outgoing-message]'

// Palavras que indicam falha REAL de entrega — "Conferir as opções" removido pois
// aparece normalmente na UI durante troca RCS→SMS e gerava falso positivo.
const DELIVERY_FAILURE_KEYWORDS = [
  'Mensagem não enviada',
  'Message not sent',
  'Not delivered',
  'Failed to send',
  'Não foi possível enviar',
]

const DELIVERY_FAILURE_SELECTORS =
  'mw-message-send-error, [data-e2e-send-error]'

function failureScreenshotPath(phone: string): string {
  return `/tmp/rcs-fail-${safeScreenshotSlug(phone)}-${Date.now()}.png`
}

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
  await randomDelay(400, 700)
}

/**
 * Envia mensagem RCS via Google Messages Web.
 *
 * Fluxo:
 * 1. Navega para /conversations/new
 * 2. FAB iniciar chat → destinatário → chip do contato
 * 3. Aguarda thread + compose (shadow DOM)
 * 4. Aguarda 5–6s (handshake RCS/SMS)
 * 5. Anexa imagem se houver → espera 10–12s upload
 * 6. detectMessageType (após mídia carregar)
 * 7. Digita texto → Enviar → confirma na conversa
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
      timeout: 30_000,
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
      console.log(`[sendMessage] URL didn't change, trying to click existing conversation`)
      const convLink = page.locator(`mws-conversation-list-item a, mws-conversations-list a`).first()
      if (await convLink.count() > 0) {
        await convLink.click()
        await randomDelay(2000, 3000)
      }
    }

    const currentUrl = page.url()
    console.log(`[sendMessage] Current URL: ${currentUrl}`)
    if (!currentUrl.includes('messages.google.com/web/conversations/') || currentUrl.includes('/authentication')) {
      throw new Error(`Session lost or conversation not opened. URL: ${currentUrl}`)
    }

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

    // 5b. Conversa carregar e estabelecer tipo (RCS requer handshake)
    console.log(`[sendMessage] Waiting for conversation to settle (RCS/SMS)`)
    await randomDelay(5000, 6000)

    // 6. Anexa imagem ANTES de detectar tipo — upload precisa terminar
    if (localImagePath) {
      console.log(`[sendMessage] Attaching image: ${localImagePath}`)
      await attachImage(page, localImagePath)
      await randomDelay(10_000, 12_000)
      console.log(`[sendMessage] Image upload wait complete`)
    }

    const messageType = await detectMessageType(page)
    console.log(`[sendMessage] Message type detected: ${messageType}`)

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

    // 8. Enviar
    console.log(`[sendMessage] Clicking send button`)
    try {
      const sendBtn = page.locator(Selectors.sendBtn).first()
      await sendBtn.waitFor({ state: 'visible', timeout: SEND_WAIT_MS })
      await sendBtn.click()
    } catch {
      console.log(`[sendMessage] Send button not found, using Enter key`)
      await page.keyboard.press('Enter')
    }

    console.log(`[sendMessage] Send clicked, verifying delivery...`)
    await randomDelay(3000, 4000)

    const pageText = (await page.evaluate('document.body.innerText')) as string
    const textHasError = DELIVERY_FAILURE_KEYWORDS.some((kw) => pageText.includes(kw))
    const selectorErrorCount = await page.locator(DELIVERY_FAILURE_SELECTORS).count()

    if (textHasError || selectorErrorCount > 0) {
      const errorMsg =
        'Google Messages reported delivery failure (message not sent indicator detected)'
      console.error(`[sendMessage] ❌ Delivery failed for ${phone}: ${errorMsg}`)
      const shot = failureScreenshotPath(phone)
      try {
        await page.screenshot({ path: shot, fullPage: true })
        console.error(`[sendMessage] Screenshot saved: ${shot}`)
      } catch {
        /* ignore */
      }
      return { success: false, messageType, error: errorMsg }
    }

    try {
      await page.waitForSelector(SENT_MESSAGE_CONFIRM, { state: 'visible', timeout: 15_000 })
      console.log(`[sendMessage] Message confirmed in conversation`)
    } catch {
      console.warn(`[sendMessage] Could not confirm message appeared in conversation`)
    }

    await randomDelay(2000, 3000)
    console.log(`[sendMessage] ✅ Message delivered to ${phone}`)
    return { success: true, messageType }
  } catch (err) {
    const screenshotPath = failureScreenshotPath(phone)
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
 * Anexa imagem no Google Messages.
 * Estratégia 1: setInputFiles direto no input[type="file"] (Playwright pierces shadow DOM).
 * Estratégia 2: fileChooser — clica no botão de anexo (CSS ou JS shadow DOM) e intercepta.
 * Se ambos falharem, loga aviso e CONTINUA sem imagem (dispatch não deve falhar por isso).
 */
async function attachImage(page: Page, localImagePath: string): Promise<void> {
  // Estratégia 1: input file direto (funciona mesmo oculto; Playwright traversa shadow DOM)
  try {
    const fileInput = page.locator('input[type="file"]').first()
    const count = await fileInput.count().catch(() => 0)
    if (count > 0) {
      await fileInput.setInputFiles(localImagePath, { timeout: 5_000 })
      console.log(`[attachImage] ✓ Image attached via file input`)
      await randomDelay(1500, 2500)
      return
    }
  } catch (e1) {
    console.warn(`[attachImage] file input strategy failed:`, String(e1))
  }

  // Estratégia 2: fileChooser após clicar no botão de anexo
  try {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 })

    // Tenta clicar via CSS locator; se não achar, usa JS para traversar shadow DOM
    const clicked = await page.locator(Selectors.attachButton).first().click({ timeout: 3_000 })
      .then(() => true)
      .catch(async () => {
        return page.evaluate(`
          (() => {
            function findAttach(root) {
              for (const el of Array.from(root.querySelectorAll('button,[role="button"]'))) {
                const label = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '').toLowerCase()
                if (label.includes('attach') || label.includes('anexar') || label.includes('foto') || label.includes('image')) {
                  el.click(); return true
                }
              }
              for (const el of Array.from(root.querySelectorAll('*'))) {
                if (el.shadowRoot) { if (findAttach(el.shadowRoot)) return true }
              }
              return false
            }
            return findAttach(document)
          })()
        `).then((v) => !!v)
      })

    if (clicked) {
      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(localImagePath)
      console.log(`[attachImage] ✓ Image attached via fileChooser`)
      await randomDelay(1500, 2500)
      return
    }
  } catch (e2) {
    console.warn(`[attachImage] fileChooser strategy failed:`, String(e2))
  }

  console.warn(`[attachImage] Could not attach image — continuing dispatch without image`)
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
