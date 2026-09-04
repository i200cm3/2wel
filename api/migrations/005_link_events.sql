CREATE TABLE link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type text NOT NULL,
  device text NOT NULL DEFAULT 'desktop',
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT link_events_type_check CHECK (type IN ('open', 'autoplay', 'menu', 'whatsapp')),
  CONSTRAINT link_events_device_check CHECK (device IN ('phone', 'tablet', 'desktop'))
);

CREATE INDEX link_events_project_created_idx ON link_events (project_id, created_at DESC);
CREATE INDEX link_events_project_type_idx ON link_events (project_id, type, created_at DESC);
CREATE INDEX link_events_link_idx ON link_events (link_id);
