CREATE TABLE amo_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  base_domain text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  webhook_token text,
  webhook_destination text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amo_connections_domain_check CHECK (base_domain ~ '^[a-z0-9][a-z0-9.-]+[a-z0-9]$')
);

CREATE INDEX amo_connections_domain_idx ON amo_connections (base_domain);
