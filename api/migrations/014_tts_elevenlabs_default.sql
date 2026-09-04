-- Переводим объекты на ElevenLabs (Сбер больше не используем в кабинете).
UPDATE projects
SET tts_provider = 'elevenlabs', tts_voice = '', updated_at = now()
WHERE tts_provider = 'sber';
