import { useState, useEffect, useRef } from 'react'
import { GlassCard } from '../ui/GlassCard'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'
import { Badge } from '../ui/Badge'
import { TimeSelect } from '../ui/TimeSelect'
import { useCampaignStore } from '../../store/campaignStore'
import { useApi } from '../../hooks/useApi'
import type { Campaign, CampaignProgress, WeekDay } from '@rcs/shared'

const DAYS: { key: WeekDay; label: string }[] = [
  { key: 'MON', label: 'Seg' },
  { key: 'TUE', label: 'Ter' },
  { key: 'WED', label: 'Qua' },
  { key: 'THU', label: 'Qui' },
  { key: 'FRI', label: 'Sex' },
  { key: 'SAT', label: 'Sáb' },
  { key: 'SUN', label: 'Dom' },
]

export function ScheduleModule() {
  const { activeCampaign, setActiveCampaign } = useCampaignStore()
  const { post, patch } = useApi()
  const [progress, setProgress] = useState<CampaignProgress | null>(null)
  const [log, setLog] = useState<CampaignProgress['lastDispatched'][]>([])
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!activeCampaign || !['running', 'waiting_window'].includes(activeCampaign.status)) {
      sseRef.current?.close()
      return
    }
    startProgressStream(activeCampaign.id)
    return () => sseRef.current?.close()
  }, [activeCampaign?.id, activeCampaign?.status])

  function startProgressStream(id: string) {
    sseRef.current?.close()
    const base = import.meta.env.VITE_API_URL ?? ''
    const es = new EventSource(`${base}/api/campaigns/${id}/progress`)
    es.onmessage = (e) => {
      const data: CampaignProgress = JSON.parse(e.data)
      setProgress(data)
      if (data.lastDispatched) {
        // Só adiciona ao log se for um envio novo (dispatchedAt diferente do último)
        setLog((prev) => {
          const last = prev[0]
          if (last?.dispatchedAt === data.lastDispatched!.dispatchedAt) return prev
          return [data.lastDispatched!, ...prev].slice(0, 50)
        })
      }
      if (['completed', 'cancelled'].includes(data.status)) {
        es.close()
        setActiveCampaign({ ...activeCampaign!, status: data.status })
      }
    }
    sseRef.current = es
  }

  if (!activeCampaign) {
    return (
      <GlassCard padding="40px" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
        Selecione ou crie uma campanha primeiro.
      </GlassCard>
    )
  }

  async function updateSchedule(updates: Partial<Campaign>) {
    const updated = await patch(`/api/campaigns/${activeCampaign!.id}`, updates)
    setActiveCampaign(updated)
  }

  async function startCampaign() {
    await post(`/api/campaigns/${activeCampaign!.id}/start`, {})
    const updated = { ...activeCampaign!, status: 'running' as const }
    setActiveCampaign(updated)
    startProgressStream(activeCampaign!.id)
  }

  async function pauseCampaign() {
    await post(`/api/campaigns/${activeCampaign!.id}/pause`, {})
    setActiveCampaign({ ...activeCampaign!, status: 'paused' })
    sseRef.current?.close()
  }

  async function cancelCampaign() {
    if (!confirm('Cancelar a campanha? Esta ação não pode ser desfeita.')) return
    await post(`/api/campaigns/${activeCampaign!.id}/cancel`, {})
    setActiveCampaign({ ...activeCampaign!, status: 'cancelled' })
    sseRef.current?.close()
  }

  async function restartCampaign() {
    if (!confirm('Reiniciar a campanha? Todos os contatos serão enviados novamente.')) return
    await post(`/api/campaigns/${activeCampaign!.id}/restart`, {})
    setActiveCampaign({ ...activeCampaign!, status: 'draft', sentCount: 0, failedCount: 0 })
    setProgress(null)
    setLog([])
  }

  const isRunning = ['running', 'waiting_window'].includes(activeCampaign.status)
  const canStart = ['draft', 'paused', 'scheduled', 'waiting_window'].includes(activeCampaign.status)
  const canRestart = ['cancelled', 'completed'].includes(activeCampaign.status)

  const statusBadge: Record<string, { label: string; color: any }> = {
    draft:           { label: 'Rascunho',          color: 'gray'   },
    scheduled:       { label: 'Agendada',           color: 'blue'   },
    running:         { label: 'Em andamento',       color: 'green'  },
    paused:          { label: 'Pausada',            color: 'yellow' },
    waiting_window:  { label: 'Aguardando janela',  color: 'orange' },
    completed:       { label: 'Concluída',          color: 'green'  },
    cancelled:       { label: 'Cancelada',          color: 'red'    },
  }
  const { label: statusLabel, color: statusColor } = statusBadge[activeCampaign.status] ?? { label: activeCampaign.status, color: 'gray' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Agendamento e Disparo</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {activeCampaign.name}
          </p>
        </div>
        <Badge color={statusColor}>{statusLabel}</Badge>
      </div>

      {/* Progresso */}
      {(isRunning || ['completed', 'cancelled'].includes(activeCampaign.status)) && (
        <GlassCard>
          <ProgressBar
            value={(progress?.sentCount ?? activeCampaign.sentCount) + (progress?.failedCount ?? activeCampaign.failedCount)}
            max={progress?.totalContacts ?? activeCampaign.totalContacts}
            label="Progresso"
          />
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--accent-green)' }}>
              ✓ {progress?.sentCount ?? activeCampaign.sentCount} enviadas
            </span>
            <span style={{ color: 'var(--accent-red)' }}>
              ✗ {progress?.failedCount ?? activeCampaign.failedCount} falhas
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              ◷ {progress?.pendingCount ?? (activeCampaign.totalContacts - activeCampaign.sentCount - activeCampaign.failedCount)} pendentes
            </span>
          </div>
        </GlassCard>
      )}

      {/* Configuração da janela */}
      <GlassCard>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Janela de Envio</h3>

        {/* Dias */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Dias da semana</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {DAYS.map(({ key, label }) => {
              const selected = activeCampaign.scheduleDays.includes(key)
              return (
                <button
                  key={key}
                  disabled={isRunning}
                  onClick={() => {
                    const days = selected
                      ? activeCampaign.scheduleDays.filter((d) => d !== key)
                      : [...activeCampaign.scheduleDays, key]
                    updateSchedule({ scheduleDays: days })
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: selected ? 'var(--accent)' : 'var(--glass-bg)',
                    color: selected ? '#fff' : 'var(--text-secondary)',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: isRunning ? 0.5 : 1,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Horário — seletor customizado (glass), evita picker nativo branco */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', overflow: 'visible' }}>
          <div style={{ overflow: 'visible' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Início</p>
            <TimeSelect
              value={activeCampaign.scheduleStart}
              disabled={isRunning}
              onChange={(scheduleStart) => updateSchedule({ scheduleStart })}
            />
          </div>
          <div style={{ overflow: 'visible' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Fim</p>
            <TimeSelect
              value={activeCampaign.scheduleEnd}
              disabled={isRunning}
              onChange={(scheduleEnd) => updateSchedule({ scheduleEnd })}
            />
          </div>
        </div>

        {/* Intervalo */}
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Intervalo entre mensagens: <strong>{activeCampaign.intervalMinSeconds}s – {activeCampaign.intervalMaxSeconds}s</strong>
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 32 }}>Mín</span>
            <input
              type="range" min={5} max={300} step={5}
              value={activeCampaign.intervalMinSeconds}
              disabled={isRunning}
              onChange={(e) => updateSchedule({ intervalMinSeconds: Number(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 32, textAlign: 'right' }}>{activeCampaign.intervalMinSeconds}s</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 32 }}>Máx</span>
            <input
              type="range" min={5} max={600} step={5}
              value={activeCampaign.intervalMaxSeconds}
              disabled={isRunning}
              onChange={(e) => updateSchedule({ intervalMaxSeconds: Number(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 32, textAlign: 'right' }}>{activeCampaign.intervalMaxSeconds}s</span>
          </div>
        </div>
      </GlassCard>

      {/* Controles */}
      <GlassCard padding="16px">
        <div style={{ display: 'flex', gap: 10 }}>
          {canStart && (
            <Button onClick={startCampaign} icon={<span>▶</span>}>
              Iniciar
            </Button>
          )}
          {canRestart && (
            <Button onClick={restartCampaign} icon={<span>↺</span>}>
              Reiniciar
            </Button>
          )}
          {isRunning && (
            <Button variant="secondary" onClick={pauseCampaign} icon={<span>⏸</span>}>
              Pausar
            </Button>
          )}
          {!['completed', 'cancelled', 'draft'].includes(activeCampaign.status) && (
            <Button variant="danger" onClick={cancelCampaign} icon={<span>⏹</span>}>
              Cancelar
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Log de envios */}
      {log.length > 0 && (
        <GlassCard>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Últimos Envios</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {log.map((entry, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontSize: 13, padding: '6px 0',
                  borderBottom: i < log.length - 1 ? '1px solid var(--glass-border)' : 'none',
                }}
              >
                <span style={{ color: entry?.status === 'sent' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 12 }}>
                  {entry?.status === 'sent' ? '✓' : '✗'}
                </span>
                <span style={{ flex: 1 }} className="truncate">
                  {entry?.contactName} <span style={{ color: 'var(--text-tertiary)' }}>{entry?.phone}</span>
                </span>
                {entry?.messageType === 'sms' && (
                  <Badge color="yellow">SMS</Badge>
                )}
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11, flexShrink: 0 }}>
                  {entry?.dispatchedAt ? new Date(entry.dispatchedAt).toLocaleTimeString('pt-BR') : ''}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
