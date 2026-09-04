-- Учёт расхода TTS (символы) по владельцу проекта.
CREATE TABLE tts_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
  provider text NOT NULL,
  characters integer NOT NULL CHECK (characters > 0),
  voice text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tts_usage_provider_check CHECK (provider IN ('elevenlabs', 'sber'))
);

CREATE INDEX tts_usage_user_created_idx ON tts_usage (user_id, created_at DESC);
CREATE INDEX tts_usage_created_idx ON tts_usage (created_at DESC);
CREATE INDEX tts_usage_provider_created_idx ON tts_usage (provider, created_at DESC);
