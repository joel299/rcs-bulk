import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
import { requireAuth } from '../middleware/auth'
import { sessionManager } from '../services/SessionManager'

export const numbersRouter = Router()
numbersRouter.use(requireAuth)

const createSchema = z.object({
  name: z.string().min(1),
  phoneLabel: z.string().min(5),
  maxMessagesPerHour: z.number().int().min(1).max(200).optional(),
  rotationStrategy: z.enum(['round-robin', 'least-used', 'sequential']).optional(),
})

numbersRouter.get('/', async (req, res) => {
  const result = await db.query(
    `SELECT id, org_id, name, phone_label, status, messages_sent_today,
            max_messages_per_hour, rotation_strategy, created_at, updated_at
     FROM rcs.numbers WHERE org_id = $1 ORDER BY created_at ASC`,
    [req.user.orgId]
  )
  res.json(result.rows.map(toNumberDto))
})

numbersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const maxNumbers = Number(process.env.MAX_NUMBERS_PER_ORG ?? 10)
  const count = await db.query(
    'SELECT COUNT(*) FROM rcs.numbers WHERE org_id = $1',
    [req.user.orgId]
  )
  if (Number(count.rows[0].count) >= maxNumbers) {
    res.status(422).json({ error: `Maximum ${maxNumbers} numbers per org reached` })
    return
  }

  const { name, phoneLabel, maxMessagesPerHour, rotationStrategy } = parsed.data
  const result = await db.query(
    `INSERT INTO rcs.numbers (org_id, name, phone_label, max_messages_per_hour, rotation_strategy)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.orgId, name, phoneLabel, maxMessagesPerHour ?? 50, rotationStrategy ?? 'round-robin']
  )

  const number = result.rows[0]
  // Inicia sessão Playwright para o número
  sessionManager.initSession(number.id, req.user.orgId).catch(console.error)

  res.status(201).json(toNumberDto(number))
})

numbersRouter.get('/:id/status', async (req, res) => {
  const number = await getNumberOrFail(req.params.id, req.user.orgId, res)
  if (!number) return
  res.json({ id: number.id, status: number.status })
})

// SSE stream: aguarda DB marcar status = 'authenticated'
numbersRouter.get('/:id/qr', async (req, res) => {
  const number = await getNumberOrFail(req.params.id, req.user.orgId, res)
  if (!number) return

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Envia ping inicial para confirmar que a janela foi aberta
  send({ type: 'waiting' })

  const interval = setInterval(async () => {
    try {
      const statusRow = await db.query(
        'SELECT status FROM rcs.numbers WHERE id = $1',
        [number.id]
      )
      const status = statusRow.rows[0]?.status
      if (status === 'authenticated') {
        send({ type: 'authenticated' })
        clearInterval(interval)
        res.end()
      }
    } catch (err) {
      send({ type: 'error', message: String(err) })
    }
  }, 2000)

  req.on('close', () => clearInterval(interval))
})

// Reinicia sessão para gerar novo QR code
numbersRouter.post('/:id/restart', async (req, res) => {
  const number = await getNumberOrFail(req.params.id, req.user.orgId, res)
  if (!number) return

  await sessionManager.destroySession(number.id)
  await db.query(
    `UPDATE rcs.numbers SET status = 'pending_auth', updated_at = NOW() WHERE id = $1`,
    [number.id]
  )
  sessionManager.initSession(number.id, req.user.orgId).catch(console.error)
  res.json({ ok: true })
})

numbersRouter.delete('/:id', async (req, res) => {
  const number = await getNumberOrFail(req.params.id, req.user.orgId, res)
  if (!number) return

  try {
    await sessionManager.destroySession(number.id)
    // Remove registros dependentes antes de deletar o número
    await db.query('DELETE FROM rcs.dispatch_log WHERE number_id = $1', [number.id])
    await db.query('DELETE FROM rcs.numbers WHERE id = $1', [number.id])
    res.status(204).send()
  } catch (err) {
    console.error('[Numbers] Delete error:', String(err))
    res.status(500).json({ error: 'Erro ao excluir número' })
  }
})

// ── helpers ──────────────────────────────────────────────────────────────────

async function getNumberOrFail(id: string, orgId: string, res: any) {
  const result = await db.query(
    'SELECT * FROM rcs.numbers WHERE id = $1 AND org_id = $2',
    [id, orgId]
  )
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Number not found' })
    return null
  }
  return result.rows[0]
}

function toNumberDto(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    phoneLabel: row.phone_label,
    status: row.status,
    messagesSentToday: row.messages_sent_today,
    maxMessagesPerHour: row.max_messages_per_hour,
    rotationStrategy: row.rotation_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
