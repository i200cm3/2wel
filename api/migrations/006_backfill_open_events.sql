-- Открытия писались в links.open_count до (или без) записи в link_events.
-- Восстанавливаем события, чтобы график и карточки смотрели в одно место.
INSERT INTO link_events (link_id, project_id, type, device, created_at)
SELECT
  l.id,
  l.project_id,
  'open',
  'desktop',
  COALESCE(l.first_opened_at, l.created_at)
FROM links l
CROSS JOIN LATERAL generate_series(1, l.open_count) AS g(n)
WHERE l.open_count > 0
  AND NOT EXISTS (
    SELECT 1 FROM link_events e WHERE e.link_id = l.id AND e.type = 'open'
  );
