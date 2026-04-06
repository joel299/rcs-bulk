import { useState, useRef, useEffect } from 'react'
import { GlassCard } from '../ui/GlassCard'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useCampaignStore } from '../../store/campaignStore'
import { useApi } from '../../hooks/useApi'

export function ContactsModule() {
  const { activeCampaign, contacts, setContacts, updateCampaign } = useCampaignStore()
  const { get, post } = useApi()
  const [manualName, setManualName] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [preview, setPreview] = useState<any[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!activeCampaign) return
    get(`/api/campaigns/${activeCampaign.id}/contacts`).then((res) => {
      setContacts(res.data ?? [])
    }).catch(() => {})
  }, [activeCampaign?.id])

  if (!activeCampaign) {
    return (
      <GlassCard padding="40px" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
        Selecione ou crie uma campanha primeiro.
      </GlassCard>
    )
  }

  const campaignId = activeCampaign.id

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    const lines = text.trim().split('\n').slice(0, 6)
    const headers = lines[0].split(',').map((h) => h.trim())
    const rows = lines.slice(1).map((l) => {
      const vals = l.split(',').map((v) => v.trim())
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
    })
    setPreview(rows)
  }

  async function confirmUpload() {
    if (!fileRef.current?.files?.[0]) return
    setUploading(true)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', fileRef.current.files[0])

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/contacts/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await res.json()
      setUploadResult(data)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      // Recarrega lista e atualiza total
      const fresh = await get(`/api/campaigns/${campaignId}/contacts`)
      setContacts(fresh.data ?? [])
      updateCampaign(campaignId, { totalContacts: fresh.total ?? 0 })
    } finally {
      setUploading(false)
    }
  }

  async function addManual() {
    if (!manualPhone) return
    setAdding(true)
    try {
      const contact = await post(`/api/campaigns/${campaignId}/contacts`, {
        name: manualName || undefined,
        phone: manualPhone,
      })
      setContacts([...contacts, contact])
      updateCampaign(campaignId, { totalContacts: (activeCampaign.totalContacts ?? 0) + 1 })
      setManualName('')
      setManualPhone('')
    } catch (err: any) {
      alert(err.message ?? 'Erro ao adicionar contato')
    } finally {
      setAdding(false)
    }
  }

  function downloadTemplate() {
    window.open(`/api/campaigns/${campaignId}/contacts/template`, '_blank')
  }

  const statusColor: Record<string, string> = {
    pending:  'var(--text-tertiary)',
    sent:     'var(--accent-green)',
    failed:   'var(--accent-red)',
    skipped:  'var(--text-secondary)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Contatos</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
          Campanha: <strong>{activeCampaign.name}</strong>
        </p>
      </div>

      {/* Upload CSV */}
      <GlassCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Upload CSV</h3>
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            Baixar modelo
          </Button>
        </div>

        <label
          style={{
            display: 'block',
            border: '2px dashed var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleCSV}
            style={{ display: 'none' }}
          />
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Clique para selecionar ou arraste o CSV
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            Colunas: <code>nome, telefone</code>
          </p>
        </label>

        {preview && preview.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Preview (primeiras linhas):
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {Object.keys(preview[0]).map((h) => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val: any, j) => (
                        <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid var(--glass-border)' }}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <Button onClick={confirmUpload} loading={uploading}>
                Importar contatos
              </Button>
              <Button variant="secondary" onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = '' }}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {uploadResult && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(48,209,88,0.10)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--accent-green)' }}>
            {uploadResult.imported} contatos importados · {uploadResult.skipped} ignorados
          </div>
        )}
      </GlassCard>

      {/* Adicionar manualmente */}
      <GlassCard>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Adicionar Manualmente</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Nome (opcional)"
              placeholder="João Silva"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              label="Telefone (formato internacional)"
              placeholder="+5548999990001"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
            />
          </div>
          <Button onClick={addManual} disabled={!manualPhone} loading={adding}>
            Adicionar
          </Button>
        </div>
      </GlassCard>

      {/* Resumo */}
      <div style={{ padding: '12px 16px', background: 'rgba(10,132,255,0.08)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--accent)' }}>
        Total: <strong>{activeCampaign.totalContacts ?? contacts.length}</strong> contatos nesta campanha
      </div>

      {/* Lista de contatos */}
      {contacts.length > 0 && (
        <GlassCard padding="0">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--glass-border)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Lista de Contatos</h3>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {contacts.map((c, i) => (
              <div
                key={c.id ?? i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px',
                  borderBottom: i < contacts.length - 1 ? '1px solid var(--glass-border)' : 'none',
                  fontSize: 13,
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'var(--glass-bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, flexShrink: 0,
                }}>
                  👤
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }} className="truncate">
                    {c.name || c.phone}
                  </div>
                  {c.name && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {c.phone}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: statusColor[c.status] ?? 'var(--text-tertiary)', flexShrink: 0 }}>
                  {c.status === 'pending' ? 'Pendente' : c.status === 'sent' ? 'Enviado' : c.status === 'failed' ? 'Falhou' : c.status}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
