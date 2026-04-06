import { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const variantStyles: Record<Variant, string> = {
  primary:   'background: var(--accent); color: #fff; border: none;',
  secondary: 'background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--glass-border);',
  ghost:     'background: transparent; color: var(--text-secondary); border: none;',
  danger:    'background: var(--accent-red); color: #fff; border: none;',
}

const sizeStyles: Record<Size, string> = {
  sm: 'padding: 6px 12px; font-size: 13px; border-radius: 8px;',
  md: 'padding: 10px 18px; font-size: 14px; border-radius: 10px;',
  lg: 'padding: 13px 24px; font-size: 15px; border-radius: 12px;',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  style,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyle = `
    display: inline-flex; align-items: center; gap: 8px;
    font-weight: 500; cursor: pointer;
    transition: opacity 0.18s ease, transform 0.12s ease;
    ${variantStyles[variant]}
    ${sizeStyles[size]}
    ${disabled || loading ? 'opacity: 0.5; cursor: not-allowed;' : ''}
  `

  return (
    <button
      disabled={disabled || loading}
      style={{ ...parseInlineStyle(baseStyle), ...style }}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20" strokeDashoffset="10" />
    </svg>
  )
}

function parseInlineStyle(css: string): React.CSSProperties {
  const result: Record<string, string> = {}
  css.split(';').forEach((rule) => {
    const [prop, val] = rule.split(':').map((s) => s.trim())
    if (prop && val) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      result[camelProp] = val
    }
  })
  return result as React.CSSProperties
}
