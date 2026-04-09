import fs from "fs";
import { Page } from "playwright";
import { Selectors, CONTACT_CHIP_SELECTOR_LIST } from "./selectors";
import type { MessageType } from "@rcs/shared";

/** Seletores para tentar confirmar que a mensagem apareceu na thread após enviar */
const SENT_MESSAGE_CONFIRM =
  'mw-message-part, .message-wrapper, [class*="outgoing"], mws-message-bubble, [data-e2e-outgoing-message]';

// Palavras que indicam falha REAL de entrega — "Conferir as opções" removido pois
// aparece normalmente na UI durante troca RCS→SMS e gerava falso positivo.
const DELIVERY_FAILURE_KEYWORDS = [
  "Mensagem não enviada",
  "Message not sent",
  "Not delivered",
  "Failed to send",
  "Não foi possível enviar",
];

const DELIVERY_FAILURE_SELECTORS =
  "mw-message-send-error, [data-e2e-send-error]";

function failureScreenshotPath(phone: string): string {
  return `/tmp/rcs-fail-${safeScreenshotSlug(phone)}-${Date.now()}.png`;
}

/** Delay aleatório entre min e max ms */
export async function randomDelay(min: number, max: number): Promise<void> {
  await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

/** Digita caractere a caractere com delay humano */
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);
    await randomDelay(50, 130);
  }
}

/** Scroll suave para simular leitura */
export async function humanScroll(page: Page): Promise<void> {
  const delta = 50 + Math.random() * 150;
  await page.mouse.wheel(0, delta);
  await randomDelay(200, 500);
}

function safeScreenshotSlug(phone: string): string {
  return phone.replace(/[^\dA-Za-z+]/g, "_").slice(0, 32) || "unknown";
}

async function resetPageForSend(page: Page): Promise<void> {
  try {
    await page.evaluate("() => { window.stop?.() }");
  } catch {
    /* ignore */
  }
  await randomDelay(500, 800);
}

const DIALOG_DISMISS_ROWS: { selector: string; label: string }[] = [
  { selector: 'button:has-text("Fechar")', label: "Chromium restore - Fechar" },
  { selector: 'button:has-text("Close")', label: "Chromium restore - Close" },
  {
    selector: 'button:has-text("Não restaurar")',
    label: "Chromium restore - Nao restaurar",
  },
  {
    selector: `button:has-text("Don't restore")`,
    label: "Chromium restore - Don't restore",
  },
  { selector: 'button:has-text("Use")', label: "Google Messages - Use" },
  {
    selector: 'button:has-text("Continue")',
    label: "Google Messages - Continue",
  },
  {
    selector: 'button:has-text("Continuar")',
    label: "Google Messages - Continuar",
  },
  { selector: 'button:has-text("Block")', label: "Notifications - Block" },
  {
    selector: 'button:has-text("Bloquear")',
    label: "Notifications - Bloquear",
  },
  {
    selector: 'button:has-text("No thanks")',
    label: "Notifications - No thanks",
  },
  { selector: 'button:has-text("Reject all")', label: "Cookies - Reject all" },
  {
    selector: 'button:has-text("Rejeitar tudo")',
    label: "Cookies - Rejeitar tudo",
  },
  { selector: '[aria-label="Close dialog"]', label: "Generic close dialog" },
  {
    selector: '[aria-label="Fechar caixa de diálogo"]',
    label: "Generic close PT",
  },
  { selector: '[aria-label="Close"]', label: "Aria Close" },
  { selector: '[aria-label="Fechar"]', label: "Aria Fechar" },
];

/**
 * Fecha modais conhecidos (Chromium + Google Messages). Não lança.
 * Duas passagens para empilhados ("Restaurar" + "Usar…").
 */
export async function dismissAllDialogs(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    for (const { selector, label } of DIALOG_DISMISS_ROWS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 450 }).catch(() => false)) {
          await btn.click({ timeout: 2_000 }).catch(() => {});
          console.log(`[dismissAllDialogs] Dismissed: ${label}`);
          await randomDelay(500, 900);
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const usar = page
        .getByRole("button", { name: "Usar", exact: true })
        .first();
      if (await usar.isVisible({ timeout: 450 }).catch(() => false)) {
        await usar.click({ timeout: 2_000 }).catch(() => {});
        console.log(`[dismissAllDialogs] Dismissed: Google Messages - Usar`);
        await randomDelay(500, 900);
      }
    } catch {
      /* ignore */
    }

    try {
      const usarAqui = page
        .locator("text=Usar Aqui")
        .or(page.getByRole("button", { name: /Usar Aqui/i }))
        .or(page.getByRole("link", { name: /Usar Aqui/i }))
        .first();
      if (await usarAqui.isVisible({ timeout: 450 }).catch(() => false)) {
        await Promise.all([
          page
            .waitForLoadState("domcontentloaded", { timeout: 45_000 })
            .catch(() => {}),
          usarAqui.click({ timeout: 8_000 }),
        ]);
        console.log(
          `[dismissAllDialogs] Dismissed: Google Messages - Usar Aqui`
        );
        await randomDelay(2_000, 3_500);
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Envia mensagem RCS via Google Messages Web.
 * Passos numerados com timeout por etapa — falha lança e o job não fica em loop silencioso.
 */
export async function sendMessage(
  page: Page,
  phone: string,
  message: string,
  localImagePath?: string
): Promise<{ success: boolean; messageType: MessageType; error?: string }> {
  let messageType: MessageType = "rcs";
  try {
    // ── STEP 0 ─────────────────────────────────────────────────────────────
    console.log(`[sendMessage] STEP 0: Resetting page state for ${phone}`);
    await resetPageForSend(page);

    // ── STEP 1 ─────────────────────────────────────────────────────────────
    console.log(`[sendMessage] STEP 1: Navigating to new conversation`);
    await page.goto("https://messages.google.com/web/conversations/new", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await randomDelay(3000, 4000);
    await dismissAllDialogs(page);
    await randomDelay(500, 800);

    // ── STEP 2 ─────────────────────────────────────────────────────────────
    console.log(`[sendMessage] STEP 2: Clicking start chat button`);
    const startBtn = page.locator(Selectors.startChatBtn).first();
    await startBtn.waitFor({ state: "visible", timeout: 20_000 });
    await startBtn.click();
    await randomDelay(2000, 3000);
    await dismissAllDialogs(page);
    await randomDelay(500, 800);

    // ── STEP 3 ─────────────────────────────────────────────────────────────
    console.log(`[sendMessage] STEP 3: Typing phone number: ${phone}`);
    const recipientInput = page.locator(Selectors.recipientInput).first();
    await recipientInput.waitFor({ state: "visible", timeout: 15_000 });
    await recipientInput.click();
    await randomDelay(300, 600);
    await humanType(page, phone);
    await randomDelay(2000, 3000);

    // ── STEP 4 — chip sugerido ou Enter (sem wait infinito num único seletor)
    console.log(`[sendMessage] STEP 4: Selecting contact chip`);
    let contactSelected = false;
    for (const selector of CONTACT_CHIP_SELECTOR_LIST) {
      try {
        const chip = page.locator(selector).first();
        const visible = await chip
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (visible) {
          await chip.click({ timeout: 3_000 });
          console.log(`[sendMessage] STEP 4: Contact selected via ${selector}`);
          contactSelected = true;
          break;
        }
      } catch {
        /* tenta próximo */
      }
    }
    if (!contactSelected) {
      console.log(
        `[sendMessage] STEP 4: Chip not found — pressing Enter to confirm number`
      );
      await page.keyboard.press("Enter");
      await randomDelay(1000, 1500);
    }

    await randomDelay(5000, 6000);

    // Verifica URL da conversa (entre step 4 e step 5)
    try {
      await page.waitForURL(
        (url) =>
          url.href.includes("/conversations/") &&
          !url.href.includes("/conversations/new"),
        { timeout: 15_000 }
      );
    } catch {
      /* continua com checagens abaixo */
    }
    let currentUrl = page.url();
    if (
      !currentUrl.includes("messages.google.com/web/conversations/") ||
      currentUrl.includes("/conversations/new")
    ) {
      console.warn(`[sendMessage] Still on /new — pressing Enter again`);
      await page.keyboard.press("Enter");
      await randomDelay(3000, 4000);
      currentUrl = page.url();
    }
    console.log(`[sendMessage] Conversation URL: ${currentUrl}`);
    if (
      !currentUrl.includes("messages.google.com/web/conversations/") ||
      currentUrl.includes("/authentication")
    ) {
      throw new Error(`Conversation not opened. URL: ${currentUrl}`);
    }
    await dismissAllDialogs(page);
    await randomDelay(400, 800);

    // ── STEP 6: Anexar imagem via paste event ────────────────────────────
    if (localImagePath) {
      console.log(
        `[sendMessage] STEP 6: Attaching image via paste event: ${localImagePath}`
      );

      await page.screenshot({
        path: `/tmp/rcs-step6-before-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
        fullPage: true,
      });

      const ext = localImagePath.toLowerCase().split(".").pop() ?? "png";
      const mimeType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "webp"
              ? "image/webp"
              : "image/png";

      const imageBase64 = fs.readFileSync(localImagePath).toString("base64");

      await page.waitForSelector("mws-autosize-textarea textarea", {
        state: "visible",
        timeout: 15_000,
      });

      const pasteResult = (await page.evaluate(`
        (async () => {
          try {
            const response = await fetch('data:${mimeType};base64,${imageBase64}');
            const blob = await response.blob();
            const file = new File([blob], 'image.${ext}', { type: '${mimeType}' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            const textarea = document.querySelector('mws-autosize-textarea textarea');
            if (!textarea) return { ok: false, reason: 'textarea not found' };
            textarea.focus();
            const event = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true,
            });
            textarea.dispatchEvent(event);
            return { ok: true };
          } catch (err) {
            return { ok: false, reason: String(err) };
          }
        })()
      `)) as { ok: boolean; reason?: string };

      if (!pasteResult.ok) {
        console.warn(
          `[sendMessage] STEP 6: Paste event failed — ${pasteResult.reason}`
        );
        console.warn(`[sendMessage] STEP 6: Continuing without image`);
      } else {
        console.log(
          `[sendMessage] STEP 6: ✅ Paste event dispatched successfully`
        );
      }

      await randomDelay(10_000, 12_000);

      await page.screenshot({
        path: `/tmp/rcs-step6-after-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
        fullPage: true,
      });
      console.log(
        `[sendMessage] STEP 6: Screenshot saved — check preview in image`
      );
    } else {
      console.log(`[sendMessage] STEP 6: No image — skipping`);
    }

    // ── STEP 5: Aguardar campo de mensagem e digitar ─────────────────────
    console.log(`[sendMessage] STEP 5: Waiting for message input`);
    if (!message || !String(message).trim()) {
      throw new Error("STEP 5 failed: empty message body");
    }

    // Screenshot ao entrar no step 5
    await page.screenshot({
      path: `/tmp/rcs-step5-start-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
      fullPage: true,
    });

    // Tenta cada seletor individualmente para identificar qual funciona
    const messageSelectors = [
      "mws-autosize-textarea textarea",
      "mws-message-compose textarea",
      "mws-message-send-bar textarea",
      'textarea[aria-label*="mensagem"]',
      'textarea[aria-label*="message"]',
      'textarea[aria-label*="RCS"]',
      "textarea",
    ];

    let messageInput = null;
    let foundSelector = "";
    for (const sel of messageSelectors) {
      try {
        const el = page.locator(sel).first();
        const visible = await el
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (visible) {
          messageInput = el;
          foundSelector = sel;
          console.log(`[sendMessage] STEP 5: Message input found via: ${sel}`);
          break;
        }
      } catch {
        /* tenta próximo */
      }
    }

    if (!messageInput) {
      await page.screenshot({
        path: `/tmp/rcs-step5-not-found-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
        fullPage: true,
      });
      const allEditable = await page.evaluate(`
        Array.from(document.querySelectorAll('[contenteditable]')).map(function(el) {
          return {
            tag: el.tagName,
            aria: el.getAttribute('aria-label'),
            className: (el.className || '').toString().slice(0, 80),
            visible: el.offsetParent !== null,
          }
        })
      `);
      console.error(
        `[sendMessage] STEP 5: No message input found. Editable elements:`,
        JSON.stringify(allEditable)
      );
      throw new Error("Message input not found after trying all selectors");
    }

    await messageInput.click();
    await randomDelay(400, 700);
    await humanType(page, message);
    await randomDelay(800, 1200);

    await page.screenshot({
      path: `/tmp/rcs-step5-typed-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
      fullPage: true,
    });
    console.log(
      `[sendMessage] STEP 5: ✅ Message typed (${message.length} chars) via "${foundSelector}"`
    );

    // Detecta tipo de mensagem após compose pronto
    messageType = await detectMessageType(page);
    console.log(`[sendMessage] STEP 5: Message type detected: ${messageType}`);

    // ── STEP 7: Enviar mensagem ───────────────────────────────────────────
    console.log(`[sendMessage] STEP 7: Sending message`);

    await page.screenshot({
      path: `/tmp/rcs-step7-before-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
      fullPage: true,
    });
    console.log(`[sendMessage] STEP 7: Screenshot saved (before send)`);

    const sendSelectors = [
      "mws-message-send-button button",
      "mw-message-send-button button",
      'button[aria-label*="Enviar"]',
      'button[aria-label*="Send"]',
      'mw-message-send-bar button[type="submit"]',
      ".send-button button",
    ];

    let sent = false;
    for (const sel of sendSelectors) {
      try {
        const btn = page.locator(sel).first();
        const visible = await btn
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (visible) {
          await btn.click();
          sent = true;
          console.log(`[sendMessage] STEP 7: ✅ Sent via "${sel}"`);
          break;
        }
      } catch {
        /* tenta próximo */
      }
    }

    // Fallback final: Enter
    if (!sent) {
      console.log(
        `[sendMessage] STEP 7: No send button found — pressing Enter`
      );
      await page.keyboard.press("Enter");
      sent = true;
    }

    await randomDelay(3000, 4000);

    await page.screenshot({
      path: `/tmp/rcs-step7-after-${safeScreenshotSlug(phone)}-${Date.now()}.png`,
      fullPage: true,
    });
    console.log(`[sendMessage] STEP 7: Screenshot saved (after send)`);

    // ── STEP 8: Verificar entrega ─────────────────────────────────────────
    console.log(`[sendMessage] STEP 8: Verifying delivery`);
    const pageText = (await page.evaluate("document.body.innerText")) as string;
    const textHasError = DELIVERY_FAILURE_KEYWORDS.some((kw) =>
      pageText.includes(kw)
    );
    const selectorErrorCount = await page
      .locator(DELIVERY_FAILURE_SELECTORS)
      .count();

    if (textHasError || selectorErrorCount > 0) {
      const errorMsg =
        "Google Messages reported delivery failure (message not sent indicator detected)";
      console.error(`[sendMessage] STEP 8: ❌ Delivery failure detected`);
      const shot = failureScreenshotPath(phone);
      try {
        await page.screenshot({ path: shot, fullPage: true });
        console.error(`[sendMessage] Screenshot: ${shot}`);
      } catch {
        /* ignore */
      }
      return { success: false, messageType, error: errorMsg };
    }

    try {
      await page.waitForSelector(SENT_MESSAGE_CONFIRM, {
        state: "visible",
        timeout: 15_000,
      });
      console.log(`[sendMessage] STEP 8: Outgoing bubble confirmed in thread`);
    } catch {
      console.warn(
        `[sendMessage] STEP 8: Could not confirm outgoing message in conversation`
      );
    }

    await randomDelay(1500, 2500);
    console.log(`[sendMessage] ✅ Message sent successfully to ${phone}`);
    return { success: true, messageType };
  } catch (err) {
    const screenshotPath = failureScreenshotPath(phone);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`[sendMessage] ❌ Error for ${phone}: ${String(err)}`);
      console.error(`[sendMessage] Screenshot: ${screenshotPath}`);
    } catch {
      console.error(`[sendMessage] Could not save screenshot for ${phone}`);
    }
    return { success: false, messageType, error: String(err) };
  }
}

/**
 * Detecta se a conversa será enviada como RCS ou SMS.
 */
export async function detectMessageType(page: Page): Promise<MessageType> {
  try {
    const smsIndicator = await page.locator(Selectors.smsBadge).count();
    return smsIndicator > 0 ? "sms" : "rcs";
  } catch {
    return "rcs";
  }
}
