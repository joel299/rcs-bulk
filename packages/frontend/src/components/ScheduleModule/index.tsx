import { useState, useEffect, useRef, useCallback } from 'react'
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

interface LogEntry {
  id?: string
  contactName: string
  phone: string
  status: 'sent' | 'failed'
  messageType: string
  dispatchedAt: string
}

export function ScheduleModule() {
  const { activeCampaign, setActiveCampaign } = useCampaignStore()
  const { post, patch, get } = useApi()
  const [progress, setProgress] = useState<CampaignProgress | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [logCursor, setLogCursor] = useState<string | null>(null)
  const [logHasMore, setLogHasMore] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const sseRef = useRef<EventSource | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const seenDispatched = useRef<Set<string>>(new Set())

  // Limpa log ao trocar de campanha
  useEffect(() => {
    setLog([])
    setLogCursor(null)
    setLogHasMore(false)
    seenDispatched.current = new Set()
  }, [activeCampaign?.id])

  useEffect(() => {
    if (!activeCampaign || !['running', 'waiting_window'].includes(activeCampaign.status)) {
      sseRef.current?.close()
      return
    }
    startProgressStream(activeCampaign.id)
    return () => sseRef.current?.close()
  }, [activeCampaign?.id, activeCampaign?.status])

  // Scroll infinito: carrega mais ao atingir sentinel
  const loadMoreLog = useCallback(async () => {
    if (!activeCampaign || logLoading || !logHasMore) return
    setLogLoading(true)
    try {
      const params = logCursor ? `?before=${encodeURIComponent(logCursor)}&limit=20` : '?limit=20'
      const res = await get(`/api/campaigns/${activeCampaign.id}/log${params}`)
      const newEntries: LogEntry[] = (res.data ?? []).filter(
        (e: LogEntry) => !seenDispatched.current.has(e.dispatchedAt)
      )
      newEntries.forEach((e) => seenDispatched.current.add(e.dispatchedAt))
      setLog((prev) => [...prev, ...newEntries])
      setLogCursor(res.nextCursor ?? null)
      setLogHasMore(res.hasMore ?? false)
    } finally {
      setLogLoading(false)
    }
  }, [activeCampaign?.id, logCursor, logHasMore, logLoading])

  // Carrega histórico inicial quando campanha tem status que exibe log
  useEffect(() => {
    if (!activeCampaign) return
    const hasHistory = ['running', 'waiting_window', 'completed', 'cancelled', 'paused'].includes(activeCampaign.status)
    if (!hasHistory) return
    setLogLoading(true)
    get(`/api/campaigns/${activeCampaign.id}/log?limit=20`)
      .then((res) => {
        const entries: LogEntry[] = res.data ?? []
        entries.forEach((e) => seenDispatched.current.add(e.dispatchedAt))
        setLog(entries)
        setLogCursor(res.nextCursor ?? null)
        setLogHasMore(res.hasMore ?? false)
      })
      .catch(() => {})
      .finally(() => setLogLoading(false))
  }, [activeCampaign?.id])

  // IntersectionObserver para scroll infinito
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreLog() },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMoreLog])

  function startProgressStream(id: string) {
    sseRef.current?.close()
    const base = import.meta.env.VITE_API_URL ?? ''
    const es = new EventSource(`${base}/api/campaigns/${id}/progress`)
    es.onmessage = (e) => {
      const data: CampaignProgress & { recentDispatched?: LogEntry[] } = JSON.parse(e.data)
      setProgress(data)

      // Usa recentDispatched (últimas 10) para atualizar o log em tempo real
      const recent: LogEntry[] = data.recentDispatched ?? (data.lastDispatched ? [data.lastDispatched as LogEntry] : [])
      if (recent.length > 0) {
        setLog((prev) => {
          const newEntries = recent.filter((e) => !seenDispatched.current.has(e.dispatchedAt))
          if (newEntries.length === 0) return prev
          newEntries.forEach((e) => seenDispatched.current.add(e.dispatchedAt))
          return [...newEntries, ...prev]
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
    seenDispatched.current = new Set()
  }

  const isRunning = ['running', 'waiting_window'].includes(activeCampaign.status)
  const canStart = ['draft', 'paused', 'scheduled', 'waiting_window'].includes(activeCampaign.status)
  const canRestart = ['cancelled', 'completed'].includes(activeCampaign.status)
  const showLog = log.length > 0 || logLoading

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

        {/* Horário */}
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

      {/* Log de envios — scroll infinito */}
      {showLog && (
        <GlassCard padding="0">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Histórico de Envios</h3>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {log.length} registro{log.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Lista com scroll */}
          <div
            style={{
              maxHeight: 420,
              overflowY: 'auto',
              overflowX: 'hidden',
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--glass-border) transparent',
            }}
          >
            {log.map((entry, i) => (
              <LogRow key={`${entry.dispatchedAt}-${i}`} entry={entry} isLast={i === log.length - 1 && !logHasMore} />
            ))}

            {/* Sentinel para IntersectionObserver */}
            <div ref={sentinelRef} style={{ height: 1 }} />

            {/* Loading indicator */}
            {logLoading && (
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <SpinnerSVG />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Carregando...</span>
              </div>
            )}

            {!logHasMore && !logLoading && log.length > 0 && (
              <div style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', borderTop: '1px solid var(--glass-border)' }}>
                Início do histórico
              </div>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  )
}

function LogRow({ entry, isLast }: { entry: LogEntry; isLast: boolean }) {
  const sent = entry.status === 'sent'
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, padding: '10px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--glass-border)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--glass-bg-hover)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: sent ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)',
        color: sent ? 'var(--accent-green)' : 'var(--accent-red)',
        fontSize: 11, fontWeight: 700,
      }}>
        {sent ? '✓' : '✗'}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }} className="truncate">
          {entry.contactName}
        </span>
        {' '}
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{entry.phone}</span>
      </span>
      {entry.messageType === 'sms' && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
          background: 'rgba(255,214,10,0.15)', color: '#FFD60A', flexShrink: 0,
        }}>
          SMS
        </span>
      )}
      <span style={{ color: 'var(--text-tertiary)', fontSize: 11, flexShrink: 0 }}>
        {entry.dispatchedAt ? new Date(entry.dispatchedAt).toLocaleTimeString('pt-BR') : ''}
      </span>
    </div>
  )
}

function SpinnerSVG() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2"
        strokeDasharray="20" strokeDashoffset="10" />
    </svg>
  )
}
