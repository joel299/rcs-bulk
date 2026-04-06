import cron from 'node-cron'
import { db } from '../db/client'
import { sessionManager } from '../services/SessionManager'
import { browserPool } from '../services/BrowserPool'
import { dispatchQueue } from '../services/DispatchQueue'

/** Redefine contador diário de mensagens enviadas à meia-noite */
cron.schedule('0 0 * * *', async () => {
  await db.query('UPDATE rcs.numbers SET messages_sent_today = 0')
  console.log('[Keepalive] Daily message counters reset')
}, { timezone: 'America/Sao_Paulo' })

/** A cada 10 minutos: verifica campanhas em waiting_window e tenta reativar */
cron.schedule('*/10 * * * *', async () => {
  const result = await db.query(
    `SELECT c.*, o.id as org_id_check
     FROM rcs.campaigns c
     JOIN rcs.orgs o ON o.id = c.org_id
     WHERE c.status = 'waiting_window'`
  )

  for (const campaign of result.rows) {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const now = new Date()
    const currentDay = days[now.getDay()]

    if (!campaign.schedule_days.includes(currentDay)) continue

    const [startH, startM] = campaign.schedule_start.split(':').map(Number)
    const [endH, endM] = campaign.schedule_end.split(':').map(Number)
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
      console.log(`[Keepalive] Resuming campaign ${campaign.id} — now within window`)
      await dispatchQueue.enqueueContacts(campaign, campaign.org_id)
    }
  }
}, { timezone: 'America/Sao_Paulo' })

/** A cada hora: verifica números autenticados cujo browser foi fechado e valida sessão */
cron.schedule('0 * * * *', async () => {
  const result = await db.query(
    `SELECT id FROM rcs.numbers WHERE status = 'authenticated'`
  )

  for (const row of result.rows) {
    if (!browserPool.isOpen(row.id)) {
      // Browser estava fechado (idle), verifica se sessão ainda é válida
      try {
        const page = await sessionManager.getPage(row.id)
        if (!page) {
          await db.query(
            `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
            [row.id]
          )
          console.log(`[Keepalive] Number ${row.id} session expired, marked disconnected`)
        }
      } catch {
        await db.query(
          `UPDATE rcs.numbers SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
          [row.id]
        )
      }
    }
  }
})

console.log('[Keepalive] Cron jobs initialized')
