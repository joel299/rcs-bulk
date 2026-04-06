import { useState, useEffect, useRef } from 'react'
import { GlassCard } from '../ui/GlassCard'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useNumbers } from '../../store/numbersStore'
import { useApi } from '../../hooks/useApi'

interface AddNumberModalProps {
  onClose: () => void
}

type Step = 'form' | 'qr' | 'success'

export function AddNumberModal({ onClose }: AddNumberModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [phoneLabel, setPhoneLabel] = useState('')
  const [numberId, setNumberId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState('')
  const [currentNumberId, setCurrentNumberId] = useState<string | null>(null)
  const { addNumber, updateNumber, setNumbers } = useNumbers()
  const { post, get } = useApi()
  const sseRef = useRef<EventSource | null>(null)

  async function handleCreate() {
    setLoading(true)
    setError('')
    try {
      const data = await post('/api/numbers', { name, phoneLabel })
      setNumberId(data.id)
      setCurrentNumberId(data.id)
      addNumber(data)
      setStep('qr')
      startQrStream(data.id)
    } catch (err: any) {
      setError(err.message ?? 'Erro ao criar número')
    } finally {
      setLoading(false)
    }
  }

  function startQrStream(id: string) {
    sseRef.current?.close()
    setQrImage(null)
    const base = import.meta.env.VITE_API_URL ?? ''
    const es = new EventSource(`${base}/api/numbers/${id}/qr`)

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'authenticated') {
        es.close()
        // Atualiza status na lista sem precisar recarregar a página
        if (id) updateNumber(id, { status: 'authenticated' })
        setStep('success')
      }
    }

    sseRef.current = es
  }

  async function restartQr() {
    if (!currentNumberId) return
    setRestarting(true)
    setQrImage(null)
    try {
      await post(`/api/numbers/${currentNumberId}/restart`, {})
      startQrStream(currentNumberId)
    } finally {
      setRestarting(false)
    }
  }

  useEffect(() => {
    return () => sseRef.current?.close()
  }, [])

  async function handleClose() {
    sseRef.current?.close()
    // Recarrega lista do servidor para garantir estado consistente
    try {
      const fresh = await get('/api/numbers')
      setNumbers(fresh)
    } catch {}
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <GlassCard
        padding="28px"
        style={{ width: '100%', maxWidth: 420, position: 'relative' }}
      >
        <button
          onClick={handleClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20,
          }}
        >
          ×
        </button>

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>Adicionar Número</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Dê um nome e informe o número para autenticar no Google Messages.
              </p>
            </div>
            <Input
              label="Nome da caixa"
              placeholder="Ex: Mormaii Vendas"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Telefone (label)"
              placeholder="+5548999990001"
              value={phoneLabel}
              onChange={(e) => setPhoneLabel(e.target.value)}
            />
            {error && (
              <p style={{ fontSize: 13, color: 'var(--accent-red)' }}>{error}</p>
            )}
            <Button
              loading={loading}
              disabled={!name || !phoneLabel}
              onClick={handleCreate}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Gerar QR Code
            </Button>
          </div>
        )}

        {step === 'qr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>Aguardando autenticação</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Uma janela do Google Messages foi aberta no servidor. Escaneie o QR Code com o celular.
              </p>
            </div>

            <div
              style={{
                width: 220, height: 180,
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 12,
                border: '1px solid var(--glass-border)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 12,
                padding: 16,
              }}
            >
              <div style={{
                width: 40, height: 40, border: '3px solid #e0e0e0',
                borderTopColor: '#0A84FF', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0, textAlign: 'center' }}>
                Aguardando pareamento...
              </p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 11, margin: 0, textAlign: 'center' }}>
                Escaneie o QR na janela que abriu no servidor
              </p>
            </div>

            <button
              onClick={restartQr}
              disabled={restarting}
              style={{
                marginTop: 4,
                background: 'none',
                border: '1px solid var(--glass-border)',
                borderRadius: 8,
                color: restarting ? 'var(--text-tertiary)' : 'var(--accent)',
                fontSize: 13,
                cursor: restarting ? 'not-allowed' : 'pointer',
                padding: '6px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {restarting ? (
                <>
                  <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Reiniciando...
                </>
              ) : (
                <>↻ Reabrir janela do Google Messages</>
              )}
            </button>
          </div>
        )}

        {step === 'success' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>Número Autenticado!</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                O número está pronto para enviar mensagens.
              </p>
            </div>
            <Button onClick={handleClose} style={{ width: '100%', justifyContent: 'center' }}>
              Concluir
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
