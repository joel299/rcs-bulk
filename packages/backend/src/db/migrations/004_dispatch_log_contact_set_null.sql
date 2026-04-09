-- Migration 004: preserva histórico de dispatch ao excluir contato
-- Troca NO ACTION → SET NULL na FK dispatch_log.contact_id

ALTER TABLE rcs.dispatch_log
  DROP CONSTRAINT IF EXISTS dispatch_log_contact_id_fkey,
  ADD CONSTRAINT dispatch_log_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES rcs.contacts(id) ON DELETE SET NULL;
