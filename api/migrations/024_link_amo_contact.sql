ALTER TABLE links
  ADD COLUMN IF NOT EXISTS amo_contact_id text,
  ADD COLUMN IF NOT EXISTS amo_phones text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS links_project_amo_contact_idx
  ON links (project_id, amo_contact_id)
  WHERE amo_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS links_amo_phones_gin_idx
  ON links USING GIN (amo_phones);
