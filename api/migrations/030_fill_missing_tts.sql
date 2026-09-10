ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS fill_missing_tts boolean NOT NULL DEFAULT true;
