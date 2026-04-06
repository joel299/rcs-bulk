/**
 * Seletores do Google Messages Web.
 * CSS selectors apenas — XPath não pode ser combinado por vírgula com CSS no Playwright.
 */
export const Selectors = {
  // Tela de autenticação QR
  qrCode: 'mw-qr-code',
  qrCodeImg: 'mw-qr-code img',

  // Sessão autenticada
  conversationList: 'mws-conversations-list',
  mainNav: 'mw-main-nav',

  // ── Fluxo de envio ──────────────────────────────────────────────────────────

  /** FAB "Iniciar chat" — XPath exato fornecido pelo usuário */
  startChatBtn: 'xpath=/html/body/mw-app/mw-bootstrap/div/main/mw-main-container/div/mw-main-nav/div/mw-fab-link/a',

  /** Campo do destinatário (nova conversa) */
  recipientInput: 'xpath=/html/body/mw-app/mw-bootstrap/div/main/mw-main-container/div/mw-new-conversation-container/mw-new-conversation-sub-header/div/div[1]/div[2]/mw-contact-chips-input/div/div/input',

  /** Chip / botão "Enviar para …" */
  contactSelectorBtn: 'xpath=/html/body/mw-app/mw-bootstrap/div/main/mw-main-container/div/mw-new-conversation-container/div/mw-contact-selector-button/button',

  /** Botão de envio */
  sendBtn: 'xpath=/html/body/mw-app/mw-bootstrap/div/main/mw-main-container/div/mw-conversation-container/div/div[1]/div/mws-message-compose/div/div[2]/div/div/mws-message-send-button/div/mw-message-send-button/button',

  /** Campo de texto da mensagem */
  messageInput: 'mws-message-compose [contenteditable], mws-message-compose textarea, mws-conversation-container [contenteditable]',

  /** Botão de anexo */
  attachButton: 'mws-message-compose mws-attach-button button, [data-tooltip="Attach"], [aria-label*="Anexar"], [aria-label*="Attach"]',

  /** Input de arquivo para imagem */
  fileInput: 'mws-message-compose input[type="file"], input[type="file"][accept*="image"]',

  /** Indicadores de tipo de mensagem SMS */
  smsBadge: '.type-indicator--sms, [aria-label*="SMS"], mws-message-type-indicator',
} as const
