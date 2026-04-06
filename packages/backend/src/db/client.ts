import { Pool } from 'pg'

export const db = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rcs',
  user: process.env.POSTGRES_USER ?? 'rcs_user',
  password: process.env.POSTGRES_PASSWORD ?? 'changeme',
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

db.on('error', (err) => {
  console.error('Unexpected postgres pool error', err)
})
