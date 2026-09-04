ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tts_elevenlabs_enabled boolean NOT NULL DEFAULT false;
