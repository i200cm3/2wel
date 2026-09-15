-- Несколько API-ключей ElevenLabs с выбором активного.
CREATE TABLE IF NOT EXISTS platform_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL DEFAULT '',
  api_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_api_keys_provider_check CHECK (provider IN ('elevenlabs'))
);

CREATE INDEX IF NOT EXISTS platform_api_keys_provider_created_idx
  ON platform_api_keys (provider, created_at DESC);

-- Не больше одного активного ключа на провайдера.
CREATE UNIQUE INDEX IF NOT EXISTS platform_api_keys_one_active_per_provider
  ON platform_api_keys (provider)
  WHERE is_active;

-- Перенос одиночного ключа из platform_settings (если был).
INSERT INTO platform_api_keys (provider, label, api_key, is_active)
SELECT
  'elevenlabs',
  'Импорт',
  trim(value),
  true
FROM platform_settings
WHERE key = 'integrations.elevenlabs.api_key'
  AND trim(value) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM platform_api_keys WHERE provider = 'elevenlabs'
  );

DELETE FROM platform_settings
WHERE key = 'integrations.elevenlabs.api_key';
