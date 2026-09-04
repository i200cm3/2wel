ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

UPDATE users
SET is_admin = true
WHERE is_admin = false
  AND (
    id IN (SELECT user_id FROM projects WHERE code = 'djinal')
    OR id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
  );
