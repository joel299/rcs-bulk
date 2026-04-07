import { renderTemplate } from '@rcs/shared'
import type { MessageVariation } from '@rcs/shared'

/** Viewport lógico “Universal Safe” (ex.: iPhone 8 / SE) — proporção da área útil */
export const PHONE_SAFE_W = 375
export const PHONE_SAFE_H = 667

interface PhonePreviewProps {
  variation: MessageVariation | null
}

export function PhonePreview({ variation }: PhonePreviewProps) {
  const message = variation
    ? renderTemplate(variation.body, { nome: 'João', telefone: '+5548999990001' })
    : ''

  const hasContent = variation && (message || variation.imageUrl)

  return (
    <div className="phone-preview">
      <p className="phone-preview__caption">Preview</p>
      <p className="phone-preview__spec" aria-hidden>
        {PHONE_SAFE_W} × {PHONE_SAFE_H} · safe area
      </p>

      <div className="phone-preview__device">
        <div className="phone-preview__notch" aria-hidden />

        <div className="phone-preview__screen">
          <div className="phone-preview__status">
            <span>09:41</span>
            <span>●●●</span>
          </div>

          <div className="phone-preview__messages">
            {hasContent && variation ? (
              <div className="phone-preview__bubble">
                {variation.imageUrl && (
                  <img src={variation.imageUrl} alt="" className="phone-preview__bubble-img" />
                )}
                {message && (
                  <span className="phone-preview__bubble-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {message}
                  </span>
                )}
              </div>
            ) : (
              <div className="phone-preview__empty">Escreva uma mensagem para ver o preview</div>
            )}
          </div>

          <div className="phone-preview__composer">Mensagem RCS...</div>
        </div>

        <div className="phone-preview__home-bar" aria-hidden />
      </div>

      <div className="phone-preview__footer">
        {variation?.imageUrl ? '📷 Com mídia · RCS' : variation ? '💬 Texto · RCS' : ''}
      </div>
    </div>
  )
}
