import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { storageService } from "../services/StorageService";

export const variationsRouter = Router({ mergeParams: true });
variationsRouter.use(requireAuth);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

const schema = z.object({
  body: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

async function campaignBelongsToOrg(id: string, orgId: string) {
  const r = await db.query(
    "SELECT id FROM rcs.campaigns WHERE id = $1 AND org_id = $2",
    [id, orgId]
  );
  return r.rows.length > 0;
}

variationsRouter.get("/", async (req, res) => {
  if (!(await campaignBelongsToOrg(req.params.id, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const result = await db.query(
    "SELECT * FROM rcs.message_variations WHERE campaign_id = $1 ORDER BY sort_order ASC",
    [req.params.id]
  );
  res.json(result.rows.map(toDto));
});

variationsRouter.post("/", async (req, res) => {
  if (!(await campaignBelongsToOrg(req.params.id, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const count = await db.query(
    "SELECT COUNT(*) FROM rcs.message_variations WHERE campaign_id = $1",
    [req.params.id]
  );
  if (Number(count.rows[0].count) >= 5) {
    res.status(422).json({ error: "Maximum 5 variations per campaign" });
    return;
  }
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { body, imageUrl, sortOrder } = parsed.data;
  const result = await db.query(
    `INSERT INTO rcs.message_variations (campaign_id, body, image_url, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, body, imageUrl ?? null, sortOrder ?? 0]
  );
  res.status(201).json(toDto(result.rows[0]));
});

variationsRouter.post(
  "/:vid/image",
  (req, res, next) => {
    imageUpload.single("image")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload error";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    if (!(await campaignBelongsToOrg(req.params.id, req.user.orgId))) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ code: "MISSING_FILE", message: "No image file provided" });
      return;
    }

    const own = await db.query(
      "SELECT id FROM rcs.message_variations WHERE id = $1 AND campaign_id = $2",
      [req.params.vid, req.params.id]
    );
    if (!own.rows[0]) {
      res.status(404).json({ error: "Variation not found" });
      return;
    }

    try {
      const imageUrl = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
        req.user.orgId
      );
      const result = await db.query(
        `UPDATE rcs.message_variations SET image_url = $1 WHERE id = $2 AND campaign_id = $3 RETURNING *`,
        [imageUrl, req.params.vid, req.params.id]
      );
      res.json({ imageUrl, variation: toDto(result.rows[0]) });
    } catch (e) {
      console.error("[variations] image upload:", e);
      res.status(500).json({ code: "UPLOAD_ERROR", message: String(e) });
    }
  }
);

variationsRouter.patch("/:vid", async (req, res) => {
  if (!(await campaignBelongsToOrg(req.params.id, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (d.body !== undefined) {
    fields.push(`body = $${i++}`);
    values.push(d.body);
  }
  if (d.imageUrl !== undefined) {
    fields.push(`image_url = $${i++}`);
    values.push(d.imageUrl);
  }
  if (d.sortOrder !== undefined) {
    fields.push(`sort_order = $${i++}`);
    values.push(d.sortOrder);
  }

  if (!fields.length) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  values.push(req.params.vid, req.params.id);
  const result = await db.query(
    `UPDATE rcs.message_variations SET ${fields.join(", ")}
     WHERE id = $${i} AND campaign_id = $${i + 1} RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Variation not found" });
    return;
  }
  res.json(toDto(result.rows[0]));
});

variationsRouter.delete("/:vid", async (req, res) => {
  if (!(await campaignBelongsToOrg(req.params.id, req.user.orgId))) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  await db.query(
    "DELETE FROM rcs.message_variations WHERE id = $1 AND campaign_id = $2",
    [req.params.vid, req.params.id]
  );
  res.status(204).send();
});

function toDto(row: any) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    body: row.body,
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
  };
}
