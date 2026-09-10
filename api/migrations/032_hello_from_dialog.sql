ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hello_from_dialog boolean NOT NULL DEFAULT false;
