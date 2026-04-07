import { Queue, QueueEvents } from 'bullmq'
import { Redis } from 'ioredis'
import { db } from '../db/client'
import { renderTemplate } from '@rcs/shared'
import type { DispatchJobData } from '@rcs/shared'

const redisConnection = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
})

export const dispatchQueueInstance = new Queue<DispatchJobData>('dispatch', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 500 },
  },
})

/** Remove histórico completed/failed antigo ao subir — evita estado confuso após restart */
export async function cleanDispatchQueueOnStartup(): Promise<void> {
  try {
    const completed = await dispatchQueueInstance.clean(0, 10_000, 'completed')
    const failed = await dispatchQueueInstance.clean(0, 10_000, 'failed')
    console.log(
      `[DispatchQueue] Startup clean: ${completed.length} completed, ${failed.length} failed job(s) removed`
    )
  } catch (err) {
    console.warn('[DispatchQueue] Startup clean failed:', err)
  }
}

/** Verifica se o momento atual está dentro da janela configurada da campanha */
function isWithinScheduleWindow(campaign: any): boolean {
  const now = new Date()
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const currentDay = days[now.getDay()]

  if (!campaign.schedule_days.includes(currentDay)) return false

  const [startH, startM] = campaign.schedule_start.split(':').map(Number)
  const [endH, endM] = campaign.schedule_end.split(':').map(Number)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  return nowMinutes >= startMinutes && nowMinutes < endMinutes
}

class DispatchQueue {
  async startCampaign(campaign: any, orgId: string): Promise<void> {
    const inWindow = isWithinScheduleWindow(campaign)

    if (!inWindow) {
      await db.query(
        `UPDATE rcs.campaigns SET status = 'waiting_window' WHERE id = $1`,
        [campaign.id]
      )
      console.log(`[DispatchQueue] Campaign ${campaign.id} waiting for schedule window`)
      return
    }

    await this.enqueueContacts(campaign, orgId)
  }

  async enqueueContacts(campaign: any, orgId: string): Promise<void> {
    // Busca contatos pendentes
    const contacts = await db.query(
      `SELECT id, name, phone FROM rcs.contacts
       WHERE campaign_id = $1 AND status = 'pending'
       ORDER BY id`,
      [campaign.id]
    )

    if (!contacts.rows.length) {
      await db.query(
        `UPDATE rcs.campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [campaign.id]
      )
      return
    }

    // Busca variações da campanha
    const variations = await db.query(
      `SELECT id, body, image_url FROM rcs.message_variations
       WHERE campaign_id = $1 ORDER BY sort_order ASC`,
      [campaign.id]
    )

    if (!variations.rows.length) {
      console.warn(`[DispatchQueue] Campaign ${campaign.id} has no message variations`)
      return
    }

    // Busca todos os números disponíveis para rotação
    const numbers = await this.pickNumbers(orgId)
    if (!numbers.length) {
      console.warn(`[DispatchQueue] No available numbers for org ${orgId}`)
      await db.query(
        `UPDATE rcs.campaigns SET status = 'paused' WHERE id = $1`,
        [campaign.id]
      )
      return
    }

    await db.query(
      `UPDATE rcs.campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = $1`,
      [campaign.id]
    )

    let variationIndex = 0

    for (let i = 0; i < contacts.rows.length; i++) {
      const contact = contacts.rows[i]

      // Seleção aleatória entre números disponíveis
      const number = numbers[Math.floor(Math.random() * numbers.length)]

      // Seleciona variação
      let variation: any
      if (campaign.variation_mode === 'sequential') {
        variation = variations.rows[variationIndex % variations.rows.length]
        variationIndex++
      } else {
        variation = variations.rows[Math.floor(Math.random() * variations.rows.length)]
      }

      // Renderiza mensagem com variáveis do contato
      const message = renderTemplate(variation.body, {
        nome: contact.name ?? contact.phone,
        telefone: contact.phone,
      })

      // Delay aleatório entre mensagens
      const delay =
        i === 0
          ? 0
          : (campaign.interval_min_seconds +
              Math.random() * (campaign.interval_max_seconds - campaign.interval_min_seconds)) * 1000

      const jobData: DispatchJobData = {
        campaignId: campaign.id,
        contactId: contact.id,
        orgId,
        phone: contact.phone,
        contactName: contact.name,
        message,
        imageUrl: variation.image_url,
        variationId: variation.id,
        numberId: number.id,
      }

      await dispatchQueueInstance.add(`dispatch-${contact.id}`, jobData, {
        delay,
        jobId: `${campaign.id}-${contact.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
    }

    console.log(
      `[DispatchQueue] Enqueued ${contacts.rows.length} jobs for campaign ${campaign.id}`
    )
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    // Remove APENAS os jobs desta campanha — NÃO pausa a fila globalmente
    // Inclui 'failed' para que o jobId fique livre e possa ser re-enfileirado
    const jobs = await dispatchQueueInstance.getJobs(['delayed', 'waiting', 'paused', 'failed'])
    const toRemove = jobs.filter((j) => j?.data?.campaignId === campaignId)
    await Promise.allSettled(toRemove.map((j) => j.remove()))
  }

  async cancelCampaign(campaignId: string): Promise<void> {
    await this.pauseCampaign(campaignId)
    await db.query(
      `UPDATE rcs.contacts SET status = 'skipped' WHERE campaign_id = $1 AND status = 'pending'`,
      [campaignId]
    )
  }

  /** Retorna todos os números autenticados disponíveis (não atingiram limite), ordenados pelo menos usado */
  private async pickNumbers(orgId: string): Promise<any[]> {
    const result = await db.query(
      `SELECT id, messages_sent_today, max_messages_per_hour
       FROM rcs.numbers
       WHERE org_id = $1 AND status = 'authenticated'
       ORDER BY messages_sent_today ASC`,
      [orgId]
    )
    return result.rows.filter((n) => n.messages_sent_today < n.max_messages_per_hour)
  }

  private async pickNumber(orgId: string, _campaign?: any): Promise<any> {
    const numbers = await this.pickNumbers(orgId)
    return numbers[0] ?? null
  }
}

export const dispatchQueue = new DispatchQueue()
export { redisConnection }
