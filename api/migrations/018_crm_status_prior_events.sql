-- Контекст смены статуса: после каких действий гостя пришёл webhook.
ALTER TABLE link_crm_events
  ADD COLUMN IF NOT EXISTS last_event_type text,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS prior_types text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS link_crm_events_last_event_idx
  ON link_crm_events (last_event_type)
  WHERE last_event_type IS NOT NULL;
