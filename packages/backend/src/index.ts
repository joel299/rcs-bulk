import { config } from 'dotenv'
config()
import http from 'http'
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
import { cleanDispatchQueueOnStartup } from './services/DispatchQueue'
import { dispatchWorker } from './workers/dispatchWorker'
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

let httpServer: http.Server | null = null
let shutdownInProgress = false

async function shutdown(signal: string) {
  if (shutdownInProgress) {
    console.log(`[Server] Shutdown already in progress (got ${signal})`)
    return
  }
  shutdownInProgress = true
  console.log(`[Server] Received ${signal}, shutting down gracefully...`)

  try {
    await dispatchWorker.close()
    console.log('[Server] Dispatch worker closed')
  } catch (err) {
    console.warn('[Server] dispatchWorker.close:', err)
  }

  try {
    await sessionManager.closeAll()
    console.log('[Server] SessionManager closed all sessions')
  } catch (err) {
    console.warn('[Server] sessionManager.closeAll:', err)
  }

  try {
    await browserPool.closeAll()
    console.log('[Server] Browser pool closed')
  } catch (err) {
    console.warn('[Server] browserPool.closeAll:', err)
  }

  if (httpServer) {
    httpServer.close(() => {
      console.log('[Server] HTTP server closed')
      process.exit(0)
    })
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout')
      process.exit(1)
    }, 10_000).unref()
  } else {
    process.exit(0)
  }
}

async function start() {
  const { db } = await import('./db/client')
  await db.query('SELECT 1')

  await storageService.ensureBucket()

  await cleanDispatchQueueOnStartup()

  await sessionManager.restoreActiveSessions()

  httpServer = app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err)
  void shutdown('uncaughtException')
})
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason)
})
