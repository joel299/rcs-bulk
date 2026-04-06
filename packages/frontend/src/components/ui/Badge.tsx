type BadgeColor = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'orange'

interface BadgeProps {
  color?: BadgeColor
  children: React.ReactNode
  dot?: boolean
}

const colorMap: Record<BadgeColor, { bg: string; text: string }> = {
  green:  { bg: 'rgba(48, 209, 88, 0.18)',  text: '#30D158' },
  red:    { bg: 'rgba(255, 69, 58, 0.18)',   text: '#FF453A' },
  yellow: { bg: 'rgba(255, 214, 10, 0.18)',  text: '#FFD60A' },
  blue:   { bg: 'rgba(10, 132, 255, 0.18)',  text: '#0A84FF' },
  gray:   { bg: 'rgba(255, 255, 255, 0.10)', text: 'rgba(255,255,255,0.55)' },
  orange: { bg: 'rgba(255, 159, 10, 0.18)',  text: '#FF9F0A' },
}

export function Badge({ color = 'gray', children, dot = false }: BadgeProps) {
  const { bg, text } = colorMap[color]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 500,
        background: bg,
        color: text,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: 6, height: 6,
            borderRadius: '50%',
            background: text,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  )
}
