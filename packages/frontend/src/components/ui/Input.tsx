import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color var(--transition)',
  fontFamily: 'inherit',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, style, ...props }, ref) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        style={{
          ...inputStyle,
          ...(error ? { borderColor: 'var(--accent-red)' } : {}),
          ...style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = error ? 'var(--accent-red)' : 'var(--glass-border)' }}
        {...props}
      />
      {error && <span style={{ fontSize: 12, color: 'var(--accent-red)' }}>{error}</span>}
    </div>
  )
)

Input.displayName = 'Input'

// ── Textarea ────────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, style, ...props }, ref) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        style={{
          ...inputStyle,
          resize: 'vertical',
          minHeight: 120,
          ...(error ? { borderColor: 'var(--accent-red)' } : {}),
          ...style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = error ? 'var(--accent-red)' : 'var(--glass-border)' }}
        {...props}
      />
      {error && <span style={{ fontSize: 12, color: 'var(--accent-red)' }}>{error}</span>}
    </div>
  )
)

Textarea.displayName = 'Textarea'
