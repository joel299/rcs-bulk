-- Remove duplicatas antes de criar o índice único
DELETE FROM rcs.contacts a
USING rcs.contacts b
WHERE a.id > b.id
  AND a.campaign_id = b.campaign_id
  AND a.phone = b.phone;

-- Garante deduplicação por telefone dentro de uma campanha
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_campaign_phone_unique'
  ) THEN
    ALTER TABLE rcs.contacts
      ADD CONSTRAINT contacts_campaign_phone_unique UNIQUE (campaign_id, phone);
  END IF;
END $$;
