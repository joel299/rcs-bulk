import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { GlassCard } from '../ui/GlassCard'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Input'
import { PhonePreview } from '../PhonePreview'
import { useCampaignStore } from '../../store/campaignStore'
import { useApi } from '../../hooks/useApi'
import type { MessageVariation } from '@rcs/shared'

export function MessagesModule() {
  const { activeCampaign, variations, setVariations } = useCampaignStore()
  const { get, post, patch, del } = useApi()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [previewVariation, setPreviewVariation] = useState<MessageVariation | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!activeCampaign) return
    get(`/api/campaigns/${activeCampaign.id}/variations`).then(setVariations)
  }, [activeCampaign?.id])

  useEffect(() => {
    if (variations.length > 0 && !previewVariation) {
      setPreviewVariation(variations[0])
    }
  }, [variations])

  if (!activeCampaign) {
    return (
      <GlassCard padding="40px" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
        Selecione ou crie uma campanha primeiro.
      </GlassCard>
    )
  }

  async function addVariation() {
    const v = await post(`/api/campaigns/${activeCampaign!.id}/variations`, {
      body: 'Olá, {{nome}}! ',
      sortOrder: variations.length,
    })
    setVariations([...variations, v])
    setEditingId(v.id)
    setPreviewVariation(v)
  }

  async function updateVariation(id: string, updates: Partial<MessageVariation>) {
    const updated = await patch(`/api/campaigns/${activeCampaign!.id}/variations/${id}`, updates)
    setVariations(variations.map((v) => (v.id === id ? updated : v)))
    if (previewVariation?.id === id) setPreviewVariation(updated)
  }

  async function deleteVariation(id: string) {
    await del(`/api/campaigns/${activeCampaign!.id}/variations/${id}`)
    const newVars = variations.filter((v) => v.id !== id)
    setVariations(newVars)
    if (previewVariation?.id === id) setPreviewVariation(newVars[0] ?? null)
  }

  async function uploadImage(id: string, file: File) {
    setUploading(true)
    try {
      const base = import.meta.env.VITE_API_URL ?? ''
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${base}/api/assets/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
      const data = await res.json()
      await updateVariation(id, { imageUrl: data.url })
    } catch (err) {
      console.error('[uploadImage]', err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>Mensagens</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              Use o botão <strong>{'{ }'}</strong> para inserir variável no cursor
            </p>
          </div>
          {variations.length < 5 && (
            <Button variant="secondary" size="sm" onClick={addVariation}>
              + Nova Variação
            </Button>
          )}
        </div>

        {variations.length === 0 && (
          <GlassCard padding="32px" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Nenhuma variação criada. Clique em "+ Nova Variação" para começar.
            </p>
          </GlassCard>
        )}

        {variations.map((v, idx) => (
          <VariationCard
            key={v.id}
            variation={v}
            index={idx}
            isEditing={editingId === v.id}
            isPreview={previewVariation?.id === v.id}
            onEdit={() => { setEditingId(v.id); setPreviewVariation(v) }}
            onPreview={() => setPreviewVariation(v)}
            onUpdate={(updates) => updateVariation(v.id, updates)}
            onBodyChange={(body) => {
              if (previewVariation?.id === v.id) {
                setPreviewVariation((prev) => prev ? { ...prev, body } : prev)
              }
            }}
            onDelete={() => deleteVariation(v.id)}
            onImageUpload={(file) => uploadImage(v.id, file)}
            uploading={uploading}
          />
        ))}
      </div>

      {/* Preview — largura mínima para 375px lógicos + moldura (encolhe com aspect-ratio) */}
      <div style={{ width: 'min(100%, 420px)', flexShrink: 0, minWidth: 0 }}>
        <PhonePreview variation={previewVariation} />
      </div>
    </div>
  )
}

interface VariationCardProps {
  variation: MessageVariation
  index: number
  isEditing: boolean
  isPreview: boolean
  onBodyChange: (body: string) => void
  onEdit: () => void
  onPreview: () => void
  onUpdate: (u: Partial<MessageVariation>) => void
  onDelete: () => void
  onImageUpload: (f: File) => void
  uploading: boolean
}

function VariationCard({
  variation, index, isEditing, isPreview,
  onEdit, onPreview, onUpdate, onBodyChange, onDelete, onImageUpload, uploading,
}: VariationCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localBody, setLocalBody] = useState(variation.body)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Posição do cursor após inserir variável
  const pendingCursorRef = useRef<number | null>(null)

  // Sincroniza apenas quando muda de variação (id diferente)
  const prevIdRef = useRef(variation.id)
  useEffect(() => {
    if (prevIdRef.current !== variation.id) {
      prevIdRef.current = variation.id
      setLocalBody(variation.body)
    }
  }, [variation.id, variation.body])

  // Restaura posição do cursor após re-render causado por inserção de variável
  useLayoutEffect(() => {
    if (pendingCursorRef.current !== null && textareaRef.current) {
      const pos = pendingCursorRef.current
      textareaRef.current.selectionStart = pos
      textareaRef.current.selectionEnd = pos
      pendingCursorRef.current = null
    }
  })

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setLocalBody(val)
    onBodyChange(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onUpdate({ body: val }), 600)
  }

  function insertVariable() {
    const ta = textareaRef.current
    const variable = '{{nome}}'
    if (!ta) {
      const newVal = localBody + variable
      setLocalBody(newVal)
      onBodyChange(newVal)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onUpdate({ body: newVal }), 600)
      return
    }
    const start = ta.selectionStart ?? localBody.length
    const end = ta.selectionEnd ?? localBody.length
    const newVal = localBody.slice(0, start) + variable + localBody.slice(end)
    pendingCursorRef.current = start + variable.length
    setLocalBody(newVal)
    onBodyChange(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onUpdate({ body: newVal }), 600)
    ta.focus()
  }

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    onImageUpload(file)
  }, [onImageUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith('image/'))
    if (imageItem) {
      const file = imageItem.getAsFile()
      if (file) handleFile(file)
    }
  }, [handleFile])

  return (
    <GlassCard
      padding="16px"
      style={{ outline: isPreview ? '1px solid var(--accent)' : 'none', cursor: 'pointer' }}
      onClick={onEdit}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
          Variação {index + 1}
          {isPreview && <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: 11 }}>● preview</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Botão inserir {{nome}} */}
          <button
            onClick={(e) => { e.stopPropagation(); insertVariable() }}
            title="Inserir {{nome}} na posição do cursor"
            style={{
              background: 'rgba(10,132,255,0.12)',
              border: '1px solid rgba(10,132,255,0.3)',
              borderRadius: 6,
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              letterSpacing: 0.3,
              transition: 'background 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(10,132,255,0.22)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(10,132,255,0.12)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(10,132,255,0.3)'
            }}
          >
            {'{ } '}nome
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      </div>

      <Textarea
        ref={textareaRef}
        value={localBody}
        onChange={handleBodyChange}
        onPaste={handlePaste}
        placeholder="Digite sua mensagem..."
        style={{ minHeight: 80 }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Área de imagem */}
      <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
        {variation.imageUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={variation.imageUrl}
              alt=""
              style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--glass-border)' }}
            />
            <button
              onClick={() => onUpdate({ imageUrl: null })}
              style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 13 }}
            >
              Remover imagem
            </button>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--glass-border)'}`,
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: dragging ? 'rgba(10,132,255,0.06)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
            {uploading ? (
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Enviando imagem...</span>
            ) : (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '5px 12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Adicionar imagem
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  ou arraste / cole (Ctrl+V)
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  )
}
