ALTER TABLE link_events
  DROP CONSTRAINT link_events_type_check;

ALTER TABLE link_events
  ADD CONSTRAINT link_events_type_check
    CHECK (type IN ('open', 'autoplay', 'menu', 'whatsapp', 'topic'));

ALTER TABLE link_events
  ADD COLUMN IF NOT EXISTS topic text;

CREATE INDEX IF NOT EXISTS link_events_project_topic_idx
  ON link_events (project_id, topic)
  WHERE type = 'topic' AND topic IS NOT NULL;
