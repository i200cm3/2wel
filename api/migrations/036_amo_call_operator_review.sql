-- Разбор недоработки оператора (отдельная заметка в amo при упущенной брони).
ALTER TABLE amo_call_summaries
  ADD COLUMN IF NOT EXISTS operator_review_miss text,
  ADD COLUMN IF NOT EXISTS operator_review_detail text,
  ADD COLUMN IF NOT EXISTS operator_review_note_id text;
