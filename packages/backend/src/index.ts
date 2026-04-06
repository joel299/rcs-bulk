import { config } from 'dotenv'
config()
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { authRouter } from './routes/auth'
import { numbersRouter } from './routes/numbers'
import { campaignsRouter } from './routes/campaigns'
import { contactsRouter } from './routes/contacts'
import { variationsRouter } from './routes/variations'
import { assetsRouter } from './routes/assets'
import { storageService } from './services/StorageService'
import { sessionManager } from './services/SessionManager'
import { browserPool } from './services/BrowserPool'
import './workers/dispatchWorker'
import './workers/keepaliveWorker'

const app = express()

app.use(helmet({ contentSecurityPolicy: false }))
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
  /localhost:\d+/,
  /\.vercel\.app$/,
]
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}))
app.use(cookieParser(process.env.COOKIE_SECRET))
app.use(express.json({ limit: '2mb' }))

// Serve frontend estático em produção
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('/app/public'))
}

// Rotas API
app.use('/api/auth', authRouter)
app.use('/api/numbers', numbersRouter)
app.use('/api/campaigns', campaignsRouter)
app.use('/api/campaigns/:id/contacts', contactsRouter)
app.use('/api/campaigns/:id/variations', variationsRouter)
app.use('/api/assets', assetsRouter)

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// Embed via iframe
app.get('/embed', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile('/app/public/index.html')
  } else {
    res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/embed?${req.query.toString()}`)
  }
})

// 404 catch-all para SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (process.env.NODE_ENV === 'production') {
    res.sendFile('/app/public/index.html')
  } else {
    res.status(404).json({ error: 'Not found' })
  }
})

const PORT = Number(process.env.PORT ?? 3000)

async function start() {
  // Inicializa banco e storage
  const { db } = await import('./db/client')
  await db.query('SELECT 1')

  await storageService.ensureBucket()

  // Restaura sessões ativas
  await sessionManager.restoreActiveSessions()

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down...')
  await browserPool.closeAll()
  process.exit(0)
})

// Evita que erros não tratados derrubem o processo
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason)
})
