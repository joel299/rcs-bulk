/**
 * Seletores do Google Messages Web.
 * Preferência por CSS baseado em componentes web (mw-*, mws-*) para robustez.
 * XPath absoluto quebra quando a interface do Google muda.
 */
export const Selectors = {
  // Tela de autenticação QR
  qrCode: 'mw-qr-code',
  qrCodeImg: 'mw-qr-code img',

  // Sessão autenticada
  conversationList: 'mws-conversations-list',
  mainNav: 'mw-main-nav',

  // ── Fluxo de envio ──────────────────────────────────────────────────────────

  /** FAB "Iniciar chat" — CSS por componente (mais robusto que XPath absoluto) */
  startChatBtn: 'mw-fab-link a, mw-new-conversation-button a, [href*="/conversations/new"]',

  /** Campo do destinatário (nova conversa) */
  recipientInput: 'mw-contact-chips-input input, mw-new-conversation-sub-header input[type="text"], input[aria-label*="phone" i], input[aria-label*="number" i], input[placeholder*="phone" i]',

  /** Chip / botão "Enviar para …" */
  contactSelectorBtn: 'mw-contact-selector-button button, mws-recipient-contact button, [data-e2e-contact-button]',

  /** Botão de envio */
  sendBtn: 'mws-message-send-button button, mw-message-send-button button, [aria-label*="Send" i], [aria-label*="Enviar" i], [data-e2e-send-button]',

  /** Campo de texto da mensagem */
  messageInput: 'mws-message-compose [contenteditable], mws-message-compose textarea, mws-conversation-container [contenteditable]',

  /** Botão de anexo */
  attachButton: 'mws-attach-button button, mws-message-compose [aria-label*="Attach" i], mws-message-compose [aria-label*="Anexar" i]',

  /** Input de arquivo para imagem */
  fileInput: 'mws-message-compose input[type="file"], input[type="file"][accept*="image"]',

  /** Indicadores de tipo de mensagem SMS */
  smsBadge: '.type-indicator--sms, [aria-label*="SMS"], mws-message-type-indicator',
} as const
