import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authEnv } from './auth.js'
import { closePool, query, waitForDb } from './db.js'
import { publicDir } from './env.js'
import { isolateProjectMedia } from './projectMedia.mjs'
import { hashPassword } from './password.js'

const DJINAL_CODE = 'djinal'
const TEMPLATE_CODE = 'default'

function isPropertyConfig(value) {
  if (!value || typeof value !== 'object') return false
  return (
    typeof value.brand === 'object' &&
    value.brand !== null &&
    typeof value.sequences === 'object' &&
    value.sequences !== null &&
    Array.isArray(value.flow) &&
    Array.isArray(value.branches)
  )
}

function loadDjinalConfig() {
  const filePath = path.join(publicDir(), 'properties', `${DJINAL_CODE}.json`)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Нет файла шаблона: ${filePath}`)
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isPropertyConfig(data)) {
    throw new Error(`${filePath} не похож на конфиг презентации`)
  }
  return data
}

export async function seed() {
  await waitForDb()
  const env = authEnv()
  if (!env.login || !env.password) {
    throw new Error('EDITOR_LOGIN / EDITOR_PASSWORD не заданы — нечем заполнить пользователя')
  }

  const config = loadDjinalConfig()
  const email = env.login.includes('@') ? env.login : `${env.login}@promo.local`
  const displayName = typeof config.brand?.name === 'string' ? config.brand.name : env.login
  const projectName =
    typeof config.brand?.fullName === 'string' ? config.brand.fullName : 'Презентация Джинал'

  const existingUser = await query('SELECT id, login FROM users WHERE login = $1', [env.login])
  let userId
  if (existingUser.rowCount) {
    userId = existingUser.rows[0].id
    await query(`UPDATE users SET is_admin = true WHERE id = $1 AND is_admin = false`, [userId])
    console.log(`seed: user ${env.login} already exists`)
  } else {
    const inserted = await query(
      `INSERT INTO users (login, email, password_hash, name, is_admin)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [env.login, email, hashPassword(env.password), displayName],
    )
    userId = inserted.rows[0].id
    console.log(`seed: created user ${env.login}`)
  }

  const existingProject = await query('SELECT id FROM projects WHERE code = $1', [DJINAL_CODE])
  let projectId
  if (existingProject.rowCount) {
    projectId = existingProject.rows[0].id
    console.log(`seed: project ${DJINAL_CODE} already exists`)
  } else {
    const inserted = await query(
      `INSERT INTO projects (user_id, code, name, type, status)
       VALUES ($1, $2, $3, 'presentation', 'published')
       RETURNING id`,
      [userId, DJINAL_CODE, projectName],
    )
    projectId = inserted.rows[0].id
    console.log(`seed: created project ${DJINAL_CODE}`)
  }

  const existingTemplate = await query(
    'SELECT id FROM templates WHERE project_id = $1 AND code = $2',
    [projectId, TEMPLATE_CODE],
  )
  if (existingTemplate.rowCount) {
    console.log(`seed: template ${TEMPLATE_CODE} already exists (config not overwritten)`)
  } else {
    await query(
      `INSERT INTO templates (project_id, code, name, config, is_default, status)
       VALUES ($1, $2, $3, $4::jsonb, true, 'published')`,
      [projectId, TEMPLATE_CODE, 'Основная', JSON.stringify(config)],
    )
    console.log(`seed: created template ${DJINAL_CODE}/${TEMPLATE_CODE}`)
  }

  await isolateProjectMedia(DJINAL_CODE)
  console.log(`seed: isolated media for ${DJINAL_CODE}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  seed()
    .then(async () => {
      await closePool()
    })
    .catch(async (err) => {
      console.error(err)
      await closePool().catch(() => undefined)
      process.exit(1)
    })
}
