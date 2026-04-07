-- campaigns.updated_at (alinhado ao restante do schema; trigger reutiliza rcs.set_updated_at)
ALTER TABLE rcs.campaigns
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE rcs.campaigns SET updated_at = COALESCE(updated_at, created_at);

DROP TRIGGER IF EXISTS campaigns_updated_at ON rcs.campaigns;
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON rcs.campaigns
  FOR EACH ROW EXECUTE FUNCTION rcs.set_updated_at();

-- Preserva linhas em dispatch_log ao remover número ou variação (histórico intacto)
ALTER TABLE rcs.dispatch_log DROP CONSTRAINT IF EXISTS dispatch_log_number_id_fkey;
ALTER TABLE rcs.dispatch_log
  ADD CONSTRAINT dispatch_log_number_id_fkey
  FOREIGN KEY (number_id) REFERENCES rcs.numbers(id) ON DELETE SET NULL;

ALTER TABLE rcs.dispatch_log DROP CONSTRAINT IF EXISTS dispatch_log_variation_id_fkey;
ALTER TABLE rcs.dispatch_log
  ADD CONSTRAINT dispatch_log_variation_id_fkey
  FOREIGN KEY (variation_id) REFERENCES rcs.message_variations(id) ON DELETE SET NULL;
