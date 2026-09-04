ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'start',
  ADD COLUMN IF NOT EXISTS plan_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS pending_plan text,
  ADD COLUMN IF NOT EXISTS pending_effective_at timestamptz;

UPDATE projects SET plan_period_start = created_at WHERE plan_period_start IS NULL;

ALTER TABLE projects
  ALTER COLUMN plan_period_start SET NOT NULL,
  ALTER COLUMN plan_period_start SET DEFAULT now();

ALTER TABLE projects
  ADD CONSTRAINT projects_plan_check CHECK (plan IN ('start', 'flow', 'max')),
  ADD CONSTRAINT projects_pending_plan_check
    CHECK (pending_plan IS NULL OR pending_plan IN ('start', 'flow', 'max')),
  ADD CONSTRAINT projects_pending_plan_pair_check
    CHECK ((pending_plan IS NULL) = (pending_effective_at IS NULL));

CREATE INDEX projects_pending_plan_idx
  ON projects (pending_effective_at)
  WHERE pending_plan IS NOT NULL;

CREATE TABLE plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_plan text NOT NULL,
  to_plan text NOT NULL,
  kind text NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_changes_kind_check CHECK (kind IN ('upgrade', 'downgrade', 'cancelled'))
);

CREATE INDEX plan_changes_project_idx ON plan_changes (project_id, created_at DESC);
