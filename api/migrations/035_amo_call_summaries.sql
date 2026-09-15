-- Авто-саммари звонков → заметка в amo (идемпотентность по call_note_id).
CREATE TABLE amo_call_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  lead_id text NOT NULL,
  call_note_id text NOT NULL,
  recording_url text,
  transcript text,
  summary_outcome text,
  summary_next_step text,
  summary_note_id text,
  status text NOT NULL DEFAULT 'pending',
  skip_reason text,
  error text,
  pipeline_id text,
  status_id text,
  duration_sec integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amo_call_summaries_status_check CHECK (
    status IN ('pending', 'running', 'done', 'skipped', 'failed')
  ),
  CONSTRAINT amo_call_summaries_unique UNIQUE (project_id, call_note_id)
);

CREATE INDEX amo_call_summaries_project_lead_idx
  ON amo_call_summaries (project_id, lead_id);

CREATE INDEX amo_call_summaries_status_idx
  ON amo_call_summaries (status);
