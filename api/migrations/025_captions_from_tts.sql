ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS captions_from_tts boolean NOT NULL DEFAULT false;
