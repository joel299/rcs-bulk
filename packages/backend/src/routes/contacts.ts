import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import { db } from '../db/client'
import { requireAuth } from '../middleware/auth'
import { normalizePhone, canonicalPhone } from '@rcs/shared'

export const contactsRouter = Router({ mergeParams: true })
contactsRouter.use(requireAuth)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const createSchema = z.object({
  name: z.string().optional(),
  phone: z.string(),
})

contactsRouter.get('/', async (req, res) => {
  const { id: campaignId } = req.params
  if (!await campaignBelongsToOrg(campaignId, req.user.orgId)) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const page = Number(req.query.page ?? 1)
  const limit = 100
  const offset = (page - 1) * limit

  const result = await db.query(
    `SELECT id, name, phone, status, sent_at, error_message
     FROM rcs.contacts WHERE campaign_id = $1
     ORDER BY id LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset]
  )

  const total = await db.query(
    'SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1',
    [campaignId]
  )

  res.json({
    data: result.rows,
    total: Number(total.rows[0].count),
    page,
    pages: Math.ceil(Number(total.rows[0].count) / limit),
  })
})

contactsRouter.post('/', async (req, res) => {
  const { id: campaignId } = req.params
  if (!await campaignBelongsToOrg(campaignId, req.user.orgId)) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    res.status(400).json({ error: 'Invalid phone number' })
    return
  }

  const result = await db.query(
    `INSERT INTO rcs.contacts (campaign_id, name, phone) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING *`,
    [campaignId, parsed.data.name ?? null, phone]
  )

  if (!result.rows[0]) {
    res.status(409).json({ error: 'Contact with this phone already exists in campaign' })
    return
  }

  // Mantém total_contacts sincronizado
  await db.query(
    `UPDATE rcs.campaigns SET total_contacts = (
       SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1
     ) WHERE id = $1`,
    [campaignId]
  )

  res.status(201).json(result.rows[0])
})

// Upload CSV
contactsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const { id: campaignId } = req.params

  if (!await campaignBelongsToOrg(campaignId, req.user.orgId)) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  let records: any[]
  try {
    records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
  } catch {
    res.status(400).json({ error: 'Invalid CSV format' })
    return
  }

  if (!records[0] || !('telefone' in records[0])) {
    res.status(400).json({
      error: "Column 'telefone' is required",
      hint: 'Download the CSV template for the correct format',
    })
    return
  }

  // Carrega telefones existentes para deduplicação
  const existing = await db.query(
    'SELECT phone FROM rcs.contacts WHERE campaign_id = $1',
    [campaignId]
  )
  const existingPhones = new Set(existing.rows.map((r: any) => canonicalPhone(r.phone)))

  const toInsert: { name: string | null; phone: string; extra: object | null }[] = []
  let skipped = 0

  for (const row of records) {
    const phone = normalizePhone(String(row.telefone ?? ''))
    if (!phone) { skipped++; continue }

    if (existingPhones.has(canonicalPhone(phone))) { skipped++; continue }
    existingPhones.add(canonicalPhone(phone))

    const { nome, telefone, ...extra } = row
    toInsert.push({
      name: nome || null,
      phone,
      extra: Object.keys(extra).length > 0 ? extra : null,
    })
  }

  if (toInsert.length === 0) {
    res.json({ imported: 0, skipped, message: 'No valid contacts to import' })
    return
  }

  // Bulk insert em chunks de 500
  const chunkSize = 500
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize)
    const values = chunk.flatMap((c, idx) => {
      const base = idx * 3
      return [c.name, c.phone, c.extra ? JSON.stringify(c.extra) : null]
    })
    const placeholders = chunk
      .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3}, '${campaignId}')`)
      .join(', ')

    await db.query(
      `INSERT INTO rcs.contacts (name, phone, extra, campaign_id) VALUES ${placeholders}`,
      values
    )
  }

  // Atualiza total_contacts na campanha
  await db.query(
    `UPDATE rcs.campaigns SET total_contacts = (
       SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1
     ) WHERE id = $1`,
    [campaignId]
  )

  res.json({ imported: toInsert.length, skipped })
})

// Download modelo CSV
contactsRouter.get('/template', (req, res) => {
  const csv = 'nome,telefone\nJoão Silva,+5548999990001\nMaria Souza,+5548999990002\n'
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="modelo_contatos.csv"')
  res.send(csv)
})

contactsRouter.delete('/:cid', async (req, res) => {
  const { id: campaignId, cid } = req.params
  if (!await campaignBelongsToOrg(campaignId, req.user.orgId)) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  await db.query(
    'DELETE FROM rcs.contacts WHERE id = $1 AND campaign_id = $2',
    [cid, campaignId]
  )
  res.status(204).send()
})

async function campaignBelongsToOrg(campaignId: string, orgId: string): Promise<boolean> {
  const r = await db.query(
    'SELECT id FROM rcs.campaigns WHERE id = $1 AND org_id = $2',
    [campaignId, orgId]
  )
  return r.rows.length > 0
}
