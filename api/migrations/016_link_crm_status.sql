-- Снимок статуса сделки amoCRM на ссылке + история смен для статистики.
ALTER TABLE links
  ADD COLUMN IF NOT EXISTS crm_status_id text,
  ADD COLUMN IF NOT EXISTS crm_pipeline_id text,
  ADD COLUMN IF NOT EXISTS crm_status_at timestamptz;

CREATE TABLE IF NOT EXISTS link_crm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  status_id text NOT NULL,
  pipeline_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS link_crm_events_link_created_idx
  ON link_crm_events (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS links_project_crm_status_idx
  ON links (project_id, crm_status_id)
  WHERE crm_status_id IS NOT NULL;
