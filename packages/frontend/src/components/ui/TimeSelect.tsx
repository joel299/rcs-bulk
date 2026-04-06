import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function parseTime(value: string): { h: string; m: string } {
  const [a, b] = value.split(':')
  const h = (a ?? '09').slice(0, 2).padStart(2, '0')
  const mRaw = (b ?? '00').slice(0, 2).padStart(2, '0')
  const hn = Math.min(23, Math.max(0, parseInt(h, 10) || 0))
  const mn = Math.min(59, Math.max(0, parseInt(mRaw, 10) || 0))
  return { h: String(hn).padStart(2, '0'), m: String(mn).padStart(2, '0') }
}

function formatTime(h: string, m: string) {
  return `${h}:${m}`
}

interface TimeSelectProps {
  value: string
  onChange: (time: string) => void
  disabled?: boolean
  id?: string
}

export function TimeSelect({ value, onChange, disabled, id }: TimeSelectProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { h: hour, m: minute } = useMemo(() => parseTime(value), [value])

  function updatePosition() {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const menuW = 260
    const pad = 12
    const left = Math.max(pad, Math.min(r.left, window.innerWidth - menuW - pad))
    setMenuPos({ top: r.bottom + 6, left })
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !menuRef.current) return
    const id = requestAnimationFrame(() => {
      menuRef.current?.querySelectorAll('.time-select__scroll').forEach((col) => {
        col.querySelector('.time-select__option--active')?.scrollIntoView({ block: 'center' })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [open, hour, minute])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = formatTime(hour, minute)

  const menu =
    open && !disabled ? (
      <div
        ref={menuRef}
        className="time-select__menu"
        role="dialog"
        aria-label="Selecionar horário"
        style={{
          top: menuPos.top,
          left: menuPos.left,
          zIndex: 400,
        }}
      >
        <div className="time-select__col">
          <div className="time-select__col-title">Hora</div>
          <div className="time-select__scroll" role="listbox">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                role="option"
                aria-selected={h === hour}
                className={`time-select__option ${h === hour ? 'time-select__option--active' : ''}`}
                onClick={() => onChange(formatTime(h, minute))}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
        <div className="time-select__divider" aria-hidden />
        <div className="time-select__col">
          <div className="time-select__col-title">Min</div>
          <div className="time-select__scroll" role="listbox">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === minute}
                className={`time-select__option ${m === minute ? 'time-select__option--active' : ''}`}
                onClick={() => onChange(formatTime(hour, m))}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    ) : null

  return (
    <>
      <div className="time-select" ref={rootRef} id={id}>
        <button
          type="button"
          className="time-select__trigger"
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
        >
          <span className="time-select__clock" aria-hidden>
            ◷
          </span>
          <span className="time-select__label">{label}</span>
          <span className={`time-select__chevron ${open ? 'time-select__chevron--open' : ''}`} aria-hidden>
            ▾
          </span>
        </button>
      </div>
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </>
  )
}
