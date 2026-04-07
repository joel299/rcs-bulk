import { Worker, Job, UnrecoverableError } from 'bullmq'
import { db } from '../db/client'
import { sessionManager } from '../services/SessionManager'
import { storageService } from '../services/StorageService'
import { sendMessage } from '../playwright/actions'
import { redisConnection } from '../services/DispatchQueue'
import { resolveMandatoryCampaignImage } from '../services/attachmentResolve'
import type { DispatchJobData } from '@rcs/shared'
import fs from 'fs'

function willRetryOnFailure(job: Job<DispatchJobData>): boolean {
  const max = job.opts.attempts ?? 3
  return job.attemptsMade + 1 < max
}

export const dispatchWorker = new Worker<DispatchJobData>(
  'dispatch',
  async (job) => {
    const { campaignId, contactId, phone, message, imageUrl, variationId, numberId } = job.data

    console.log(
      `[Worker] ▶ Job ${job.id} started — campaign: ${campaignId}, contact: ${contactId}, phone: ${phone} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 3})`
    )

    try {
      const campRow = await db.query(
        'SELECT status, schedule_days, schedule_start, schedule_end FROM rcs.campaigns WHERE id = $1',
        [campaignId]
      )
      const campaign = campRow.rows[0]

      if (!campaign) {
        const msg = `Campaign ${campaignId} not found`
        console.error(`[Worker] ❌ ${msg}`)
        throw new UnrecoverableError(msg)
      }

      if (campaign.status !== 'running') {
        const st = campaign.status
        console.warn(`[Worker] Campaign ${campaignId} not running (status: ${st}) — job must not complete as success`)
        if (['completed', 'cancelled', 'draft'].includes(st)) {
          throw new UnrecoverableError(`Campaign ${campaignId} is '${st}', job obsolete`)
        }
        throw new Error(`Campaign ${campaignId} not runnable (status: ${st}), retry later`)
      }

      const page = await sessionManager.getPage(numberId)
      if (!page) {
        const msg = `No active browser session for number ${numberId} — reautentique o número no painel`
        console.error(`[Worker] ❌ ${msg}`)
        throw new UnrecoverableError(msg)
      }
      console.log(`[Worker] 🌐 Page obtained for number ${numberId}`)

      let localImagePath: string | undefined
      let tempDownloadPath: string | undefined
      if (imageUrl) {
        try {
          try {
            tempDownloadPath = await storageService.downloadToTemp(imageUrl)
          } catch (err) {
            console.warn(`[Worker] Could not download image ${imageUrl}:`, err)
          }
          localImagePath = resolveMandatoryCampaignImage(imageUrl, tempDownloadPath)
        } catch (err) {
          if (tempDownloadPath) fs.unlink(tempDownloadPath, () => {})
          throw err
        }
      }

      console.log(`[Worker] 📤 Sending message to ${phone}...`)
      const result = await sendMessage(page, phone, message, localImagePath)

      if (tempDownloadPath) {
        fs.unlink(tempDownloadPath, () => {})
      }

      if (!result.success) {
        console.error(`[Worker] ❌ SEND FAILED — phone: ${phone}, campaign: ${campaignId}`)
        console.error(`[Worker] ❌ Reason: ${result.error}`)
        if (willRetryOnFailure(job)) {
          console.warn(
            `[Worker] Will retry (${job.attemptsMade + 1}/${job.opts.attempts ?? 3})`
          )
          throw new Error(result.error ?? 'sendMessage failed')
        }

        await db.query(
          `UPDATE rcs.contacts SET status = 'failed', error_message = $1 WHERE id = $2`,
          [result.error, contactId]
        )
        await db.query(`UPDATE rcs.campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [
          campaignId,
        ])
        await db.query(
          `INSERT INTO rcs.dispatch_log (campaign_id, contact_id, number_id, variation_id, status, message_type, error)
         VALUES ($1, $2, $3, $4, 'failed', $5, $6)`,
          [campaignId, contactId, numberId, variationId, result.messageType, result.error]
        )
        throw new Error(result.error ?? 'sendMessage returned success=false')
      }

      await db.query(`UPDATE rcs.contacts SET status = 'sent', sent_at = NOW() WHERE id = $1`, [
        contactId,
      ])
      await db.query(`UPDATE rcs.campaigns SET sent_count = sent_count + 1 WHERE id = $1`, [
        campaignId,
      ])
      await db.query(`UPDATE rcs.numbers SET messages_sent_today = messages_sent_today + 1 WHERE id = $1`, [
        numberId,
      ])
      await db.query(
        `INSERT INTO rcs.dispatch_log (campaign_id, contact_id, number_id, variation_id, status, message_type)
       VALUES ($1, $2, $3, $4, 'sent', $5)`,
        [campaignId, contactId, numberId, variationId, result.messageType]
      )

      console.log(`[Worker] ✅ Message sent to ${phone} as ${result.messageType}`)

      if (result.messageType === 'sms') {
        console.info(
          `[Worker] Message to ${phone} in campaign ${campaignId} was delivered as SMS (not RCS)`
        )
      }

      const remaining = await db.query(
        `SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1 AND status = 'pending'`,
        [campaignId]
      )
      if (Number(remaining.rows[0].count) === 0) {
        await db.query(
          `UPDATE rcs.campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [campaignId]
        )
      }
    } catch (err) {
      console.error(`[Worker] ❌ Job ${job.id} FAILED — phone: ${phone}:`, String(err))
      throw err
    } finally {
      console.log(`[Worker] ⏹ Job ${job.id} finished (handler exit)`)
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
)

dispatchWorker.on('failed', (job, err) => {
  const att = job ? `${job.attemptsMade}/${job.opts.attempts ?? 3}` : '?'
  console.error(`[Worker] Job ${job?.id} failed (attempts ${att}):`, err.message)
})

dispatchWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} marked completed in BullMQ`)
})

console.log('[Worker] Dispatch worker registered for queue "dispatch"')
