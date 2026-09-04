CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text NOT NULL UNIQUE,
  email text UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'presentation',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_code_check CHECK (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  CONSTRAINT projects_type_check CHECK (type IN ('presentation')),
  CONSTRAINT projects_status_check CHECK (status IN ('draft', 'published'))
);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code),
  CONSTRAINT templates_code_check CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT templates_status_check CHECK (status IN ('draft', 'published'))
);

CREATE UNIQUE INDEX templates_one_default_per_project
  ON templates (project_id)
  WHERE is_default;

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE,
  guest_name text NOT NULL,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  CONSTRAINT links_public_id_check CHECK (public_id ~ '^[a-z0-9]{3,16}$')
);

CREATE UNIQUE INDEX links_project_external_id_uidx
  ON links (project_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX links_project_created_idx ON links (project_id, created_at DESC);
CREATE INDEX links_template_idx ON links (template_id);
