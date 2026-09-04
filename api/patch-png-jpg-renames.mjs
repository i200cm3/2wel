#!/usr/bin/env node
/**
 * Допатчить templates в БД после PNG→JPG rename из optimize-library
 * (если Postgres был выключен во время прогона).
 */
import { query } from './db.mjs'

const RENAMES = [
  [
    '/media/projects/djinal/library/gallery/07-procedury/image.png',
    '/media/projects/djinal/library/gallery/07-procedury/image.jpg',
  ],
  [
    '/media/projects/djinal/library/gallery/07-procedury/med.png',
    '/media/projects/djinal/library/gallery/07-procedury/med.jpg',
  ],
  [
    '/media/projects/djinal/library/gallery/07-procedury/vrach.png',
    '/media/projects/djinal/library/gallery/07-procedury/vrach.jpg',
  ],
  [
    '/media/projects/djinal/library/gallery/08-registratura/IMG_0392--.png',
    '/media/projects/djinal/library/gallery/08-registratura/IMG_0392--.jpg',
  ],
  [
    '/media/projects/djinal/library/gallery/08-registratura/IMG_0394-2.png',
    '/media/projects/djinal/library/gallery/08-registratura/IMG_0394-2.jpg',
  ],
  [
    '/media/projects/djinal/library/gallery/uploads/image-9x16.png',
    '/media/projects/djinal/library/gallery/uploads/image-9x16.jpg',
  ],
]

for (const [fromSrc, toSrc] of RENAMES) {
  const r = await query(
    `UPDATE templates
     SET config = replace(config::text, $1, $2)::jsonb,
         draft_config = CASE
           WHEN draft_config IS NULL THEN NULL
           ELSE replace(draft_config::text, $1, $2)::jsonb
         END,
         updated_at = now()
     WHERE config::text LIKE $3 OR coalesce(draft_config::text, '') LIKE $3`,
    [fromSrc, toSrc, `%${fromSrc}%`],
  )
  console.log(`${fromSrc.split('/').pop()} → ${toSrc.split('/').pop()}: ${r.rowCount}`)
}
console.log('done')
process.exit(0)
