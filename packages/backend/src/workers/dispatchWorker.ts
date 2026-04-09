import { Worker, Job, UnrecoverableError } from "bullmq";
import { db } from "../db/client";
import { sessionManager } from "../services/SessionManager";
import { storageService } from "../services/StorageService";
import { sendMessage } from "../playwright/actions";
import { redisConnection } from "../services/DispatchQueue";
import { resolveMandatoryCampaignImage } from "../services/attachmentResolve";
import type { DispatchJobData } from "@rcs/shared";
import fs from "fs";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "https://n8n.alcateia-ia.com/webhook/recebe/v1/envio/rcs";
const WEBHOOK_ACTIVE_URL =
  process.env.WEBHOOK_ACTIVE_URL ||
  "https://n8n.alcateia-ia.com/webhook/recebe/v1/envio/rcs/cadastra/campanha";

function willRetryOnFailure(job: Job<DispatchJobData>): boolean {
  const max = job.opts.attempts ?? 3;
  return job.attemptsMade + 1 < max;
}

async function sendWebhook(
  phone: string,
  type: "rcs" | "sms",
  event: "Success" | "Failed"
): Promise<void> {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, phone, event }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`[Webhook] Non-OK response: ${response.status}`);
    } else {
      console.log(`[Webhook] ✅ Sent for ${phone} — event: ${event}`);
    }
  } catch (err) {
    console.warn(`[Webhook] ⚠️ Failed to send for ${phone}:`, String(err));
  }
}

async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const remaining = await db.query(
    `SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId]
  );
  const pendingCount = Number(remaining.rows[0].count);
  console.log(
    `[Worker] Campaign ${campaignId} — ${pendingCount} contacts still pending`
  );
  if (pendingCount === 0) {
    await db.query(
      `UPDATE rcs.campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status != 'completed'`,
      [campaignId]
    );
    console.log(`[Worker] ✅ Campaign ${campaignId} marked as COMPLETED`);
  }
}

export const dispatchWorker = new Worker<DispatchJobData>(
  "dispatch",
  async (job) => {
    const {
      campaignId,
      contactId,
      phone,
      message,
      imageUrl,
      variationId,
      numberId,
    } = job.data;

    console.log(
      `[Worker] ▶ Job ${job.id} started — campaign: ${campaignId}, contact: ${contactId}, phone: ${phone} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 3})`
    );
    console.log(
      `[Worker] Job data — phone: ${phone}, message length: ${message?.length ?? 0}, imageUrl: ${imageUrl ?? "none"}`
    );

    if (!message || message.trim() === "") {
      console.error(
        `[Worker] ❌ Empty message for contact ${phone} — aborting job`
      );
      throw new UnrecoverableError(`Empty message for contact ${phone}`);
    }

    try {
      const campRow = await db.query(
        "SELECT status, schedule_days, schedule_start, schedule_end FROM rcs.campaigns WHERE id = $1",
        [campaignId]
      );
      const campaign = campRow.rows[0];

      if (!campaign) {
        const msg = `Campaign ${campaignId} not found`;
        console.error(`[Worker] ❌ ${msg}`);
        throw new UnrecoverableError(msg);
      }

      if (campaign.status !== "running") {
        const st = campaign.status;
        console.warn(
          `[Worker] Campaign ${campaignId} not running (status: ${st}) — job must not complete as success`
        );
        if (["completed", "cancelled", "draft"].includes(st)) {
          throw new UnrecoverableError(
            `Campaign ${campaignId} is '${st}', job obsolete`
          );
        }
        throw new Error(
          `Campaign ${campaignId} not runnable (status: ${st}), retry later`
        );
      }

      const page = await sessionManager.getPage(numberId);
      if (!page) {
        const msg = `No active browser session for number ${numberId} — reautentique o número no painel`;
        console.error(`[Worker] ❌ ${msg}`);
        throw new UnrecoverableError(msg);
      }
      console.log(`[Worker] 🌐 Page obtained for number ${numberId}`);

      let localImagePath: string | undefined;
      let tempDownloadPath: string | undefined;
      if (imageUrl) {
        try {
          try {
            tempDownloadPath = await storageService.downloadToTemp(imageUrl);
          } catch (err) {
            console.warn(`[Worker] Could not download image ${imageUrl}:`, err);
          }
          localImagePath = resolveMandatoryCampaignImage(
            imageUrl,
            tempDownloadPath
          );
        } catch (err) {
          if (tempDownloadPath) fs.unlink(tempDownloadPath, () => {});
          throw err;
        }
      }

      try {
        await fetch(WEBHOOK_ACTIVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "rcs", phone, event: "ACTIVE" }),
          signal: AbortSignal.timeout(10_000),
        });
        console.log(`[Worker] 📡 Webhook ACTIVE sent for ${phone}`);
      } catch (err) {
        console.warn(
          `[Worker] ⚠️ Webhook ACTIVE failed for ${phone}:`,
          String(err)
        );
      }

      console.log(`[Worker] 📤 Sending message to ${phone}...`);
      const result = await sendMessage(page, phone, message, localImagePath);

      if (tempDownloadPath) {
        fs.unlink(tempDownloadPath, () => {});
      }

      if (!result.success) {
        console.error(
          `[Worker] ❌ SEND FAILED — phone: ${phone}, campaign: ${campaignId}`
        );
        console.error(`[Worker] ❌ Reason: ${result.error}`);
        if (willRetryOnFailure(job)) {
          console.warn(
            `[Worker] Will retry (${job.attemptsMade + 1}/${job.opts.attempts ?? 3})`
          );
          throw new Error(result.error ?? "sendMessage failed");
        }

        await db.query(
          `UPDATE rcs.contacts SET status = 'failed', error_message = $1 WHERE id = $2`,
          [result.error, contactId]
        );
        await db.query(
          `UPDATE rcs.campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
          [campaignId]
        );
        await db.query(
          `INSERT INTO rcs.dispatch_log (campaign_id, contact_id, number_id, variation_id, status, message_type, error)
         VALUES ($1, $2, $3, $4, 'failed', $5, $6)`,
          [
            campaignId,
            contactId,
            numberId,
            variationId,
            result.messageType,
            result.error,
          ]
        );

        await sendWebhook(phone, result.messageType ?? "rcs", "Failed");
        await checkCampaignCompletion(campaignId);
        throw new Error(result.error ?? "sendMessage returned success=false");
      }

      await db.query(
        `UPDATE rcs.contacts SET status = 'sent', sent_at = NOW() WHERE id = $1`,
        [contactId]
      );
      await db.query(
        `UPDATE rcs.campaigns SET sent_count = sent_count + 1 WHERE id = $1`,
        [campaignId]
      );
      await db.query(
        `UPDATE rcs.numbers SET messages_sent_today = messages_sent_today + 1 WHERE id = $1`,
        [numberId]
      );
      await db.query(
        `INSERT INTO rcs.dispatch_log (campaign_id, contact_id, number_id, variation_id, status, message_type)
       VALUES ($1, $2, $3, $4, 'sent', $5)`,
        [campaignId, contactId, numberId, variationId, result.messageType]
      );

      console.log(
        `[Worker] ✅ Message sent to ${phone} as ${result.messageType}`
      );
      await sendWebhook(phone, result.messageType, "Success");

      if (result.messageType === "sms") {
        console.info(
          `[Worker] Message to ${phone} in campaign ${campaignId} was delivered as SMS (not RCS)`
        );
      }

      await checkCampaignCompletion(campaignId);
    } catch (err) {
      console.error(
        `[Worker] ❌ Job ${job.id} FAILED — phone: ${phone}:`,
        String(err)
      );
      throw err;
    } finally {
      console.log(`[Worker] ⏹ Job ${job.id} finished (handler exit)`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

dispatchWorker.on("failed", (job, err) => {
  const att = job ? `${job.attemptsMade}/${job.opts.attempts ?? 3}` : "?";
  console.error(
    `[Worker] Job ${job?.id} failed (attempts ${att}):`,
    err.message
  );
});

dispatchWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} marked completed in BullMQ`);
});

console.log('[Worker] Dispatch worker registered for queue "dispatch"');
