import { useState, FormEvent } from 'react'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuthStore } from '../store/authStore'
import { useApi } from '../hooks/useApi'

interface LoginPageProps {
  onSuccess: () => void
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setUser } = useAuthStore()
  const { post } = useApi()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body = mode === 'login' ? { email, password } : { orgName, email, password }
      const data = await post(endpoint, body)
      setUser(data.user)
      onSuccess()
    } catch (err: any) {
      setError(err.message ?? 'Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'radial-gradient(ellipse at top, #1a1a2e 0%, var(--bg-base) 60%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>RCS Dispatcher</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>
            Disparos RCS em escala via Google Messages
          </p>
        </div>

        <GlassCard padding="28px">
          <div style={{ display: 'flex', marginBottom: 24, background: 'var(--glass-bg)', borderRadius: 10, padding: 3 }}>
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '8px', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  background: mode === m ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                  transition: 'all var(--transition)',
                }}
              >
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'register' && (
              <Input
                label="Nome da organização"
                placeholder="Minha Empresa"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            )}
            <Input
              label="Email"
              type="email"
              placeholder="você@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Senha"
              type="password"
              placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />

            {error && (
              <p style={{ fontSize: 13, color: 'var(--accent-red)', textAlign: 'center' }}>
                {error}
              </p>
            )}

            <Button
              type="submit"
              loading={loading}
              disabled={!email || !password || (mode === 'register' && !orgName)}
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
            >
              {mode === 'login' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
