ALTER TABLE link_events
  DROP CONSTRAINT link_events_type_check;

ALTER TABLE link_events
  ADD CONSTRAINT link_events_type_check
    CHECK (type IN ('open', 'play', 'autoplay', 'menu', 'whatsapp', 'topic', 'contact'));
