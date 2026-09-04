ALTER TABLE link_raw_sources
  ADD COLUMN IF NOT EXISTS meta jsonb;
