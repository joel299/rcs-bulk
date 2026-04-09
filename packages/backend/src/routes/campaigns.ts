import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { dispatchQueue } from "../services/DispatchQueue";
import type { CampaignProgress } from "@rcs/shared";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  scheduleDays: z
    .array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]))
    .optional(),
  scheduleStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  scheduleEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  intervalMinSeconds: z.number().int().min(5).max(3600).optional(),
  intervalMaxSeconds: z.number().int().min(5).max(3600).optional(),
  variationMode: z.enum(["random", "sequential"]).optional(),
  scheduledAt: z.string().datetime().optional(),
});

campaignsRouter.get("/", async (req, res) => {
  const result = await db.query(
    `SELECT * FROM rcs.campaigns WHERE org_id = $1 ORDER BY created_at DESC`,
    [req.user.orgId]
  );
  res.json(result.rows.map(toCampaignDto));
});

campaignsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const result = await db.query(
    `INSERT INTO rcs.campaigns
       (org_id, name, schedule_days, schedule_start, schedule_end,
        interval_min_seconds, interval_max_seconds, variation_mode, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      req.user.orgId,
      d.name,
      d.scheduleDays ?? ["MON", "TUE", "WED", "THU", "FRI"],
      d.scheduleStart ?? "08:00",
      d.scheduleEnd ?? "19:00",
      d.intervalMinSeconds ?? 30,
      d.intervalMaxSeconds ?? 120,
      d.variationMode ?? "random",
      d.scheduledAt ?? null,
    ]
  );
  res.status(201).json(toCampaignDto(result.rows[0]));
});

campaignsRouter.get("/:id", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;
  res.json(toCampaignDto(campaign));
});

campaignsRouter.patch("/:id", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  if (["running", "waiting_window", "scheduled"].includes(campaign.status)) {
    res
      .status(422)
      .json({ error: "Cannot edit a campaign that is currently running" });
    return;
  }

  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (d.name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(d.name);
  }
  if (d.scheduleDays !== undefined) {
    fields.push(`schedule_days = $${i++}`);
    values.push(d.scheduleDays);
  }
  if (d.scheduleStart !== undefined) {
    fields.push(`schedule_start = $${i++}`);
    values.push(d.scheduleStart);
  }
  if (d.scheduleEnd !== undefined) {
    fields.push(`schedule_end = $${i++}`);
    values.push(d.scheduleEnd);
  }
  if (d.intervalMinSeconds !== undefined) {
    fields.push(`interval_min_seconds = $${i++}`);
    values.push(d.intervalMinSeconds);
  }
  if (d.intervalMaxSeconds !== undefined) {
    fields.push(`interval_max_seconds = $${i++}`);
    values.push(d.intervalMaxSeconds);
  }
  if (d.variationMode !== undefined) {
    fields.push(`variation_mode = $${i++}`);
    values.push(d.variationMode);
  }
  if (d.scheduledAt !== undefined) {
    fields.push(`scheduled_at = $${i++}`);
    values.push(d.scheduledAt);
  }

  if (fields.length === 0) {
    res.json(toCampaignDto(campaign));
    return;
  }

  values.push(campaign.id);
  const result = await db.query(
    `UPDATE rcs.campaigns SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json(toCampaignDto(result.rows[0]));
});

campaignsRouter.post("/:id/start", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  if (
    !["draft", "paused", "scheduled", "waiting_window"].includes(
      campaign.status
    )
  ) {
    res
      .status(422)
      .json({ error: "Campaign cannot be started in current status" });
    return;
  }

  await dispatchQueue.startCampaign(campaign, req.user.orgId);
  res.json({ ok: true });
});

campaignsRouter.post("/:id/pause", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  if (!["running", "waiting_window"].includes(campaign.status)) {
    res.status(422).json({ error: "Campaign is not running" });
    return;
  }

  await dispatchQueue.pauseCampaign(campaign.id);
  await db.query(`UPDATE rcs.campaigns SET status = 'paused' WHERE id = $1`, [
    campaign.id,
  ]);
  res.json({ ok: true });
});

campaignsRouter.post("/:id/cancel", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  await dispatchQueue.cancelCampaign(campaign.id);
  await db.query(
    `UPDATE rcs.campaigns SET status = 'cancelled' WHERE id = $1`,
    [campaign.id]
  );
  res.json({ ok: true });
});

campaignsRouter.post("/:id/restart", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  if (campaign.status === "running" || campaign.status === "waiting_window") {
    res.status(409).json({ error: "Campaign is already running" });
    return;
  }

  if (!["cancelled", "completed"].includes(campaign.status)) {
    res.status(422).json({
      error: "Only cancelled or completed campaigns can be restarted",
    });
    return;
  }

  await dispatchQueue.removeAllJobsForCampaign(campaign.id);

  await db.query(
    `UPDATE rcs.contacts
     SET status = 'pending', sent_at = NULL, error_message = NULL
     WHERE campaign_id = $1`,
    [campaign.id]
  );

  await db.query(
    `UPDATE rcs.campaigns
     SET status = 'draft', sent_count = 0, failed_count = 0,
         started_at = NULL, completed_at = NULL
     WHERE id = $1`,
    [campaign.id]
  );

  res.json({ ok: true });
});

campaignsRouter.delete("/:id", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  if (campaign.status === "running" || campaign.status === "waiting_window") {
    res
      .status(409)
      .json({ error: "Pause or cancel the campaign before deleting" });
    return;
  }

  try {
    await dispatchQueue.removeAllJobsForCampaign(campaign.id);
  } catch (err) {
    console.warn("[DELETE campaign] Could not clean queue:", err);
  }

  await db.query(`DELETE FROM rcs.dispatch_log WHERE campaign_id = $1`, [
    campaign.id,
  ]);
  await db.query(`DELETE FROM rcs.campaigns WHERE id = $1 AND org_id = $2`, [
    campaign.id,
    req.user.orgId,
  ]);

  res.json({ deleted: true, id: campaign.id, name: campaign.name });
});

// SSE: progresso em tempo real
campaignsRouter.get("/:id/progress", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: CampaignProgress) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    const row = await db.query(
      `SELECT status, total_contacts, sent_count, failed_count FROM rcs.campaigns WHERE id = $1`,
      [campaign.id]
    );
    if (!row.rows[0]) return;

    const c = row.rows[0];
    // Últimas 10 entradas do job atual (filtra por started_at)
    const campFull = await db.query(
      `SELECT started_at FROM rcs.campaigns WHERE id = $1`,
      [campaign.id]
    );
    const startedAt = campFull.rows[0]?.started_at ?? null;

    const recentLogs = await db.query(
      `SELECT dl.status, dl.message_type, dl.dispatched_at, ct.name, ct.phone, n.phone_label
       FROM rcs.dispatch_log dl
       JOIN rcs.contacts ct ON ct.id = dl.contact_id
       LEFT JOIN rcs.numbers n ON n.id = dl.number_id
       WHERE dl.campaign_id = $1
         ${startedAt ? "AND dl.dispatched_at >= $2" : ""}
       ORDER BY dl.dispatched_at DESC LIMIT 10`,
      startedAt ? [campaign.id, startedAt] : [campaign.id]
    );

    const progress: CampaignProgress = {
      campaignId: campaign.id,
      status: c.status,
      totalContacts: c.total_contacts,
      sentCount: c.sent_count,
      failedCount: c.failed_count,
      pendingCount: c.total_contacts - c.sent_count - c.failed_count,
    };

    if (recentLogs.rows[0]) {
      const l = recentLogs.rows[0];
      progress.lastDispatched = {
        contactName: l.name ?? l.phone,
        phone: l.phone,
        status: l.status,
        messageType: l.message_type,
        dispatchedAt: l.dispatched_at,
      };
    }

    // Campo extra: últimas N entradas para o frontend popular o log completo
    (progress as any).recentDispatched = recentLogs.rows.map((l: any) => ({
      contactName: l.name ?? l.phone,
      phone: l.phone,
      status: l.status,
      messageType: l.message_type,
      dispatchedAt: l.dispatched_at,
      numberLabel: l.phone_label ?? null,
    }));

    send(progress);

    if (["completed", "cancelled"].includes(c.status)) {
      clearInterval(interval);
      res.end();
    }
  }, 1500);

  req.on("close", () => clearInterval(interval));
});

// Log de envios paginado — filtra pelo job atual (started_at) + phone_label do número
campaignsRouter.get("/:id/log", async (req, res) => {
  const campaign = await getCampaignOrFail(req.params.id, req.user.orgId, res);
  if (!campaign) return;

  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const before = req.query.before as string | undefined;

  // Filtra apenas entradas do job atual (>= started_at), se disponível
  const startedAt: string | null = campaign.started_at ?? null;

  const params: any[] = [campaign.id, limit];
  const conditions: string[] = [];
  if (startedAt) {
    conditions.push(`dl.dispatched_at >= $${params.push(startedAt)}`);
  }
  if (before) {
    conditions.push(`dl.dispatched_at < $${params.push(before)}`);
  }
  const where = conditions.length ? "AND " + conditions.join(" AND ") : "";

  const result = await db.query(
    `SELECT dl.id, dl.status, dl.message_type, dl.dispatched_at, dl.error,
            ct.name, ct.phone, n.phone_label
     FROM rcs.dispatch_log dl
     JOIN rcs.contacts ct ON ct.id = dl.contact_id
     LEFT JOIN rcs.numbers n ON n.id = dl.number_id
     WHERE dl.campaign_id = $1 ${where}
     ORDER BY dl.dispatched_at DESC
     LIMIT $2`,
    params
  );

  res.json({
    data: result.rows.map((l: any) => ({
      id: l.id,
      contactName: l.name ?? l.phone,
      phone: l.phone,
      status: l.status,
      messageType: l.message_type,
      dispatchedAt: l.dispatched_at,
      error: l.error,
      numberLabel: l.phone_label ?? null,
    })),
    hasMore: result.rows.length === limit,
    nextCursor:
      result.rows.length > 0
        ? result.rows[result.rows.length - 1].dispatched_at
        : null,
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function getCampaignOrFail(id: string, orgId: string, res: any) {
  const result = await db.query(
    "SELECT * FROM rcs.campaigns WHERE id = $1 AND org_id = $2",
    [id, orgId]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Campaign not found" });
    return null;
  }
  return result.rows[0];
}

function toCampaignDto(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    status: row.status,
    scheduleDays: row.schedule_days,
    scheduleStart: row.schedule_start,
    scheduleEnd: row.schedule_end,
    intervalMinSeconds: row.interval_min_seconds,
    intervalMaxSeconds: row.interval_max_seconds,
    variationMode: row.variation_mode,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    totalContacts: row.total_contacts,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    ...(row.updated_at != null ? { updatedAt: row.updated_at } : {}),
  };
}
