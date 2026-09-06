CREATE TABLE marketing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'offer_demo',
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  link_id uuid REFERENCES links (id) ON DELETE SET NULL,
  public_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketing_leads_created_idx ON marketing_leads (created_at DESC);
CREATE INDEX marketing_leads_project_idx ON marketing_leads (project_id, created_at DESC);
