import { useState, useRef, useEffect } from 'react'

export interface CampaignOption {
  id: string
  name: string
}

interface CampaignSelectProps {
  campaigns: CampaignOption[]
  value: string | null | undefined
  onChange: (campaignId: string | null) => void
  placeholder?: string
}

export function CampaignSelect({
  campaigns,
  value,
  onChange,
  placeholder = 'Selecionar campanha',
}: CampaignSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const active = campaigns.find((c) => c.id === value)
  const label = active?.name ?? placeholder

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
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

  return (
    <div className="campaign-select" ref={rootRef}>
      <button
        type="button"
        className="campaign-select__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`campaign-select__label ${active ? '' : 'campaign-select__label--placeholder'}`}>
          {label}
        </span>
        <span className={`campaign-select__chevron ${open ? 'campaign-select__chevron--open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="campaign-select__menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={`campaign-select__option ${!value ? 'campaign-select__option--active' : ''}`}
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            {placeholder}
          </button>
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === value}
              className={`campaign-select__option ${c.id === value ? 'campaign-select__option--active' : ''}`}
              onClick={() => {
                onChange(c.id)
                setOpen(false)
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
