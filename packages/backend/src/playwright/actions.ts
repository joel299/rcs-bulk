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

/** Modal / banner de restauração do Chromium ou similar — tenta fechar. */
async function dismissRestoreDialog(page: Page): Promise<void> {
  try {
    const selectors = [
      'button:has-text("Fechar")',
      'button:has-text("Close")',
      'button:has-text("Não restaurar")',
      `button:has-text("Don't restore")`,
      'button:has-text("Não")',
      '[aria-label="Close"]',
      '[aria-label="Fechar"]',
    ]
    for (const sel of selectors) {
      const btn = page.locator(sel).first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 2_000 }).catch(() => {})
        console.log(`[sendMessage] Dismissed restore-style dialog (${sel})`)
        await randomDelay(800, 1200)
        break
      }
    }
  } catch {
    /* sem modal */
  }
}

/**
 * Fluxo Google: às vezes aparece "Usar Aqui" — clicar e aguardar recarga antes de seguir.
 */
async function clickUsarAquiIfPresent(page: Page): Promise<void> {
  try {
    const loc = page
      .locator('text=Usar Aqui')
      .or(page.getByRole('button', { name: /Usar Aqui/i }))
      .or(page.getByRole('link', { name: /Usar Aqui/i }))
      .first()
    if ((await loc.count()) === 0) return
    const visible = await loc.isVisible().catch(() => false)
    if (!visible) return
    console.log(`[sendMessage] "Usar Aqui" visible — clicking and waiting for reload`)
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch(() => {}),
      loc.click({ timeout: 8_000 }),
    ])
    await randomDelay(2_000, 3_500)
  } catch {
    /* ignore */
  }
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
    await randomDelay(2000, 3000)
    await dismissRestoreDialog(page)
    await clickUsarAquiIfPresent(page)
    await randomDelay(1000, 1500)
    await dismissRestoreDialog(page)
    await randomDelay(2000, 3500)

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

    // 6. Anexa imagem ANTES de detectar tipo — obrigatório quando há path; upload 10–12s dentro de attachImage
    if (localImagePath) {
      console.log(`[sendMessage] Attaching image: ${localImagePath}`)
      await attachImage(page, localImagePath)
      console.log(`[sendMessage] Image attach + upload wait complete`)
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
 * Anexa só via input[type=file] (setInputFiles), incluindo shadow DOM do compose.
 * Sucesso sempre loga `[attachImage] ✅ Attached via file input`.
 * Espera obrigatória 10–12s após anexar.
 */
async function attachImage(page: Page, localImagePath: string): Promise<void> {
  console.log(`[attachImage] Starting (file input only): ${localImagePath}`)

  const tryLocator = page.locator('mws-message-compose input[type="file"]').first()
  if ((await tryLocator.count()) > 0) {
    try {
      await tryLocator.setInputFiles(localImagePath, { timeout: 15_000 })
      console.log(`[attachImage] ✅ Attached via file input`)
      await randomDelay(10_000, 12_000)
      return
    } catch (e) {
      console.warn(`[attachImage] mws-message-compose locator failed, trying deep shadow:`, String(e))
    }
  }

  const fallbackLoc = page.locator(Selectors.fileInput).first()
  if ((await fallbackLoc.count()) > 0) {
    try {
      await fallbackLoc.setInputFiles(localImagePath, { timeout: 15_000 })
      console.log(`[attachImage] ✅ Attached via file input`)
      await randomDelay(10_000, 12_000)
      return
    } catch (e) {
      console.warn(`[attachImage] Selectors.fileInput failed, trying evaluate handle:`, String(e))
    }
  }

  const handle = await page.evaluateHandle(`
    () => {
      function findInCompose(root) {
        var compose = root.querySelector('mws-message-compose')
        if (compose) {
          var inputs = compose.querySelectorAll('input[type="file"]')
          for (var i = 0; i < inputs.length; i++) return inputs[i]
          var hosts = compose.querySelectorAll('*')
          for (var j = 0; j < hosts.length; j++) {
            var sr = hosts[j].shadowRoot
            if (sr) {
              var f = findInCompose(sr)
              if (f) return f
            }
          }
        }
        return null
      }
      function findAny(root) {
        var all = root.querySelectorAll('input[type="file"]')
        if (all.length) return all[0]
        var nodes = root.querySelectorAll('*')
        for (var k = 0; k < nodes.length; k++) {
          var sh = nodes[k].shadowRoot
          if (sh) {
            var g = findAny(sh)
            if (g) return g
          }
        }
        return null
      }
      return findInCompose(document) || findAny(document)
    }
  `)

  const el = handle.asElement()
  if (!el) {
    await handle.dispose()
    throw new Error('[attachImage] All attachment strategies failed: no file input')
  }

  try {
    await el.evaluate(`
      (n) => {
        n.style.display = 'block'
        n.style.visibility = 'visible'
        n.style.opacity = '1'
      }
    `)
    await el.setInputFiles(localImagePath)
    console.log(`[attachImage] ✅ Attached via file input`)
    await randomDelay(10_000, 12_000)
  } finally {
    await el.dispose().catch(() => {})
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
