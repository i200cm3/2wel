-- Звонящий в саммари/разборах: «клиент» → «гость» (как guests в схеме).
-- Длинные формы раньше коротких, чтобы не ломать склонения.
-- Транскрипт не трогаем (метки STT «Клиент:» — исторические).

CREATE OR REPLACE FUNCTION promo_rewrite_client_as_guest(src text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  out text := src;
BEGIN
  IF out IS NULL OR out = '' THEN
    RETURN out;
  END IF;
  out := replace(out, 'Клиентом', 'Гостем');
  out := replace(out, 'клиентом', 'гостем');
  out := replace(out, 'Клиенту', 'Гостю');
  out := replace(out, 'клиенту', 'гостю');
  out := replace(out, 'Клиента', 'Гостя');
  out := replace(out, 'клиента', 'гостя');
  out := replace(out, 'Клиенте', 'Госте');
  out := replace(out, 'клиенте', 'госте');
  out := replace(out, 'Клиентов', 'Гостей');
  out := replace(out, 'клиентов', 'гостей');
  out := replace(out, 'Клиентам', 'Гостям');
  out := replace(out, 'клиентам', 'гостям');
  out := replace(out, 'Клиентах', 'Гостях');
  out := replace(out, 'клиентах', 'гостях');
  out := replace(out, 'Клиенты', 'Гости');
  out := replace(out, 'клиенты', 'гости');
  out := replace(out, 'Клиент', 'Гость');
  out := replace(out, 'клиент', 'гость');
  RETURN out;
END;
$$;

UPDATE amo_call_summaries
SET
  summary_outcome = promo_rewrite_client_as_guest(summary_outcome),
  summary_next_step = promo_rewrite_client_as_guest(summary_next_step),
  operator_review_miss = promo_rewrite_client_as_guest(operator_review_miss),
  operator_review_detail = promo_rewrite_client_as_guest(operator_review_detail),
  updated_at = now()
WHERE
  summary_outcome ~* 'клиент'
  OR summary_next_step ~* 'клиент'
  OR operator_review_miss ~* 'клиент'
  OR operator_review_detail ~* 'клиент';

-- Тексты в guest_summary jsonb (hello / dates / room / …), если модель написала «клиент».
UPDATE links
SET guest_summary = (
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN jsonb_typeof(value) = 'string'
        THEN to_jsonb(promo_rewrite_client_as_guest(value #>> '{}'))
      ELSE value
    END
  )
  FROM jsonb_each(guest_summary)
)
WHERE guest_summary IS NOT NULL
  AND guest_summary::text ~* 'клиент';

DROP FUNCTION promo_rewrite_client_as_guest(text);
