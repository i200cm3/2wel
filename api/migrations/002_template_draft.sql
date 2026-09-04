ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS draft_config jsonb;
