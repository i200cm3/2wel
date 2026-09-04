ALTER TABLE links
  ADD COLUMN IF NOT EXISTS amo_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS assembly_trace jsonb,
  ADD COLUMN IF NOT EXISTS summary_meta jsonb;

CREATE TABLE IF NOT EXISTS link_raw_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('chat', 'call_transcript', 'note', 'manual', 'amo_export')),
  title text NOT NULL DEFAULT '',
  body text NOT NULL,
  external_ref text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS link_raw_sources_link_id_idx
  ON link_raw_sources (link_id, created_at DESC);
