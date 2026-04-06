import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db } from '../db/client'
import { requireAuth } from '../middleware/auth'

export const authRouter = Router()

const registerSchema = z.object({
  orgName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const { orgName, email, password } = parsed.data

  const existing = await db.query('SELECT id FROM rcs.users WHERE email = $1', [email])
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const orgResult = await client.query(
      'INSERT INTO rcs.orgs (name) VALUES ($1) RETURNING id',
      [orgName]
    )
    const orgId = orgResult.rows[0].id

    const userResult = await client.query(
      'INSERT INTO rcs.users (org_id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
      [orgId, email, passwordHash, 'admin']
    )
    await client.query('COMMIT')

    const user = userResult.rows[0]
    const token = jwt.sign(
      { sub: user.id, orgId, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
    )

    res
      .cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(201)
      .json({ user: { id: user.id, email: user.email, role: user.role, orgId } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const { email, password } = parsed.data

  const result = await db.query(
    'SELECT id, org_id, email, password_hash, role FROM rcs.users WHERE email = $1',
    [email]
  )

  const user = result.rows[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const token = jwt.sign(
    { sub: user.id, orgId: user.org_id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
  )

  res
    .cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .json({ user: { id: user.id, email: user.email, role: user.role, orgId: user.org_id } })
})

authRouter.post('/logout', (req, res) => {
  res.clearCookie('token').json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const result = await db.query(
    'SELECT id, org_id, email, role, created_at FROM rcs.users WHERE id = $1',
    [req.user.sub]
  )
  const user = result.rows[0]
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.json({ user: { id: user.id, orgId: user.org_id, email: user.email, role: user.role } })
})
