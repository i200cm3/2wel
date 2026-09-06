import { issueGuestLink } from './cabinet.mjs'
import { query } from './db.js'
import { sendDemoGuestMail } from './mail.mjs'
import { guestLinkUrl } from './publicUrl.mjs'
import { formatGuestName } from './guestLink.mjs'
import { isEmail, normalizeEmail } from './users.mjs'

function demoProjectCode() {
  return String(process.env.DEMO_PROJECT_CODE ?? 'djinal').trim().toLowerCase() || 'djinal'
}

function demoTemplateCode() {
  return String(process.env.DEMO_TEMPLATE_CODE ?? '').trim()
}

function demoSkipTts() {
  const raw = String(process.env.DEMO_SKIP_TTS ?? '1').trim().toLowerCase()
  return raw !== '0' && raw !== 'false'
}

async function projectByCode(code) {
  const { rows } = await query(
    `SELECT id, code, name, skip_tts_on_link_issue, captions_from_tts
     FROM projects WHERE code = $1`,
    [code],
  )
  return rows[0] ?? null
}

async function upsertMarketingLead({
  email,
  emailNormalized,
  name,
  source,
  projectId,
  linkId,
  publicId,
}) {
  const { rows } = await query(
    `INSERT INTO marketing_leads (
       email, email_normalized, name, source, project_id, link_id, public_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email_normalized) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       source = EXCLUDED.source,
       project_id = EXCLUDED.project_id,
       link_id = EXCLUDED.link_id,
       public_id = EXCLUDED.public_id,
       updated_at = now()
     RETURNING id, email, name, public_id, created_at, updated_at`,
    [email, emailNormalized, name, source, projectId, linkId, publicId],
  )
  return rows[0]
}

/**
 * Публичная выдача демо-ссылки с лендинга: имя + email → персональная ссылка,
 * письмо гостю, запись в marketing_leads.
 */
export async function createDemoGuestLead({ name, email, source = 'offer_demo' }) {
  const guestName = formatGuestName(name)
  const emailRaw = String(email ?? '').trim()
  const emailNormalized = normalizeEmail(emailRaw)

  if (!guestName) return { status: 400, error: 'Укажите имя' }
  if (!isEmail(emailNormalized)) return { status: 400, error: 'Укажите корректный email' }

  const projectCode = demoProjectCode()
  const project = await projectByCode(projectCode)
  if (!project) {
    console.error('demo lead: project missing', projectCode)
    return { status: 503, error: 'Демо временно недоступно' }
  }

  const templateCode = demoTemplateCode()
  const issued = await issueGuestLink(
    project,
    {
      name: guestName,
      category: templateCode || undefined,
      externalId: `demo:${emailNormalized}`,
      summaryMeta: { source, email: emailNormalized },
    },
    { skipTts: demoSkipTts() },
  )
  if (issued.error) {
    console.error('demo lead: issue failed', issued.error)
    return {
      status: issued.status || 500,
      error: issued.status === 400 ? issued.error : 'Не удалось выдать демо-ссылку',
    }
  }

  const publicId = issued.link?.publicId
  const url =
    issued.link?.url ||
    (publicId ? guestLinkUrl(project.code, publicId) : '')
  if (!url) return { status: 500, error: 'Не удалось выдать демо-ссылку' }

  await upsertMarketingLead({
    email: emailRaw,
    emailNormalized,
    name: guestName,
    source,
    projectId: project.id,
    linkId: issued.link?.id ?? null,
    publicId: publicId ?? null,
  })

  const mail = await sendDemoGuestMail(emailNormalized, {
    name: guestName,
    link: url,
  })
  if (!mail.ok && !mail.skipped) {
    console.error('demo lead: mail failed', mail.error)
  }

  return {
    status: 200,
    ok: true,
    url,
    mailed: Boolean(mail.ok),
    reused: Boolean(issued.reused),
  }
}
