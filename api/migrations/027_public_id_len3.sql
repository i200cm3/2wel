-- Guest link public_id: allow 3–16 chars (new links use length 3; old longer ids stay valid).
ALTER TABLE links DROP CONSTRAINT IF EXISTS links_public_id_check;
ALTER TABLE links
  ADD CONSTRAINT links_public_id_check CHECK (public_id ~ '^[a-z0-9]{3,16}$');
