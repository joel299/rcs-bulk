import fs from 'fs'
import path from 'path'
import { db } from './client'

async function migrate() {
  // Cria tabela de controle de migrations
  await db.query(`
    CREATE TABLE IF NOT EXISTS rcs.migrations (
      filename TEXT PRIMARY KEY,
      ran_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const migrationsDir = path.join(__dirname, 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    const already = await db.query(
      'SELECT 1 FROM rcs.migrations WHERE filename = $1',
      [file]
    )
    if (already.rows.length > 0) {
      console.log(`  ↩ Skipping ${file} (already ran)`)
      continue
    }

    console.log(`Running migration: ${file}`)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    await db.query(sql)
    await db.query('INSERT INTO rcs.migrations (filename) VALUES ($1)', [file])
    console.log(`  ✓ ${file}`)
  }

  await db.end()
  console.log('Migrations complete.')
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
