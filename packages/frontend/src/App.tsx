import { useState, useEffect } from 'react'
import { AuthModule } from './components/AuthModule'
import { ContactsModule } from './components/ContactsModule'
import { MessagesModule } from './components/MessagesModule'
import { ScheduleModule } from './components/ScheduleModule'
import { LoginPage } from './pages/LoginPage'
import { GlassCard } from './components/ui/GlassCard'
import { Button } from './components/ui/Button'
import { Badge } from './components/ui/Badge'
import { CampaignSelect } from './components/ui/CampaignSelect'
import { useAuthStore } from './store/authStore'
import { useCampaignStore } from './store/campaignStore'
import { useNumbers } from './store/numbersStore'
import { useApi } from './hooks/useApi'

type Tab = 'auth' | 'contacts' | 'messages' | 'schedule'

interface AppProps {
  embedMode?: boolean
  hideModules?: string[]
  readOnly?: boolean
}

export function App({ embedMode = false, hideModules = [], readOnly = false }: AppProps) {
  const [tab, setTab] = useState<Tab>('auth')
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const { user, setUser } = useAuthStore()
  const { campaigns, setCampaigns, activeCampaign, setActiveCampaign, addCampaign } = useCampaignStore()
  const { setNumbers, setLoading } = useNumbers()
  const { get, post } = useApi()

  useEffect(() => {
    get('/api/auth/me')
      .then((data) => { setUser(data.user); setAuthed(true) })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    get('/api/numbers')
      .then(setNumbers)
      .finally(() => setLoading(false))
    get('/api/campaigns').then(setCampaigns)
  }, [authed])

  async function logout() {
    await post('/api/auth/logout', {})
    setUser(null)
    setAuthed(false)
  }

  async function createCampaign() {
    const name = prompt('Nome da campanha:')
    if (!name) return
    const c = await post('/api/campaigns', { name })
    addCampaign(c)
    setActiveCampaign(c)
    setTab('contacts')
  }

  if (checking) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Carregando...</div>
      </div>
    )
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />
  }

  const visibleTabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'auth',     label: 'Números',    icon: '📱' },
    { key: 'contacts', label: 'Contatos',   icon: '👥' },
    { key: 'messages', label: 'Mensagens',  icon: '💬' },
    { key: 'schedule', label: 'Disparo',    icon: '🚀' },
  ].filter((t) => !hideModules.includes(t.key))

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: embedMode ? 'transparent' : 'var(--bg-base)',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '0 20px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderBottom: '1px solid var(--glass-border)',
          background: 'rgba(13,13,15,0.8)',
          backdropFilter: 'blur(20px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>
          📡 RCS Dispatcher
        </span>

        {/* Segmented control de tabs */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--glass-bg)', borderRadius: 10, padding: 3 }}>
          {visibleTabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: tab === key ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
                transition: 'all var(--transition)',
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Campanhas */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            overflow: 'visible',
          }}
        >
          {campaigns.length > 0 && (
            <CampaignSelect
              campaigns={campaigns}
              value={activeCampaign?.id}
              onChange={(id) => {
                const c = id ? campaigns.find((x) => x.id === id) ?? null : null
                setActiveCampaign(c)
              }}
            />
          )}

          {!readOnly && (
            <Button variant="secondary" size="sm" onClick={createCampaign}>
              + Nova campanha
            </Button>
          )}
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user?.email}</span>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={logout}>
              Sair
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: '24px 20px', maxWidth: 1024, margin: '0 auto', width: '100%' }}>
        {tab === 'auth'     && <AuthModule />}
        {tab === 'contacts' && <ContactsModule />}
        {tab === 'messages' && <MessagesModule />}
        {tab === 'schedule' && <ScheduleModule />}
      </main>
    </div>
  )
}
