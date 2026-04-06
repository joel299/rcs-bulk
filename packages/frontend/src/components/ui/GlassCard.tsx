import { HTMLAttributes } from 'react'

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: string
}

export function GlassCard({ children, className = '', style, padding = '20px', ...props }: GlassCardProps) {
  return (
    <div
      className={`glass-card ${className}`}
      style={{ padding, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}
