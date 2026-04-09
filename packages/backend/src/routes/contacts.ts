import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { db } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { normalizePhone, canonicalPhone } from "@rcs/shared";

export const contactsRouter = Router({ mergeParams: true });
contactsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  name: z.string().optional(),
  phone: z.string(),
});

const editSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().optional(),
});

// ── Listar ───────────────────────────────────────────────────────────────────

contactsRouter.get("/", async (req, res) => {
  const { id: campaignId } = req.params;
  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const page = Number(req.query.page ?? 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const result = await db.query(
    `SELECT id, name, phone, status, sent_at, error_message
     FROM rcs.contacts WHERE campaign_id = $1
     ORDER BY id LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset]
  );

  const total = await db.query(
    "SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1",
    [campaignId]
  );

  res.json({
    data: result.rows,
    total: Number(total.rows[0].count),
    page,
    pages: Math.ceil(Number(total.rows[0].count) / limit),
  });
});

// ── Adicionar manual ─────────────────────────────────────────────────────────

contactsRouter.post("/", async (req, res) => {
  const { id: campaignId } = req.params;
  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  const result = await db.query(
    `INSERT INTO rcs.contacts (campaign_id, name, phone) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING *`,
    [campaignId, parsed.data.name ?? null, phone]
  );

  if (!result.rows[0]) {
    res
      .status(409)
      .json({ error: "Contact with this phone already exists in campaign" });
    return;
  }

  await db.query(
    `UPDATE rcs.campaigns SET total_contacts = (
       SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1
     ) WHERE id = $1`,
    [campaignId]
  );

  res.status(201).json(result.rows[0]);
});

// ── Editar contato ────────────────────────────────────────────────────────────

contactsRouter.put("/:cid", async (req, res) => {
  const { id: campaignId, cid } = req.params;
  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const contact = await db.query(
    "SELECT * FROM rcs.contacts WHERE id = $1 AND campaign_id = $2",
    [cid, campaignId]
  );
  if (!contact.rows[0]) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  if (contact.rows[0].status === "sent") {
    res.status(400).json({
      code: "FORBIDDEN",
      message: "Cannot edit a contact that was already sent",
    });
    return;
  }

  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (parsed.data.name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(parsed.data.name);
  }

  if (parsed.data.phone !== undefined) {
    const phone = normalizePhone(parsed.data.phone);
    if (!phone) {
      res
        .status(400)
        .json({ code: "VALIDATION_ERROR", message: "Invalid phone format" });
      return;
    }
    // Verifica duplicata na mesma campanha (exceto o próprio contato)
    const dup = await db.query(
      "SELECT id FROM rcs.contacts WHERE campaign_id = $1 AND phone = $2 AND id != $3",
      [campaignId, phone, cid]
    );
    if (dup.rows.length > 0) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Phone already exists in this campaign",
      });
      return;
    }
    fields.push(`phone = $${i++}`);
    values.push(phone);
  }

  if (fields.length === 0) {
    res.json(contact.rows[0]);
    return;
  }

  values.push(cid);
  const result = await db.query(
    `UPDATE rcs.contacts SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );

  res.json(result.rows[0]);
});

// ── Excluir individual ────────────────────────────────────────────────────────

contactsRouter.delete("/:cid", async (req, res) => {
  const { id: campaignId, cid } = req.params;
  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const result = await db.query(
    "DELETE FROM rcs.contacts WHERE id = $1 AND campaign_id = $2 RETURNING id",
    [cid, campaignId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  await db.query(
    `UPDATE rcs.campaigns SET total_contacts = (
       SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1
     ) WHERE id = $1`,
    [campaignId]
  );

  res.json({ deleted: true, id: cid });
});

// ── Excluir todos ─────────────────────────────────────────────────────────────

contactsRouter.delete("/", async (req, res) => {
  const { id: campaignId } = req.params;
  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const campaign = await db.query(
    "SELECT status FROM rcs.campaigns WHERE id = $1",
    [campaignId]
  );
  if (campaign.rows[0]?.status === "running") {
    res.status(409).json({
      code: "CONFLICT",
      message: "Cannot delete contacts while campaign is running",
    });
    return;
  }

  const result = await db.query(
    "DELETE FROM rcs.contacts WHERE campaign_id = $1 RETURNING id",
    [campaignId]
  );

  await db.query("UPDATE rcs.campaigns SET total_contacts = 0 WHERE id = $1", [
    campaignId,
  ]);

  res.json({ deleted: true, count: result.rows.length });
});

// ── Upload CSV ────────────────────────────────────────────────────────────────

contactsRouter.post("/upload", upload.single("file"), async (req, res) => {
  const { id: campaignId } = req.params;

  if (!(await campaignBelongsToOrg(campaignId, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ code: "MISSING_FILE", message: "No file uploaded" });
    return;
  }

  // Remove BOM e detecta delimitador
  const content = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const delimiter = content.includes(";") ? ";" : ",";

  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter,
    });
  } catch {
    res
      .status(400)
      .json({ code: "PARSE_ERROR", message: "Could not parse CSV file" });
    return;
  }

  if (!records.length) {
    res.json({ imported: 0, skipped: 0, errors: [] });
    return;
  }

  // Normaliza chaves (case-insensitive)
  const normalize = (r: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k.toLowerCase().trim()] = v;
    return out;
  };

  // Carrega telefones existentes
  const existing = await db.query(
    "SELECT phone FROM rcs.contacts WHERE campaign_id = $1",
    [campaignId]
  );
  const existingPhones = new Set(
    existing.rows.map((r: any) => canonicalPhone(r.phone))
  );

  const toInsert: { name: string | null; phone: string }[] = [];
  const errors: { line: number; phone: string; reason: string }[] = [];
  let skipped = 0;

  for (let i = 0; i < records.length; i++) {
    const row = normalize(records[i]);
    const rawPhone = (
      row["telefone"] ??
      row["phone"] ??
      row["numero"] ??
      row["number"] ??
      ""
    ).trim();
    const name = (row["nome"] ?? row["name"] ?? "").trim() || null;

    if (!rawPhone) {
      errors.push({ line: i + 2, phone: "", reason: "Missing phone number" });
      continue;
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      errors.push({
        line: i + 2,
        phone: rawPhone,
        reason: "Invalid phone format",
      });
      continue;
    }

    if (existingPhones.has(canonicalPhone(phone))) {
      errors.push({ line: i + 2, phone, reason: "Already exists in campaign" });
      skipped++;
      continue;
    }

    existingPhones.add(canonicalPhone(phone));
    toInsert.push({ name, phone });
  }

  if (toInsert.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const values = chunk.flatMap((c) => [c.name, c.phone]);
      const placeholders = chunk
        .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}, '${campaignId}')`)
        .join(", ");
      await db.query(
        `INSERT INTO rcs.contacts (name, phone, campaign_id) VALUES ${placeholders}`,
        values
      );
    }

    await db.query(
      `UPDATE rcs.campaigns SET total_contacts = (
         SELECT COUNT(*) FROM rcs.contacts WHERE campaign_id = $1
       ) WHERE id = $1`,
      [campaignId]
    );
  }

  res.json({ imported: toInsert.length, skipped, errors });
});

// ── Modelo CSV ────────────────────────────────────────────────────────────────

contactsRouter.get("/template", (_req, res) => {
  const csv =
    "nome,telefone\nJoão Silva,+5548999990001\nMaria Souza,+5548999990002\n";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="modelo_contatos.csv"'
  );
  res.send(csv);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function campaignBelongsToOrg(
  campaignId: string,
  orgId: string
): Promise<boolean> {
  const r = await db.query(
    "SELECT id FROM rcs.campaigns WHERE id = $1 AND org_id = $2",
    [campaignId, orgId]
  );
  return r.rows.length > 0;
}
