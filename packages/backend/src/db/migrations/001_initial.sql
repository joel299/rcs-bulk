CREATE SCHEMA IF NOT EXISTS rcs;

-- Orgs -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Users -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES rcs.orgs(id) ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_org_id_idx ON rcs.users(org_id);

-- Numbers --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.numbers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES rcs.orgs(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  phone_label           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending_auth'
                          CHECK (status IN ('pending_auth','authenticated','disconnected','paused')),
  session_path          TEXT,
  messages_sent_today   INT DEFAULT 0,
  max_messages_per_hour INT DEFAULT 50,
  rotation_strategy     TEXT DEFAULT 'round-robin'
                          CHECK (rotation_strategy IN ('round-robin','least-used','sequential')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS numbers_org_id_idx ON rcs.numbers(org_id);

-- Campaigns ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES rcs.orgs(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','scheduled','running','paused','waiting_window','completed','cancelled')),
  schedule_days         TEXT[]  DEFAULT ARRAY['MON','TUE','WED','THU','FRI'],
  schedule_start        TIME    DEFAULT '08:00',
  schedule_end          TIME    DEFAULT '19:00',
  interval_min_seconds  INT     DEFAULT 30,
  interval_max_seconds  INT     DEFAULT 120,
  variation_mode        TEXT    DEFAULT 'random' CHECK (variation_mode IN ('random','sequential')),
  scheduled_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  total_contacts        INT     DEFAULT 0,
  sent_count            INT     DEFAULT 0,
  failed_count          INT     DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaigns_org_id_idx ON rcs.campaigns(org_id);

-- Message Variations ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.message_variations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES rcs.campaigns(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  image_url    TEXT,
  sort_order   INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS variations_campaign_id_idx ON rcs.message_variations(campaign_id);

-- Contacts -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES rcs.campaigns(id) ON DELETE CASCADE,
  name          TEXT,
  phone         TEXT NOT NULL,
  extra         JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
  sent_at       TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS contacts_campaign_id_idx ON rcs.contacts(campaign_id);
CREATE INDEX IF NOT EXISTS contacts_status_idx ON rcs.contacts(campaign_id, status);

-- Dispatch Log ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rcs.dispatch_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES rcs.campaigns(id),
  contact_id    UUID REFERENCES rcs.contacts(id),
  number_id     UUID REFERENCES rcs.numbers(id),
  variation_id  UUID REFERENCES rcs.message_variations(id),
  status        TEXT NOT NULL CHECK (status IN ('sent','failed')),
  message_type  TEXT NOT NULL DEFAULT 'rcs' CHECK (message_type IN ('rcs','sms')),
  error         TEXT,
  dispatched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dispatch_log_campaign_idx ON rcs.dispatch_log(campaign_id);
CREATE INDEX IF NOT EXISTS dispatch_log_dispatched_at_idx ON rcs.dispatch_log(dispatched_at DESC);

-- Auto-atualiza updated_at em numbers
CREATE OR REPLACE FUNCTION rcs.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS numbers_updated_at ON rcs.numbers;
CREATE TRIGGER numbers_updated_at
  BEFORE UPDATE ON rcs.numbers
  FOR EACH ROW EXECUTE FUNCTION rcs.set_updated_at();
