import { assertAuthSecret } from './auth.mjs'
import { assertSmtpPassSafe } from './mail.mjs'
import { closePool } from './db.mjs'
import { migrate } from './migrate.mjs'
import { seed } from './seed.mjs'

assertAuthSecret()
assertSmtpPassSafe()

try {
  await migrate()
  await seed()
} catch (err) {
  console.error(err)
  await closePool().catch(() => undefined)
  process.exit(1)
}

await import('./server.mjs')
