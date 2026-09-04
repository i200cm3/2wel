ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS skip_tts_on_link_issue boolean NOT NULL DEFAULT false;
