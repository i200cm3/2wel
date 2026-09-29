-- Согласование после «Гость»: женское прошедшее → мужское (Гость уточнила → уточнил).
-- Безличные формулировки — в промпте; здесь чиним уже записанное.

CREATE OR REPLACE FUNCTION promo_agree_guest_past(src text)
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
  -- «Гость Xла и Yла»
  out := regexp_replace(
    out,
    '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})лась(\s+и\s+)([А-Яа-яЁё-]{2,})лась',
    '\1\2\3лся\4\5лся',
    'g'
  );
  out := regexp_replace(
    out,
    '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})ла(\s+и\s+)([А-Яа-яЁё-]{2,})ла',
    '\1\2\3л\4\5л',
    'g'
  );
  out := regexp_replace(
    out,
    '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})лась(\s+и\s+)([А-Яа-яЁё-]{2,})ла',
    '\1\2\3лся\4\5л',
    'g'
  );
  out := regexp_replace(
    out,
    '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})ла(\s+и\s+)([А-Яа-яЁё-]{2,})лась',
    '\1\2\3л\4\5лся',
    'g'
  );
  -- одиночный глагол
  out := regexp_replace(out, '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})лась', '\1\2\3лся', 'g');
  out := regexp_replace(out, '(Гость|гость)(\s+)([А-Яа-яЁё-]{2,})ла', '\1\2\3л', 'g');
  RETURN out;
END;
$$;

UPDATE amo_call_summaries
SET
  summary_outcome = promo_agree_guest_past(summary_outcome),
  summary_next_step = promo_agree_guest_past(summary_next_step),
  operator_review_miss = promo_agree_guest_past(operator_review_miss),
  operator_review_detail = promo_agree_guest_past(operator_review_detail),
  updated_at = now()
WHERE
  summary_outcome ~ '(Гость|гость)[[:space:]]+[А-Яа-яЁё-]+ла'
  OR summary_next_step ~ '(Гость|гость)[[:space:]]+[А-Яа-яЁё-]+ла'
  OR operator_review_miss ~ '(Гость|гость)[[:space:]]+[А-Яа-яЁё-]+ла'
  OR operator_review_detail ~ '(Гость|гость)[[:space:]]+[А-Яа-яЁё-]+ла';

DROP FUNCTION promo_agree_guest_past(text);
