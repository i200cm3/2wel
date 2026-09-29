-- Очередь follow-up по звонкам (открыто / сделано + срок).
ALTER TABLE amo_call_summaries
  ADD COLUMN IF NOT EXISTS follow_up_status text,
  ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_done_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amo_call_summaries_follow_up_status_check'
  ) THEN
    ALTER TABLE amo_call_summaries
      ADD CONSTRAINT amo_call_summaries_follow_up_status_check
      CHECK (follow_up_status IS NULL OR follow_up_status IN ('open', 'done'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS amo_call_summaries_follow_up_open_idx
  ON amo_call_summaries (project_id, follow_up_due_at)
  WHERE follow_up_status = 'open';
