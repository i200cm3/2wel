import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, waitForDb } from './db.js'
import { createProjectForUser } from './cabinet.mjs'
import { findUserByEmail, registerUser, setUserPassword } from './users.mjs'

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return fallback
  return String(process.argv[idx + 1] ?? '').trim()
}

function flag(name) {
  return process.argv.includes(name)
}

function usage() {
  console.error(`Создать пользователя или сменить пароль.

  node create-user.mjs --email hotel@example.com --password 'secret12' [--name 'Джинал']
  node create-user.mjs --email hotel@example.com --password 'secret12' --reset
  node create-user.mjs --email hotel@example.com --password 'secret12' --project 'Джинал'
`)
}

async function main() {
  const email = arg('--email')
  const password = arg('--password')
  const name = arg('--name') || email
  const reset = flag('--reset')
  const projectName = arg('--project')
  if (!email || !password) {
    usage()
    process.exit(1)
  }
  await waitForDb()
  const existing = await findUserByEmail(email)
  if (existing) {
    if (!reset) {
      console.error(`Пользователь ${email} уже есть. Для смены пароля добавьте --reset`)
      process.exit(1)
    }
    const updated = await setUserPassword(existing.id, password)
    if (!updated.ok) {
      console.error(updated.error)
      process.exit(1)
    }
    console.log(`password updated for ${email}`)
    return
  }
  const created = await registerUser({ email, password, name })
  if (!created.ok) {
    console.error(created.error)
    process.exit(1)
  }
  console.log(`created user ${created.user.email || created.user.login}`)
  if (projectName) {
    const project = await createProjectForUser(created.user.id, { name: projectName })
    if (project.error) {
      console.error(project.error)
      process.exit(1)
    }
    console.log(`created project ${project.project.code}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main()
    .then(async () => {
      await closePool()
    })
    .catch(async (err) => {
      console.error(err)
      await closePool().catch(() => undefined)
      process.exit(1)
    })
}
