/**
 * Seletores do Google Messages Web.
 * Preferência por CSS baseado em componentes web (mw-*, mws-*) para robustez.
 * XPath absoluto quebra quando a interface do Google muda.
 */

/** Ordem de tentativa: chip sugerido após digitar o número (sendMessage STEP 4). */
export const CONTACT_CHIP_SELECTOR_LIST = [
  "mw-contact-chip-button",
  "[data-e2e-contact-chip]",
  ".contact-chip-button",
  "button.contact-chip",
  "mw-chips-input button",
  "mat-chip button",
  ".recipient-chip button",
  "mw-contact-chips-input button",
  "mw-contact-selector-button button",
  "mws-recipient-contact button",
  "[data-e2e-contact-button]",
] as const;

export const Selectors = {
  // Tela de autenticação QR
  qrCode: "mw-qr-code",
  qrCodeImg: "mw-qr-code img",

  // Sessão autenticada
  conversationList: "mws-conversations-list",
  mainNav: "mw-main-nav",

  // ── Fluxo de envio ──────────────────────────────────────────────────────────

  /** FAB "Iniciar chat" */
  startChatBtn: [
    "mw-fab-link a",
    "[data-e2e-start-chat]",
    'a[href*="conversations/new"]',
  ].join(", "),

  /** Campo do destinatário (nova conversa) */
  recipientInput: [
    'input[name="recipient"]',
    'input[aria-label*="destinat"]',
    'input[aria-label*="To"]',
    "mw-contact-chips-input input",
  ].join(", "),

  /** Chip / confirmação de destinatário */
  contactSelectorBtn: CONTACT_CHIP_SELECTOR_LIST.join(", "),

  /** Campo de digitação da mensagem — textarea dentro de mws-autosize-textarea */
  messageInput: [
    "mws-autosize-textarea textarea",
    "mws-message-compose textarea",
    "mws-message-send-bar textarea",
    'textarea[aria-label*="mensagem"]',
    'textarea[aria-label*="message"]',
    "textarea",
  ].join(", "),

  /** Botão enviar */
  sendBtn: [
    "mws-message-send-button button",
    "mw-message-send-button button",
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    'mw-message-send-bar button[type="submit"]',
    ".send-button button",
  ].join(", "),

  /** Input file para anexo (usar depois) */
  fileInput: 'input[type="file"]',

  /** Botão de anexo (usar depois) */
  attachButton: [
    '[data-e2e-picker-button="ATTACHMENT"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Anexar"]',
    "[data-e2e-attach-button]",
  ].join(", "),

  /** Indicadores de tipo de mensagem SMS */
  smsBadge: [
    '[aria-label*="SMS"]',
    ".sms-chip",
    'mw-message-type-indicator[type="sms"]',
  ].join(", "),
} as const;
