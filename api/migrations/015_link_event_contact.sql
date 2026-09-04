ALTER TABLE link_events
  DROP CONSTRAINT link_events_type_check;

ALTER TABLE link_events
  ADD CONSTRAINT link_events_type_check
    CHECK (type IN ('open', 'autoplay', 'menu', 'whatsapp', 'topic', 'contact'));

CREATE INDEX IF NOT EXISTS link_events_project_contact_idx
  ON link_events (project_id, topic)
  WHERE type = 'contact' AND topic IS NOT NULL;
