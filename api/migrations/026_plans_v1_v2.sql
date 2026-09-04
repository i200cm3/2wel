-- Два тарифа по продукту (V1 / V2), без пакетов ссылок.
-- Старые «Поток» / «Полный» → Про.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_plan_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_pending_plan_check;

UPDATE projects SET plan = 'pro' WHERE plan IN ('flow', 'max');
UPDATE projects SET pending_plan = 'pro' WHERE pending_plan IN ('flow', 'max');

UPDATE plan_changes SET from_plan = 'pro' WHERE from_plan IN ('flow', 'max');
UPDATE plan_changes SET to_plan = 'pro' WHERE to_plan IN ('flow', 'max');

ALTER TABLE projects
  ADD CONSTRAINT projects_plan_check CHECK (plan IN ('start', 'pro')),
  ADD CONSTRAINT projects_pending_plan_check
    CHECK (pending_plan IS NULL OR pending_plan IN ('start', 'pro'));
