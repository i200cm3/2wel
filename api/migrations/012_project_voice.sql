-- Новые объекты озвучиваются Сбером; уже существующие озвучивались ElevenLabs,
-- поэтому им оставляем прежний сервис — переключить можно в кабинете.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tts_provider text NOT NULL DEFAULT 'sber',
  ADD COLUMN IF NOT EXISTS tts_voice text NOT NULL DEFAULT 'Nec_24000';

ALTER TABLE projects
  ADD CONSTRAINT projects_tts_provider_check CHECK (tts_provider IN ('sber', 'elevenlabs'));

UPDATE projects SET tts_provider = 'elevenlabs', tts_voice = '';
