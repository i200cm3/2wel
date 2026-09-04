-- Маппинг этапов amoCRM → код шаблона (одна ссылка, другой ролик).
CREATE TABLE amo_status_maps (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  status_id text NOT NULL,
  template_code text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, status_id),
  CONSTRAINT amo_status_maps_status_check CHECK (status_id ~ '^[0-9]{1,64}$'),
  CONSTRAINT amo_status_maps_template_check CHECK (template_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

CREATE INDEX amo_status_maps_project_idx ON amo_status_maps (project_id);
