ALTER TABLE links
  ADD COLUMN IF NOT EXISTS guest_summary jsonb,
  ADD COLUMN IF NOT EXISTS derived_flow jsonb;
