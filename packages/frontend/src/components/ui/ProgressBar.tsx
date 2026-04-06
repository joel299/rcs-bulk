interface ProgressBarProps {
  value: number
  max: number
  label?: string
  color?: string
}

export function ProgressBar({
  value,
  max,
  label,
  color = 'var(--accent-green)',
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {value.toLocaleString('pt-BR')} / {max.toLocaleString('pt-BR')}
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
              ({pct.toFixed(1)}%)
            </span>
          </span>
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: 4,
          background: 'rgba(255,255,255,0.10)',
          borderRadius: 99,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 99,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  )
}
