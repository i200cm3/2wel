-- Call insights (аналитика): intent / отказ / темы / факты / follow-up.
ALTER TABLE amo_call_summaries
  ADD COLUMN IF NOT EXISTS insights_intent text,
  ADD COLUMN IF NOT EXISTS insights_decline_reason text,
  ADD COLUMN IF NOT EXISTS insights_topics jsonb,
  ADD COLUMN IF NOT EXISTS insights_facts jsonb,
  ADD COLUMN IF NOT EXISTS insights_needs_follow_up boolean,
  ADD COLUMN IF NOT EXISTS insights_at timestamptz;

CREATE INDEX IF NOT EXISTS amo_call_summaries_insights_intent_idx
  ON amo_call_summaries (project_id, insights_intent)
  WHERE insights_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS amo_call_summaries_insights_decline_idx
  ON amo_call_summaries (project_id, insights_decline_reason)
  WHERE insights_decline_reason IS NOT NULL;
