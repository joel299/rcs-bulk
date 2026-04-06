import { useState } from 'react'
import { GlassCard } from '../ui/GlassCard'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { AddNumberModal } from './AddNumberModal'
import { useNumbers } from '../../store/numbersStore'
import { useApi } from '../../hooks/useApi'
import type { RcsNumber } from '@rcs/shared'

export function AuthModule() {
  const { numbers, loading, deleteNumber } = useNumbers()
  const { del } = useApi()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Números Remetentes</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {numbers.length} número{numbers.length !== 1 ? 's' : ''} cadastrado{numbers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} icon={<PlusIcon />}>
          Adicionar Número
        </Button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          Carregando...
        </div>
      )}

      {!loading && numbers.length === 0 && (
        <GlassCard padding="40px" style={{ textAlign: 'center' }}>
          <PhoneIcon />
          <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
            Nenhum número cadastrado. Adicione um para começar.
          </p>
        </GlassCard>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {numbers.map((n) => (
          <NumberCard
            key={n.id}
            number={n}
            onDelete={async () => {
              await del(`/api/numbers/${n.id}`)
              deleteNumber(n.id)
            }}
          />
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {showAdd && <AddNumberModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function NumberCard({ number, onDelete }: { number: RcsNumber; onDelete: () => void }) {
  const [restarting, setRestarting] = useState(false)
  const { post } = useApi()

  const statusConfig: Record<string, { label: string; color: any; dot: boolean }> = {
    authenticated:  { label: 'Online',        color: 'green',  dot: true },
    pending_auth:   { label: 'Aguardando QR', color: 'yellow', dot: true },
    disconnected:   { label: 'Desconectado',  color: 'red',    dot: false },
    paused:         { label: 'Pausado',       color: 'gray',   dot: false },
  }

  const { label, color, dot } = statusConfig[number.status] ?? { label: number.status, color: 'gray', dot: false }

  async function handleReopen() {
    setRestarting(true)
    try {
      await post(`/api/numbers/${number.id}/restart`, {})
    } finally {
      setRestarting(false)
    }
  }

  return (
    <GlassCard
      padding="16px 20px"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        transition: 'background var(--transition)',
      }}
    >
      <div
        style={{
          width: 44, height: 44,
          borderRadius: '50%',
          background: 'var(--glass-bg-hover)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          fontSize: 20,
        }}
      >
        📱
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }} className="truncate">
          {number.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {number.phoneLabel} · {number.messagesSentToday}/{number.maxMessagesPerHour} hoje
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge color={color} dot={dot}>{label}</Badge>

        {number.status === 'pending_auth' && (
          <button
            onClick={handleReopen}
            disabled={restarting}
            title="Reabrir janela do Google Messages"
            style={{
              background: 'none',
              border: '1px solid var(--glass-border)',
              borderRadius: 6,
              color: restarting ? 'var(--text-tertiary)' : 'var(--accent)',
              fontSize: 12,
              cursor: restarting ? 'not-allowed' : 'pointer',
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}
          >
            {restarting ? (
              <>
                <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Abrindo...
              </>
            ) : (
              <>↻ Abrir QR</>
            )}
          </button>
        )}

        <Button variant="ghost" size="sm" onClick={onDelete} style={{ color: 'var(--accent-red)' }}>
          <TrashIcon />
        </Button>
      </div>
    </GlassCard>
  )
}

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const PhoneIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto', display: 'block' }}>
    <rect width="40" height="40" rx="20" fill="rgba(255,255,255,0.06)" />
    <path d="M14 12h12a2 2 0 012 2v12a2 2 0 01-2 2H14a2 2 0 01-2-2V14a2 2 0 012-2z" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
    <circle cx="20" cy="27" r="1" fill="rgba(255,255,255,0.3)" />
  </svg>
)

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M3 4h9M6 4V3h3v1M5 7v5M10 7v5M4 4l.7 8h5.6L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
