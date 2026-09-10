import { applyDerivedFlowToConfig, computeLinkAssembly, normalizeGuestSummary } from './assembly.mjs'
import { amoRedirectUri, clearAmoLeadPresentationUrl } from './amoAuth.mjs'
import { syncAmoCallsToLink, probeRecordingUrlsDetailed, recordingProbeAvailability } from './amoCalls.mjs'
import { getAmoConnection } from './amoConnections.mjs'
import { query } from './db.js'
import { geminiTranscribeConfigured, transcribeAudioFromUrl } from './geminiTranscribe.mjs'
import { assemblyTextConfigured } from './yandexGpt.mjs'
import { assemblyTextConfigError } from './platformIntegrations.mjs'
import {
  buildRawTextFromSources,
  extractGuestSummaryFromRawText,
} from './guestSummaryExtract.mjs'
import { resolveSummaryHello } from './helloGenerate.mjs'
import { guestLinkUrl } from './publicUrl.mjs'
import { projectJoinUrl } from './access.mjs'
import { sendTeamInviteMail } from './mail.mjs'
import { ensureGuestHost } from './guestSsl.mjs'
import { linkEventStats, projectEventStats } from './events.mjs'
import { createApiKey, deleteApiKey, listApiKeys, revokeApiKey } from './keys.mjs'
import {
  deleteProjectLink,
  deleteLinkRawSource,
  generatePublicId,
  getLinkByExternalId,
  getProjectLinkDetail,
  getProjectLinkRow,
  getLinkRawSource,
  insertLink,
  mergeLinkRawSourceMeta,
  insertLinkRawSources,
  listLinkRawSources,
  normalizeRawKind,
  updateLinkRawSource,
  updateLinkTemplate,
} from './links.mjs'
import {
  copyStarterLibrary,
  copyStarterTts,
  ensureProjectMedia,
  listUnusedProjectMedia,
  mediaSrcsFromConfigs,
  projectMusicSrc,
  purgeProjectMediaSrcs,
  renameProjectMedia,
  rewriteConfigMedia,
  rewriteConfigProjectCode,
} from './projectMedia.mjs'
import { decideGuestLink, parseGuestLinkBody, resolveTemplateCode } from './guestLink.mjs'
import { listAmoStatusMaps } from './amoStatusMaps.mjs'
import { parseProjectCode } from './projectCode.mjs'
import { blankPresentationConfig, trialPresentationConfig } from './starter.mjs'
import { ensureMissingStaticTts, personalizeConfigTts, resyncStaleStaticTts } from './ttsPersonalize.mjs'
import {
  applyDuePlanChanges,
  changeProjectPlan,
  currentPeriod,
  loadProjectPlan,
  periodLinkCount,
  periodLinkCounts,
  planColumns,
  planSummary,
} from './plans.mjs'
import {
  canManageProject,
  inviteOrAddMember,
  leaveProject,
  listProjectTeam,
  removeProjectMember,
  revokeProjectInvite,
} from './members.mjs'

const CODE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

const PROJECT_SELECT = `id, code, name, user_id, type, status, created_at, updated_at, skip_tts_on_link_issue, captions_from_tts, fill_missing_tts, hello_from_dialog, ${planColumns()}`

export async function projectForUser(userId, code) {
  if (!code || !CODE_RE.test(code)) return null
  const { rows } = await query(
    `SELECT ${PROJECT_SELECT},
            CASE
              WHEN user_id = $1 THEN 'owner'
              WHEN EXISTS (
                SELECT 1 FROM project_members m
                WHERE m.project_id = projects.id AND m.user_id = $1
              ) THEN 'member'
              ELSE NULL
            END AS access_role
     FROM projects WHERE code = $2`,
    [userId, code],
  )
  const row = rows[0]
  if (!row) return null
  if (row.access_role) return row

  const { rows: admins } = await query(`SELECT is_admin FROM users WHERE id = $1`, [userId])
  if (!admins[0]?.is_admin) return null
  return { ...row, access_role: 'admin' }
}

function mapProject(row, stats, periodLinks) {
  const role = row.access_role || row.role || 'owner'
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    skipTtsOnLinkIssue: Boolean(row.skip_tts_on_link_issue),
    captionsFromTts: Boolean(row.captions_from_tts),
    fillMissingTts: row.fill_missing_tts == null ? true : Boolean(row.fill_missing_tts),
    helloFromDialog: Boolean(row.hello_from_dialog),
    role,
    stats: {
      templates: Number(stats?.templates ?? 0),
      links: Number(stats?.links ?? 0),
      opens: Number(stats?.opens ?? 0),
    },
    plan: planSummary(row, periodLinks ?? 0),
  }
}

async function projectSkipsTtsOnLinkIssue(project) {
  if (!project?.id) return false
  if (Object.prototype.hasOwnProperty.call(project, 'skip_tts_on_link_issue')) {
    return Boolean(project.skip_tts_on_link_issue)
  }
  if (Object.prototype.hasOwnProperty.call(project, 'skipTtsOnLinkIssue')) {
    return Boolean(project.skipTtsOnLinkIssue)
  }
  const { rows } = await query(`SELECT skip_tts_on_link_issue FROM projects WHERE id = $1`, [project.id])
  return Boolean(rows[0]?.skip_tts_on_link_issue)
}

/** Догенерировать ttsSrc по ttsText, если файла ещё нет (по умолчанию включено). */
async function projectFillsMissingTts(project) {
  if (!project?.id) return true
  if (Object.prototype.hasOwnProperty.call(project, 'fill_missing_tts')) {
    return project.fill_missing_tts == null ? true : Boolean(project.fill_missing_tts)
  }
  if (Object.prototype.hasOwnProperty.call(project, 'fillMissingTts')) {
    return project.fillMissingTts == null ? true : Boolean(project.fillMissingTts)
  }
  const { rows } = await query(`SELECT fill_missing_tts FROM projects WHERE id = $1`, [project.id])
  return rows[0]?.fill_missing_tts == null ? true : Boolean(rows[0].fill_missing_tts)
}

async function projectHelloFromDialog(project) {
  if (!project?.id) return false
  if (Object.prototype.hasOwnProperty.call(project, 'hello_from_dialog')) {
    return Boolean(project.hello_from_dialog)
  }
  if (Object.prototype.hasOwnProperty.call(project, 'helloFromDialog')) {
    return Boolean(project.helloFromDialog)
  }
  const { rows } = await query(`SELECT hello_from_dialog FROM projects WHERE id = $1`, [project.id])
  return Boolean(rows[0]?.hello_from_dialog)
}

async function attachHelloToSummary(project, summary, { rawText = '', brandName = '', reuseExisting = false } = {}) {
  const enabled = await projectHelloFromDialog(project)
  return resolveSummaryHello(summary, { enabled, rawText, brandName, reuseExisting })
}

async function projectPayload(row, stats) {
  const period = currentPeriod(row.plan_period_start ?? row.created_at)
  return mapProject(row, stats, await periodLinkCount(row.id, period))
}

export async function listProjects(userId) {
  await applyDuePlanChanges()
  const { rows } = await query(
    `SELECT
       p.id, p.code, p.name, p.type, p.status, p.created_at, p.updated_at, p.skip_tts_on_link_issue, p.captions_from_tts, p.fill_missing_tts, p.hello_from_dialog, ${planColumns('p')},
       (SELECT count(*) FROM templates t WHERE t.project_id = p.id)::int AS templates,
       (SELECT count(*) FROM links l WHERE l.project_id = p.id)::int AS links,
       (SELECT coalesce(sum(l.open_count), 0) FROM links l WHERE l.project_id = p.id)::int AS opens,
       CASE WHEN p.user_id = $1 THEN 'owner' ELSE 'member' END AS access_role
     FROM projects p
     WHERE p.user_id = $1
        OR EXISTS (
          SELECT 1 FROM project_members m
          WHERE m.project_id = p.id AND m.user_id = $1
        )
     ORDER BY CASE WHEN p.user_id = $1 THEN 0 ELSE 1 END, p.created_at DESC`,
    [userId],
  )
  const periodLinks = await periodLinkCounts(rows)
  return rows.map((row) =>
    mapProject(
      row,
      { templates: row.templates, links: row.links, opens: row.opens },
      periodLinks.get(row.id) ?? 0,
    ),
  )
}

function statsRangeFromReq(req) {
  try {
    const q = new URL(req.url || '/', 'http://local').searchParams
    return { from: q.get('from') || '', to: q.get('to') || '' }
  } catch {
    return {}
  }
}

export async function projectStats(projectId, rangeInput) {
  const { rows: counts } = await query(
    `SELECT
       (SELECT count(*) FROM templates t WHERE t.project_id = $1)::int AS templates,
       (SELECT count(*) FROM links l WHERE l.project_id = $1)::int AS links,
       (SELECT coalesce(sum(l.open_count), 0) FROM links l WHERE l.project_id = $1)::int AS opens,
       (SELECT count(*) FROM links l WHERE l.project_id = $1 AND l.first_opened_at IS NOT NULL)::int AS opened_links`,
    [projectId],
  )
  const c = counts[0] ?? { templates: 0, links: 0, opens: 0, opened_links: 0 }
  const events = await projectEventStats(projectId, rangeInput)
  return {
    templates: Number(c.templates),
    links: Number(c.links),
    opens: Number(c.opens),
    openedLinks: Number(c.opened_links),
    range: events.range,
    funnel: events.funnel,
    series: events.series,
    devices: events.devices,
    hours: events.hours,
    topics: events.topics,
    channels: events.channels,
    openRate: events.openRate,
    crmAfter: events.crmAfter,
    crmRecent: events.crmRecent,
    recent: events.recent,
    unopened: events.unopened,
  }
}

export async function listTemplates(projectId) {
  const { rows } = await query(
    `SELECT id, code, name, is_default, status, created_at, updated_at,
            (draft_config IS NOT NULL) AS has_draft
     FROM templates
     WHERE project_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [projectId],
  )
  return rows.map((row) => mapTemplate(row))
}

export async function listLinks(projectId) {
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at, l.first_opened_at, l.open_count,
            l.guest_summary, l.derived_flow, l.summary_meta,
            t.code AS template_code, t.name AS template_name, p.code AS project_code,
            EXISTS (
              SELECT 1 FROM link_raw_sources r WHERE r.link_id = l.id
            ) AS has_raw_sources
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [projectId],
  )
  return rows.map((row) => {
    const summary = row.guest_summary && typeof row.guest_summary === 'object' ? row.guest_summary : null
    const flow = Array.isArray(row.derived_flow) ? row.derived_flow : null
    const meta =
      row.summary_meta && typeof row.summary_meta === 'object' && !Array.isArray(row.summary_meta)
        ? row.summary_meta
        : null
    const pipelineRaw = meta?.pipeline != null ? String(meta.pipeline).trim() : ''
    return {
      id: row.id,
      publicId: row.public_id,
      url: guestLinkUrl(row.project_code, row.public_id),
      guestName: row.guest_name,
      externalId: row.external_id ?? null,
      templateCode: row.template_code,
      templateName: row.template_name,
      createdAt: row.created_at,
      firstOpenedAt: row.first_opened_at,
      openCount: Number(row.open_count),
      summaryPreview: summary
        ? {
            dates: String(summary.dates ?? ''),
            partyType: String(summary.partyType ?? ''),
            topics: String(summary.topics ?? ''),
            objections: String(summary.objections ?? ''),
            confidence: String(summary.confidence ?? ''),
            room: String(summary.room ?? ''),
          }
        : null,
      flowBlockCount: flow ? flow.length : 0,
      hasRawSources: Boolean(row.has_raw_sources),
      pipelineStatus: pipelineRaw || null,
      pipelineStep: meta?.pipelineStep != null ? String(meta.pipelineStep) : null,
    }
  })
}

const TEMPLATE_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

const CYR_SLUG = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'j',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

function slugTemplateCode(value) {
  let out = ''
  for (const ch of String(value ?? '').trim().toLowerCase()) {
    if (CYR_SLUG[ch] !== undefined) out += CYR_SLUG[ch]
    else if (/[a-z0-9]/.test(ch)) out += ch
    else if (ch === ' ' || ch === '-' || ch === '_') out += '-'
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  if (out && /^\d/.test(out)) out = `t-${out}`
  return TEMPLATE_CODE_RE.test(out) ? out : ''
}

function autoTemplateCodes({ name, fromCode, taken }) {
  const bases = []
  const from = TEMPLATE_CODE_RE.test(fromCode) ? fromCode : slugTemplateCode(fromCode)
  if (from) {
    for (let i = 2; i <= 40; i += 1) bases.push(`${from}-${i}`.slice(0, 64))
  }
  const named = slugTemplateCode(name)
  if (named) {
    bases.push(named)
    for (let i = 2; i <= 20; i += 1) bases.push(`${named}-${i}`.slice(0, 64))
  }
  for (let i = 0; i < 8; i += 1) bases.push(generatePublicId(8))
  return bases.filter((code) => TEMPLATE_CODE_RE.test(code) && !taken.has(code))
}

export function isPropertyConfig(value) {
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

function asConfig(value) {
  if (!isPropertyConfig(value)) return null
  return value
}

function cloneTemplateConfig(config, projectCode) {
  const copied = asConfig(config)
  if (!copied) return null
  return rewriteConfigMedia({ ...structuredClone(copied), id: projectCode }, projectCode)
}

function mapTemplate(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default,
    status: row.status,
    hasDraft: Boolean(row.has_draft ?? row.draft_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createProjectForUser(userId, body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { status: 400, error: 'Укажите название объекта' }
  if (name.length > 80) return { status: 400, error: 'Название слишком длинное' }

  const wantedRaw = typeof body?.code === 'string' ? body.code.trim() : ''
  let codes = []
  if (wantedRaw) {
    const parsed = parseProjectCode(wantedRaw)
    if (!parsed.ok) return { status: 400, error: parsed.error }
    codes = [parsed.code]
  } else {
    for (let i = 0; i < 8; i += 1) {
      const generated = generatePublicId(8)
      if (CODE_RE.test(generated) && parseProjectCode(generated).ok) codes.push(generated)
    }
  }

  for (const code of codes) {
    try {
      const { rows } = await query(
        `INSERT INTO projects (user_id, code, name, type, status)
         VALUES ($1, $2, $3, 'presentation', 'draft')
         RETURNING id, code, name, type, status, created_at, updated_at, ${planColumns()}`,
        [userId, code, name],
      )
      const project = rows[0]
      await ensureProjectMedia(code)
      await insertTrialTemplate(project)
      const guestHost = await provisionGuestHost(code)
      const stats = await projectStats(project.id)
      return {
        status: 200,
        project: await projectPayload(project, stats),
        templates: await listTemplates(project.id),
        guestHost,
      }
    } catch (err) {
      if (err && err.code === '23505') {
        if (wantedRaw) return { status: 409, error: 'Этот адрес уже занят. Выберите другой.' }
        continue
      }
      throw err
    }
  }
  return { status: 500, error: 'Не удалось создать объект' }
}

/** Проверка адреса для {code}.2wel.ru: формат, резерв и занятость другим аккаунтом. */
export async function checkProjectCode(userId, raw) {
  const parsed = parseProjectCode(raw)
  if (!parsed.ok) return { available: false, code: '', error: parsed.error }
  const { rows } = await query(`SELECT user_id FROM projects WHERE code = $1`, [parsed.code])
  const owner = rows[0]
  if (owner && owner.user_id !== userId) {
    return { available: false, code: parsed.code, error: 'Этот адрес уже занят. Выберите другой.' }
  }
  return { available: true, code: parsed.code, error: null }
}

export async function updateProjectForUser(project, body) {
  const name =
    typeof body?.name === 'string' ? body.name.trim() : String(project.name ?? '').trim()
  if (!name) return { status: 400, error: 'Укажите название объекта' }
  if (name.length > 80) return { status: 400, error: 'Название слишком длинное' }

  const skipTtsOnLinkIssue =
    typeof body?.skipTtsOnLinkIssue === 'boolean'
      ? body.skipTtsOnLinkIssue
      : typeof body?.skip_tts_on_link_issue === 'boolean'
        ? body.skip_tts_on_link_issue
        : null

  const captionsFromTts =
    typeof body?.captionsFromTts === 'boolean'
      ? body.captionsFromTts
      : typeof body?.captions_from_tts === 'boolean'
        ? body.captions_from_tts
        : null

  const fillMissingTts =
    typeof body?.fillMissingTts === 'boolean'
      ? body.fillMissingTts
      : typeof body?.fill_missing_tts === 'boolean'
        ? body.fill_missing_tts
        : null

  const helloFromDialog =
    typeof body?.helloFromDialog === 'boolean'
      ? body.helloFromDialog
      : typeof body?.hello_from_dialog === 'boolean'
        ? body.hello_from_dialog
        : null

  let nextCode = project.code
  if (typeof body?.code === 'string') {
    const parsed = parseProjectCode(body.code)
    if (!parsed.ok) return { status: 400, error: parsed.error }
    nextCode = parsed.code
  }

  if (nextCode !== project.code) {
    try {
      await renameProjectMedia(project.code, nextCode)
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return { status: 409, error: 'Этот адрес уже занят. Выберите другой.' }
      }
      throw err
    }
  }

  let row
  try {
    const updated = await query(
      `UPDATE projects
       SET name = $2,
           code = $3,
           skip_tts_on_link_issue = COALESCE($4, skip_tts_on_link_issue),
           captions_from_tts = COALESCE($5, captions_from_tts),
           fill_missing_tts = COALESCE($6, fill_missing_tts),
           hello_from_dialog = COALESCE($7, hello_from_dialog),
           updated_at = now()
       WHERE id = $1
       RETURNING id, code, name, type, status, created_at, updated_at, skip_tts_on_link_issue, captions_from_tts, fill_missing_tts, hello_from_dialog, ${planColumns()}`,
      [project.id, name, nextCode, skipTtsOnLinkIssue, captionsFromTts, fillMissingTts, helloFromDialog],
    )
    row = updated.rows[0]
  } catch (err) {
    if (nextCode !== project.code) {
      await renameProjectMedia(nextCode, project.code).catch(() => undefined)
    }
    if (err && err.code === '23505') {
      return { status: 409, error: 'Этот адрес уже занят. Выберите другой.' }
    }
    throw err
  }

  if (nextCode !== project.code) {
    const { rows: templates } = await query(
      `SELECT id, config, draft_config FROM templates WHERE project_id = $1`,
      [project.id],
    )
    for (const tpl of templates) {
      const config = rewriteConfigProjectCode(tpl.config, project.code, nextCode)
      const draft = tpl.draft_config
        ? rewriteConfigProjectCode(tpl.draft_config, project.code, nextCode)
        : null
      await query(
        `UPDATE templates
         SET config = $2::jsonb, draft_config = $3::jsonb
         WHERE id = $1`,
        [tpl.id, JSON.stringify(config), draft ? JSON.stringify(draft) : null],
      )
    }
  }

  const stats = await projectStats(row.id)
  const guestHost = await provisionGuestHost(row.code)
  return { status: 200, project: await projectPayload(row, stats), guestHost }
}

async function provisionGuestHost(code) {
  const result = await ensureGuestHost(code)
  if (!result.ok) console.error('guest host', result.host, result.error)
  return {
    host: result.host,
    ok: result.ok !== false,
    error: result.error || null,
    skipped: Boolean(result.skipped),
    already: Boolean(result.already),
  }
}

function requestedTemplateCode(body) {
  const raw = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : ''
  if (!raw) return ''
  return TEMPLATE_CODE_RE.test(raw) ? raw : null
}

async function createTemplateForProject(project, body) {
  if (body?.starter === true) {
    try {
      const template = await insertTrialTemplate(project, {
        name: typeof body?.name === 'string' ? body.name.trim() : '',
      })
      return { status: 200, template }
    } catch (err) {
      return { status: 500, error: err instanceof Error ? err.message : 'Не удалось создать шаблон' }
    }
  }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { status: 400, error: 'Укажите название' }
  const wanted = requestedTemplateCode(body)
  if (wanted === null) {
    return { status: 400, error: 'Код: латиница, цифры, дефис или подчёркивание (например single)' }
  }
  const existing = await listTemplates(project.id)
  const fromCode = typeof body?.from === 'string' ? body.from.trim().toLowerCase() : ''

  let config = blankPresentationConfig({ id: project.code, name })
  let draft = null
  if (fromCode) {
    const src = await templateByCode(project.id, fromCode)
    if (!src) return { status: 400, error: 'Шаблон для копирования не найден' }
    const published = cloneTemplateConfig(src.config, project.code)
    const working = cloneTemplateConfig(src.draft_config, project.code) || published
    if (!working) return { status: 400, error: 'В исходном шаблоне нет презентации' }
    config = published || working
    draft = cloneTemplateConfig(src.draft_config, project.code)
  }

  const isDefault = existing.length === 0 || body?.isDefault === true
  const taken = new Set(existing.map((item) => item.code))
  if (wanted && taken.has(wanted)) {
    return { status: 409, error: 'Такой код шаблона уже есть' }
  }
  const codes = wanted
    ? [wanted]
    : autoTemplateCodes({ name, fromCode, taken })
  if (isDefault && existing.some((item) => item.isDefault)) {
    await query(`UPDATE templates SET is_default = false WHERE project_id = $1 AND is_default`, [project.id])
  }
  for (const code of codes) {
    if (taken.has(code) || !TEMPLATE_CODE_RE.test(code)) continue
    try {
      const { rows } = await query(
        `INSERT INTO templates (project_id, code, name, config, draft_config, is_default, status)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'draft')
         RETURNING id, code, name, is_default, status, created_at, updated_at`,
        [
          project.id,
          code,
          name.slice(0, 80),
          JSON.stringify(config),
          draft ? JSON.stringify(draft) : null,
          isDefault,
        ],
      )
      return { status: 200, template: mapTemplate(rows[0]) }
    } catch (err) {
      if (err && err.code === '23505') {
        taken.add(code)
        continue
      }
      throw err
    }
  }
  return { status: 500, error: 'Не удалось выдать уникальный код шаблона' }
}

async function setDefaultTemplate(projectId, templateCode) {
  await query(
    `UPDATE templates SET is_default = false WHERE project_id = $1 AND is_default AND code <> $2`,
    [projectId, templateCode],
  )
  const { rowCount } = await query(
    `UPDATE templates
     SET is_default = true, updated_at = now()
     WHERE project_id = $1 AND code = $2`,
    [projectId, templateCode],
  )
  return Number(rowCount) > 0
}

async function patchTemplate(project, row, body) {
  const nextName = typeof body?.name === 'string' ? body.name.trim() : undefined
  const nextCodeRaw = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : undefined
  const makeDefault = body?.isDefault === true
  if (nextName !== undefined && !nextName) return { status: 400, error: 'Укажите название' }
  if (nextName !== undefined && nextName.length > 80) return { status: 400, error: 'Название слишком длинное' }
  let nextCode
  if (nextCodeRaw !== undefined) {
    if (!TEMPLATE_CODE_RE.test(nextCodeRaw)) {
      return { status: 400, error: 'Код: латиница, цифры, дефис или подчёркивание' }
    }
    nextCode = nextCodeRaw
  }
  if (nextName !== undefined || nextCode !== undefined) {
    try {
      await query(
        `UPDATE templates
         SET name = COALESCE($3, name),
             code = COALESCE($4, code),
             updated_at = now()
         WHERE id = $1 AND project_id = $2`,
        [row.id, project.id, nextName ?? null, nextCode ?? null],
      )
    } catch (err) {
      if (err && err.code === '23505') return { status: 409, error: 'Такой код шаблона уже есть' }
      throw err
    }
  }
  if (makeDefault) {
    await setDefaultTemplate(project.id, nextCode || row.code)
  }
  const updated = await templateByCode(project.id, nextCode || row.code)
  if (!updated) return { status: 404, error: 'template not found' }
  return { status: 200, template: mapTemplate(updated) }
}

async function insertTrialTemplate(project, { name } = {}) {
  const label = String(name ?? '').trim() || 'Пример шаблона: Сосновый берег'
  await copyStarterLibrary(project.code)
  await copyStarterTts(project.code)
  const config = rewriteConfigMedia(
    trialPresentationConfig({ id: project.code, musicSrc: projectMusicSrc(project.code) }),
    project.code,
  )
  const existing = await listTemplates(project.id)
  const makeDefault = existing.length === 0
  const taken = new Set(existing.map((item) => item.code))
  const codes = [
    ...(makeDefault && !taken.has('default') ? ['default'] : []),
    ...autoTemplateCodes({ name: label, fromCode: makeDefault ? 'default' : '', taken }),
  ]
  for (const code of codes) {
    if (taken.has(code) || !TEMPLATE_CODE_RE.test(code)) continue
    try {
      const { rows } = await query(
        `INSERT INTO templates (project_id, code, name, config, is_default, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'published')
         RETURNING id, code, name, is_default, status, created_at, updated_at`,
        [project.id, code, label.slice(0, 80), JSON.stringify(config), makeDefault],
      )
      return mapTemplate(rows[0])
    } catch (err) {
      if (err && err.code === '23505') {
        taken.add(code)
        continue
      }
      throw err
    }
  }
  throw new Error('Не удалось создать пробный шаблон')
}

/** Неиспользуемые медиа проекта после удаления этого шаблона (с учётом остальных). */
async function orphanMediaForTemplate(project, row) {
  const code = project.code
  const { rows: others } = await query(
    `SELECT config, draft_config FROM templates WHERE project_id = $1 AND id <> $2`,
    [project.id, row.id],
  )
  const keep = mediaSrcsFromConfigs(
    others.flatMap((item) => [item.config, item.draft_config]),
    code,
  )
  return listUnusedProjectMedia(code, keep)
}

async function deleteTemplate(project, row, { purgeUnused = false } = {}) {
  const existing = await listTemplates(project.id)
  const { rows: counts } = await query(
    `SELECT count(*)::int AS n FROM links WHERE template_id = $1`,
    [row.id],
  )
  const n = Number(counts[0]?.n ?? 0)
  if (n > 0) {
    return {
      status: 409,
      error: `На шаблон ссылаются ${n} выдач. Сначала удалите их или оставьте шаблон.`,
    }
  }
  if (row.is_default) {
    const next = existing.find((item) => item.code !== row.code)
    if (next) await setDefaultTemplate(project.id, next.code)
  }
  await query(`DELETE FROM templates WHERE id = $1 AND project_id = $2`, [row.id, project.id])

  let purged = { deleted: 0, srcs: [] }
  if (purgeUnused) {
    const { rows: remaining } = await query(
      `SELECT config, draft_config FROM templates WHERE project_id = $1`,
      [project.id],
    )
    const keep = mediaSrcsFromConfigs(
      remaining.flatMap((item) => [item.config, item.draft_config]),
      project.code,
    )
    const orphans = listUnusedProjectMedia(project.code, keep)
    if (orphans.length) purged = purgeProjectMediaSrcs(project.code, orphans)
  }

  return {
    status: 200,
    purgedMedia: purged.deleted,
  }
}

export async function templateRowForUser(userId, projectCode, templateCode) {
  if (!TEMPLATE_CODE_RE.test(templateCode)) return null
  const project = await projectForUser(userId, projectCode)
  if (!project) return null
  const row = await templateByCode(project.id, templateCode)
  if (!row) return null
  return { project, row }
}

async function templateByCode(projectId, templateCode) {
  if (!TEMPLATE_CODE_RE.test(templateCode)) return null
  const { rows } = await query(
    `SELECT id, code, name, is_default, status, config, draft_config, created_at, updated_at
     FROM templates
     WHERE project_id = $1 AND code = $2`,
    [projectId, templateCode],
  )
  return rows[0] ?? null
}

export async function issueGuestLink(project, body, options = {}) {
  const parsed = parseGuestLinkBody(body)
  const skipTts = Boolean(options.skipTts)
  let existing = null
  if (parsed.externalId) {
    existing = await getLinkByExternalId(project.id, parsed.externalId)
  }
  // Повторный webhook (смена статуса) часто без имени — берём с уже выданной ссылки.
  const name = parsed.name || existing?.guestName || ''

  const statusMap = await listAmoStatusMaps(project.id)
  const mappedCode = resolveTemplateCode({
    category: parsed.category,
    statusId: parsed.statusId,
    statusMap,
  })

  let row = null
  if (mappedCode) {
    row = await templateByCode(project.id, mappedCode)
  } else if (!existing) {
    const templates = await listTemplates(project.id)
    const fallback = templates.find((item) => item.isDefault) ?? templates[0]
    if (fallback) row = await templateByCode(project.id, fallback.code)
  } else if (existing?.templateCode) {
    row = await templateByCode(project.id, existing.templateCode)
  }

  const decided = decideGuestLink({
    name,
    externalId: parsed.externalId,
    existing,
    template: row
      ? {
          status: row.status,
          hasPublishedConfig: Boolean(asConfig(row.config)),
        }
      : null,
  })
  if (!decided.ok) return { status: decided.status, error: decided.error }

  if (decided.reused) {
    const host = await ensureGuestHost(project.code)
    if (!host.ok) console.error('guest host', host.host, host.error)

    const templateRow =
      row && (row.status === 'published' && asConfig(row.config))
        ? row
        : existing?.templateCode
          ? await templateByCode(project.id, existing.templateCode)
          : null
    if (!templateRow || templateRow.status !== 'published' || !asConfig(templateRow.config)) {
      // Без опубликованного шаблона — только вернуть существующую ссылку (legacy reuse).
      if (parsed.rawSources.length) {
        await insertLinkRawSources(existing.id, parsed.rawSources)
      }
      return { status: 200, reused: true, link: decided.link }
    }

    const published = asConfig(templateRow.config)
    const assembly = computeLinkAssembly(published, name, parsed.summary)
    const prepared = await prepareTemplateForGuest(project, templateRow, name, assembly, { skipTts })
    if (prepared.error) return prepared
    const switched = Boolean(row && row.code !== existing.templateCode)
    const amoSnapshot =
      parsed.amoSnapshot ??
      (parsed.statusId
        ? { statusId: parsed.statusId, externalId: parsed.externalId || null, name }
        : null)
    const updated = await updateLinkTemplate(existing.id, prepared.row.id, {
      guestSummary: assembly.guestSummary,
      derivedFlow: assembly.derivedFlow,
      assemblyTrace: assembly.assemblyTrace,
      amoSnapshot,
      summaryMeta: parsed.summaryMeta,
      guestName: name,
    })
    if (!updated) return { status: 500, error: 'Не удалось обновить ссылку' }
    if (parsed.rawSources.length) {
      await insertLinkRawSources(updated.id, parsed.rawSources)
    }
    return {
      status: 200,
      reused: true,
      switched,
      link: {
        id: updated.id,
        url: updated.url,
        publicId: updated.publicId,
        guestName: updated.guestName,
        externalId: updated.externalId ?? null,
        templateCode: updated.templateCode || prepared.row.code,
        templateName: updated.templateName || prepared.row.name,
      },
    }
  }

  if (!row) return { status: 400, error: 'Неизвестный шаблон (category)' }

  const published = asConfig(row.config)
  const assembly = computeLinkAssembly(published, name, parsed.summary)
  const prepared = await prepareTemplateForGuest(project, row, name, assembly, { skipTts })
  if (prepared.error) return prepared
  row = prepared.row

  const amoSnapshot =
    parsed.amoSnapshot ??
    (parsed.statusId
      ? { statusId: parsed.statusId, externalId: parsed.externalId || null, name }
      : null)

  const link = await insertLink({
    projectId: project.id,
    templateId: row.id,
    guestName: name,
    externalId: parsed.externalId || null,
    guestSummary: assembly.guestSummary,
    derivedFlow: assembly.derivedFlow,
    assemblyTrace: assembly.assemblyTrace,
    amoSnapshot,
    summaryMeta: parsed.summaryMeta,
  })
  if (parsed.rawSources.length) {
    await insertLinkRawSources(link.id, parsed.rawSources)
  }
  const host = await ensureGuestHost(project.code)
  if (!host.ok) console.error('guest host', host.host, host.error)
  return {
    status: 200,
    reused: false,
    link: {
      id: link.id,
      url: link.url,
      publicId: link.publicId,
      guestName: link.guestName,
      externalId: link.externalId ?? null,
      templateCode: link.templateCode || row.code,
      templateName: link.templateName || row.name,
    },
  }
}

async function prepareTemplateForGuest(project, templateRow, guestName, assembly = null, options = {}) {
  let row = templateRow
  // В эфир только templates.config. Черновик сам по себе не публикуем при выдаче ссылки —
  // иначе гонка с автосохранением затирает только что опубликованный конфиг.
  let published = asConfig(row.config)
  if (!published) {
    return { status: 400, error: 'Шаблон ещё не опубликован' }
  }
  const skipTts = Boolean(options.skipTts) || (await projectSkipsTtsOnLinkIssue(project))
  const fillMissing = await projectFillsMissingTts(project)
  const refreshStaleTts = Boolean(options.refreshStaleTts)

  // Статика независима от «не генерировать TTS при выдаче» (там про {name}).
  if (fillMissing) {
    const baked = await ensureMissingStaticTts(project, published, { required: true })
    if (!baked.ok) {
      return {
        status: baked.status || 502,
        error: baked.error || 'Не удалось сгенерировать озвучку шаблона',
      }
    }
    if (baked.changed) {
      const templateId = row.template_id || row.id
      console.info(
        'tts.fill_missing',
        JSON.stringify({
          project: project.code,
          templateId,
          generated: baked.staticGenerated ?? 0,
          cached: baked.staticCached ?? 0,
        }),
      )
      await query(
        `UPDATE templates SET config = $2::jsonb, updated_at = now() WHERE id = $1 AND project_id = $3`,
        [templateId, JSON.stringify(baked.config), project.id],
      )
      published = baked.config
      row = { ...row, config: baked.config }
    }
  }

  // Явная пересборка ссылки: текст в блоке поменяли, а старый ttsSrc оставили.
  if (refreshStaleTts) {
    const synced = await resyncStaleStaticTts(project, published, { required: true })
    if (!synced.ok) {
      return {
        status: synced.status || 502,
        error: synced.error || 'Не удалось обновить озвучку шаблона',
      }
    }
    if (synced.changed) {
      const templateId = row.template_id || row.id
      console.info(
        'tts.resync_stale',
        JSON.stringify({
          project: project.code,
          templateId,
          generated: synced.staticGenerated ?? 0,
          cached: synced.staticCached ?? 0,
        }),
      )
      await query(
        `UPDATE templates SET config = $2::jsonb, updated_at = now() WHERE id = $1 AND project_id = $3`,
        [templateId, JSON.stringify(synced.config), project.id],
      )
      published = synced.config
      row = { ...row, config: synced.config }
    }
  }

  if (!skipTts) {
    const configForGuest = applyDerivedFlowToConfig(published, assembly?.derivedFlow)
    const prep = await personalizeConfigTts(project, configForGuest, guestName, {
      required: true,
      fillMissingStatic: false,
      hello: assembly?.guestSummary?.hello ?? '',
    })
    if (!prep.ok) {
      return {
        status: prep.status || 502,
        error: prep.error || 'Не удалось сгенерировать персональную озвучку',
      }
    }
  }
  return { row }
}

export async function extractProjectLinkSummary(project, publicId) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }
  if (!(await assemblyTextConfigured())) {
    return {
      status: 503,
      error: (await assemblyTextConfigError()) || 'Извлечение не настроено',
    }
  }

  const detail = await getProjectLinkDetail(project.id, publicId)
  if (!detail) return { status: 404, error: 'link not found' }

  const packed = buildRawTextFromSources(detail.rawSources)
  if (!packed.ok) return { status: 400, error: packed.error }

  const extracted = await extractGuestSummaryFromRawText(packed.rawText)
  if (!extracted.ok) {
    return {
      status: extracted.status ?? 502,
      error: extracted.error ?? 'Не удалось извлечь сводку',
      ...(extracted.detail ? { detail: extracted.detail } : {}),
    }
  }

  const brandName = String(linkRow.config?.brand?.name ?? linkRow.config?.brand?.fullName ?? '').trim()
  const helloAttached = await attachHelloToSummary(
    project,
    { ...extracted.summary, guestName: String(linkRow.guest_name ?? '').trim() || extracted.summary.guestName },
    { rawText: packed.rawText, brandName },
  )
  const summary = helloAttached.summary

  return {
    status: 200,
    summary,
    summaryJson: {
      ...extracted.summaryJson,
      guestName: summary.guestName,
      hello: summary.hello,
    },
    explanation: extracted.explanation,
    model: extracted.model,
    helloMode: helloAttached.helloMode,
    sourceCount: packed.items.length,
  }
}

export async function reassembleProjectLink(project, publicId, body = {}) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }

  // Свежий шаблон (не только join с момента открытия диалога): черновик → в эфир,
  // затем пересборка блоков и озвучки на той же publicId.
  let templateRow = linkRow.template_code
    ? await templateByCode(project.id, linkRow.template_code)
    : null
  if (!templateRow) {
    return { status: 404, error: 'Шаблон ссылки не найден' }
  }

  let publishedDraft = false
  if (Boolean(body?.applyDraft) && asConfig(templateRow.draft_config)) {
    const published = await publishStoredTemplate(templateRow)
    if (published.error) return published
    publishedDraft = true
    templateRow = await templateByCode(project.id, templateRow.code)
    if (!templateRow) return { status: 404, error: 'Шаблон ссылки не найден' }
  }

  const published = asConfig(templateRow.config)
  if (!published || templateRow.status !== 'published') {
    return { status: 400, error: 'Шаблон ещё не опубликован' }
  }

  const summaryInput =
    body?.summary && typeof body.summary === 'object'
      ? body.summary
      : linkRow.guest_summary && typeof linkRow.guest_summary === 'object'
        ? linkRow.guest_summary
        : {}
  const guestName =
    String(body?.name ?? body?.guestName ?? linkRow.guest_name ?? '').trim() || linkRow.guest_name
  const rawSources = await listLinkRawSources(linkRow.id)
  const packed = buildRawTextFromSources(rawSources)
  const brandName = String(published.brand?.name ?? published.brand?.fullName ?? '').trim()
  const helloAttached = await attachHelloToSummary(
    project,
    normalizeGuestSummary({ guestName, ...summaryInput }),
    {
      rawText: packed.ok ? packed.rawText : '',
      brandName,
      reuseExisting: Boolean(String(summaryInput.hello ?? '').trim()),
    },
  )
  const assembly = computeLinkAssembly(published, guestName, helloAttached.summary)
  const prepared = await prepareTemplateForGuest(project, templateRow, guestName, assembly, {
    refreshStaleTts: true,
  })
  if (prepared.error) return prepared

  const summaryMeta =
    body?.summaryMeta && typeof body.summaryMeta === 'object'
      ? body.summaryMeta
      : {
          source: body?.summary ? 'manual' : 'reassemble',
          extractedAt: new Date().toISOString(),
        }

  const updated = await updateLinkTemplate(linkRow.id, prepared.row.id, {
    guestSummary: assembly.guestSummary,
    derivedFlow: assembly.derivedFlow,
    assemblyTrace: assembly.assemblyTrace,
    summaryMeta: {
      ...summaryMeta,
      reassembledAt: new Date().toISOString(),
      helloMode: helloAttached.helloMode,
      ...(publishedDraft ? { publishedDraft: true } : {}),
    },
    guestName,
  })
  if (!updated) return { status: 500, error: 'Не удалось пересобрать' }
  const detail = await getProjectLinkDetail(project.id, updated.publicId)
  return { status: 200, link: detail, publishedDraft }
}

function geminiUserMessage(error, detail) {
  const base = String(error ?? '').trim()
  const extra = String(detail ?? '').trim()
  if (!extra) return base
  if (!base) return extra
  if (extra.includes(base)) return extra
  return `${base}: ${extra}`
}

export async function syncProjectLinkAmoCalls(project, publicId) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }
  const leadId = String(linkRow.external_id ?? '').trim()
  if (!leadId) return { status: 400, error: 'У ссылки нет externalId (id сделки amo)' }

  const connection = await getAmoConnection(project.id)
  if (!connection) return { status: 400, error: 'AmoCRM не подключена' }

  const result = await syncAmoCallsToLink({
    connection: { ...connection, projectId: project.id, amoTimings: [] },
    redirectUri: amoRedirectUri(),
    linkId: linkRow.id,
    leadId,
    prune: false,
  })
  if (result.error) return { status: 502, error: result.error, timings: result.timings }

  const detail = await getProjectLinkDetail(project.id, publicId)
  return {
    status: 200,
    inserted: result.inserted.length,
    skipped: result.skipped,
    found: result.found ?? 0,
    withRecording: result.withRecording ?? 0,
    matched: result.matched ?? 0,
    pruned: result.pruned ?? 0,
    recordingUnavailable: result.recordingUnavailable ?? 0,
    timings: result.timings ?? null,
    link: detail,
  }
}

export async function probeProjectLinkCallRecordings(project, publicId, body = {}) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }

  const items = Array.isArray(body?.items)
    ? body.items
        .map((item) => ({
          sourceId: String(item?.sourceId ?? item?.source_id ?? '').trim(),
          url: String(item?.url ?? '').trim(),
        }))
        .filter((item) => item.url)
        .slice(0, 32)
    : []

  const urls = items.length
    ? items.map((item) => item.url)
    : Array.isArray(body?.urls)
      ? body.urls.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 32)
      : []

  if (!urls.length) return { status: 400, error: 'Укажите urls или items для проверки' }

  const results = await probeRecordingUrlsDetailed(urls)
  const byUrl = new Map(results.map((item) => [item.url, item]))
  const probedAt = new Date().toISOString()

  for (const item of items) {
    if (!item.sourceId) continue
    const probe = byUrl.get(item.url)
    if (!probe) continue
    const existing = await getLinkRawSource(linkRow.id, item.sourceId)
    const prev = existing?.meta && typeof existing.meta === 'object' && !Array.isArray(existing.meta)
      ? { ...existing.meta }
      : {}
    const next = {
      ...prev,
      recordingProbedAt: probedAt,
      ...(probe.reason ? { recordingProbeReason: probe.reason } : {}),
    }
    if (probe.ok) {
      next.recordingAvailable = true
    } else {
      const availability = recordingProbeAvailability(probe)
      next.recordingAvailable = availability === 'unavailable' ? false : null
    }
    await mergeLinkRawSourceMeta(linkRow.id, item.sourceId, next)
  }

  return { status: 200, results }
}

function buildTranscribeMeta(existingMeta, { audioUrl, model }) {
  const prev = existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
    ? { ...existingMeta }
    : {}
  const recordingUrl = String(audioUrl ?? prev.recordingUrl ?? '').trim()
  if (recordingUrl) prev.recordingUrl = recordingUrl
  if (model) prev.transcribeModel = model
  prev.transcribedAt = new Date().toISOString()
  return prev
}

export async function addLinkRawSource(project, publicId, body = {}) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }

  const audioUrl = String(body?.audioUrl ?? body?.url ?? '').trim()
  let text = String(body?.body ?? body?.text ?? '').trim()
  let externalRef = String(body?.externalRef ?? body?.external_ref ?? '').trim()
  const kind = normalizeRawKind(body?.kind ?? (audioUrl ? 'call_transcript' : undefined))
  let meta = null

  if (audioUrl && !text) {
    if (kind === 'call_transcript') {
      text = audioUrl
    } else if (!(await geminiTranscribeConfigured())) {
      return { status: 503, error: 'Транскрибация не настроена (GEMINI_TRANSCRIBE_URL или GEMINI_API_KEY)' }
    } else {
      const transcribed = await transcribeAudioFromUrl(audioUrl)
      if (!transcribed.ok) {
        return {
          status: transcribed.status,
          error: geminiUserMessage(transcribed.error, transcribed.detail),
        }
      }
      text = transcribed.text
      meta = buildTranscribeMeta(null, { audioUrl, model: transcribed.model })
    }
  }

  if (!text) return { status: 400, error: 'Укажите текст сырья или URL записи звонка' }
  if (audioUrl && !externalRef) externalRef = audioUrl

  const inserted = await insertLinkRawSources(linkRow.id, [
    {
      kind,
      title: body?.title,
      body: text,
      externalRef: externalRef || null,
      capturedAt: body?.capturedAt ?? body?.captured_at,
      meta,
    },
  ])
  if (!inserted.length) return { status: 400, error: 'Не удалось сохранить сырьё' }
  return { status: 200, source: inserted[0] }
}

export async function updateLinkRawSourceEntry(project, publicId, sourceId, body = {}) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }

  const hasNonTarget = Object.prototype.hasOwnProperty.call(body ?? {}, 'nonTarget')
  const text = String(body?.body ?? body?.text ?? '').trim()

  if (hasNonTarget && !text && body?.kind == null && body?.title == null) {
    const updated = await mergeLinkRawSourceMeta(linkRow.id, sourceId, {
      nonTarget: body.nonTarget ? true : null,
    })
    if (!updated) return { status: 404, error: 'Сырьё не найдено' }
    return { status: 200, source: updated }
  }

  if (!text) return { status: 400, error: 'Укажите текст сырья' }
  const kind = body?.kind
  const title = body?.title ?? ''
  const existing = await getLinkRawSource(linkRow.id, sourceId)
  const nextMeta =
    hasNonTarget || existing?.meta
      ? {
          ...(existing?.meta && typeof existing.meta === 'object' ? existing.meta : {}),
          ...(hasNonTarget ? { nonTarget: body.nonTarget ? true : undefined } : {}),
        }
      : undefined
  if (hasNonTarget && !body.nonTarget && nextMeta && 'nonTarget' in nextMeta) {
    delete nextMeta.nonTarget
  }
  const updated = await updateLinkRawSource(linkRow.id, sourceId, {
    kind,
    title,
    body: text,
    ...(nextMeta ? { meta: nextMeta } : {}),
  })
  if (!updated) return { status: 404, error: 'Сырьё не найдено' }
  return { status: 200, source: updated }
}

export async function transcribeLinkRawSourceEntry(project, publicId, sourceId, body = {}) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }

  const existing = await getLinkRawSource(linkRow.id, sourceId)
  if (!existing) return { status: 404, error: 'Сырьё не найдено' }
  if (existing.meta?.nonTarget === true) {
    return { status: 400, error: 'Нецелевой диалог — транскрибация отключена' }
  }

  const audioUrl = String(body?.audioUrl ?? body?.url ?? '').trim()
  if (!audioUrl) return { status: 400, error: 'Укажите URL записи звонка' }
  if (!(await geminiTranscribeConfigured())) {
    return { status: 503, error: 'Транскрибация не настроена (GEMINI_TRANSCRIBE_URL или GEMINI_API_KEY)' }
  }

  const started = Date.now()
  const transcribed = await transcribeAudioFromUrl(audioUrl)
  const geminiMs = Date.now() - started
  if (!transcribed.ok) {
    console.info('transcribe failed', JSON.stringify({ geminiMs, error: transcribed.error }))
    return {
      status: transcribed.status,
      error: geminiUserMessage(transcribed.error, transcribed.detail),
    }
  }

  const saveStarted = Date.now()
  const updated = await updateLinkRawSource(linkRow.id, sourceId, {
    kind: 'call_transcript',
    title: body?.title ?? 'Звонок',
    body: transcribed.text,
    meta: buildTranscribeMeta(existing.meta, { audioUrl, model: transcribed.model }),
  })
  console.info(
    'transcribe timings',
    JSON.stringify({
      geminiMs,
      saveMs: Date.now() - saveStarted,
      model: transcribed.model,
      bytes: transcribed.bytes ?? null,
      textLen: transcribed.text.length,
    }),
  )
  if (!updated) return { status: 404, error: 'Сырьё не найдено' }
  return { status: 200, source: updated }
}

export async function deleteLinkRawSourceEntry(project, publicId, sourceId) {
  const linkRow = await getProjectLinkRow(project.id, publicId)
  if (!linkRow) return { status: 404, error: 'link not found' }
  const ok = await deleteLinkRawSource(linkRow.id, sourceId)
  if (!ok) return { status: 404, error: 'Сырьё не найдено' }
  return { status: 200 }
}

async function publishStoredTemplate(row) {
  const draft = asConfig(row.draft_config)
  const published = asConfig(row.config)
  const next = draft || published
  if (!next) return { status: 400, error: 'Нечего публиковать' }
  await savePublishedConfig(row.id, next)
  return { status: 200 }
}

async function savePublishedConfig(templateId, config) {
  await query(
    `UPDATE templates
     SET config = $2::jsonb,
         draft_config = NULL,
         status = 'published',
         updated_at = now()
     WHERE id = $1`,
    [templateId, JSON.stringify(config)],
  )
}

async function saveDraftConfig(templateId, config) {
  await query(
    `UPDATE templates
     SET draft_config = $2::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [templateId, JSON.stringify(config)],
  )
}

async function clearDraftConfig(templateId) {
  await query(
    `UPDATE templates
     SET draft_config = NULL,
         updated_at = now()
     WHERE id = $1`,
    [templateId],
  )
}

export async function handleCabinetApi(req, res, url, userId, json, extras = {}) {
  const method = req.method ?? 'GET'
  const body = extras.body

  if (url === '/api/project-code/check' && (method === 'GET' || method === 'HEAD')) {
    let wanted = ''
    try {
      wanted = new URL(req.url || '/', 'http://local').searchParams.get('code') || ''
    } catch {
      wanted = ''
    }
    const checked = await checkProjectCode(userId, wanted)
    json(res, 200, { ok: true, ...checked })
    return true
  }

  const teamLeaveMatch = url.match(/^\/api\/projects\/([^/]+)\/team\/leave\/?$/)
  if (teamLeaveMatch) {
    const project = await projectForUser(userId, decodeURIComponent(teamLeaveMatch[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const left = await leaveProject({
      projectId: project.id,
      ownerId: project.user_id,
      userId,
    })
    if (!left.ok) {
      json(res, left.status, { error: left.error })
      return true
    }
    json(res, 200, { ok: true })
    return true
  }

  const teamInviteMatch = url.match(/^\/api\/projects\/([^/]+)\/team\/invites\/([^/]+)\/?$/)
  if (teamInviteMatch) {
    const project = await projectForUser(userId, decodeURIComponent(teamInviteMatch[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (!canManageProject(project)) {
      json(res, 403, { error: 'Командой управляет владелец объекта' })
      return true
    }
    if (method !== 'DELETE') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const revoked = await revokeProjectInvite({
      projectId: project.id,
      inviteId: decodeURIComponent(teamInviteMatch[2]),
    })
    if (!revoked.ok) {
      json(res, revoked.status, { error: revoked.error })
      return true
    }
    json(res, 200, { ok: true })
    return true
  }

  const teamOneMatch = url.match(/^\/api\/projects\/([^/]+)\/team\/([^/]+)\/?$/)
  if (teamOneMatch) {
    const project = await projectForUser(userId, decodeURIComponent(teamOneMatch[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (!canManageProject(project)) {
      json(res, 403, { error: 'Командой управляет владелец объекта' })
      return true
    }
    if (method !== 'DELETE') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const removed = await removeProjectMember({
      projectId: project.id,
      ownerId: project.user_id,
      userId: decodeURIComponent(teamOneMatch[2]),
    })
    if (!removed.ok) {
      json(res, removed.status, { error: removed.error })
      return true
    }
    json(res, 200, { ok: true })
    return true
  }

  const teamMatch = url.match(/^\/api\/projects\/([^/]+)\/team\/?$/)
  if (teamMatch) {
    const project = await projectForUser(userId, decodeURIComponent(teamMatch[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, ...(await listProjectTeam(project.id)) })
      return true
    }
    if (method === 'POST') {
      if (!canManageProject(project)) {
        json(res, 403, { error: 'Приглашать в объект может только владелец' })
        return true
      }
      const invited = await inviteOrAddMember({
        project,
        actorId: userId,
        email: body?.email,
      })
      if (!invited.ok) {
        json(res, invited.status, { error: invited.error })
        return true
      }
      if (invited.added) {
        json(res, 200, { ok: true, added: true, member: invited.member })
        return true
      }
      const joinUrl = projectJoinUrl(req, invited.invite.token)
      const mailed = await sendTeamInviteMail(invited.invite.email, {
        projectName: project.name,
        link: joinUrl,
      })
      json(res, 200, {
        ok: true,
        added: false,
        invite: { ...invited.invite, url: joinUrl },
        mailed: Boolean(mailed?.ok),
      })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  if (url.includes('/amocrm')) {
    const { handleAmoCabinet } = await import('./amoCabinet.mjs')
    if (await handleAmoCabinet(req, res, url, method, json, userId, extras)) return true
  }

  const publishMatch = url.match(/^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/publish\/?$/)
  if (publishMatch) {
    const projectCode = decodeURIComponent(publishMatch[1])
    const templateCode = decodeURIComponent(publishMatch[2])
    const found = await templateRowForUser(userId, projectCode, templateCode)
    if (!found) {
      json(res, 404, { error: 'template not found' })
      return true
    }
    if (method === 'POST') {
      const published = await publishStoredTemplate(found.row)
      if (published.error) {
        json(res, published.status, { error: published.error })
        return true
      }
      const updated = await templateByCode(found.project.id, templateCode)
      json(res, 200, { ok: true, hasDraft: false, template: updated ? mapTemplate(updated) : mapTemplate(found.row) })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const orphanMediaMatch = url.match(
    /^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/orphan-media\/?$/,
  )
  if (orphanMediaMatch) {
    const projectCode = decodeURIComponent(orphanMediaMatch[1])
    const templateCode = decodeURIComponent(orphanMediaMatch[2])
    const found = await templateRowForUser(userId, projectCode, templateCode)
    if (!found) {
      json(res, 404, { error: 'template not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      const orphans = await orphanMediaForTemplate(found.project, found.row)
      json(res, 200, { ok: true, count: orphans.length, orphans })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const draftMatch = url.match(/^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/draft\/?$/)
  if (draftMatch) {
    const projectCode = decodeURIComponent(draftMatch[1])
    const templateCode = decodeURIComponent(draftMatch[2])
    const found = await templateRowForUser(userId, projectCode, templateCode)
    if (!found) {
      json(res, 404, { error: 'template not found' })
      return true
    }
    if (method === 'PUT' || method === 'POST') {
      if (!isPropertyConfig(body)) {
        json(res, 400, { error: 'incomplete property' })
        return true
      }
      await saveDraftConfig(found.row.id, rewriteConfigMedia(body, found.project.code))
      json(res, 200, { ok: true, hasDraft: true })
      return true
    }
    if (method === 'DELETE') {
      await clearDraftConfig(found.row.id)
      json(res, 200, { ok: true, hasDraft: false })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const tplMatch = url.match(/^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/?$/)
  if (tplMatch) {
    const projectCode = decodeURIComponent(tplMatch[1])
    const templateCode = decodeURIComponent(tplMatch[2])
    const found = await templateRowForUser(userId, projectCode, templateCode)
    if (!found) {
      json(res, 404, { error: 'template not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      const published = asConfig(found.row.config)
      const draft = asConfig(found.row.draft_config)
      json(res, 200, {
        ok: true,
        template: mapTemplate(found.row),
        project: { code: found.project.code, name: found.project.name },
        config: published ? rewriteConfigMedia(published, found.project.code) : published,
        draft: draft ? rewriteConfigMedia(draft, found.project.code) : draft,
        hasDraft: Boolean(draft),
      })
      return true
    }
    if (method === 'PUT' || method === 'POST') {
      if (!isPropertyConfig(body)) {
        json(res, 400, { error: 'incomplete property' })
        return true
      }
      await savePublishedConfig(found.row.id, rewriteConfigMedia(body, found.project.code))
      json(res, 200, { ok: true, hasDraft: false })
      return true
    }
    if (method === 'PATCH') {
      const patched = await patchTemplate(found.project, found.row, body)
      if (patched.error) {
        json(res, patched.status, { error: patched.error })
        return true
      }
      json(res, 200, { ok: true, template: patched.template })
      return true
    }
    if (method === 'DELETE') {
      let purgeUnused = false
      try {
        purgeUnused = new URL(req.url || '/', 'http://local').searchParams.get('purgeUnused') === '1'
      } catch {
        purgeUnused = false
      }
      const removed = await deleteTemplate(found.project, found.row, { purgeUnused })
      if (removed.error) {
        json(res, removed.status, { error: removed.error })
        return true
      }
      json(res, 200, {
        ok: true,
        purgedMedia: removed.purgedMedia ?? 0,
      })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkRawTranscribeMatch = url.match(
    /^\/api\/projects\/([^/]+)\/links\/([^/]+)\/raw-sources\/([^/]+)\/transcribe\/?$/,
  )
  if (linkRawTranscribeMatch) {
    const projectCode = decodeURIComponent(linkRawTranscribeMatch[1])
    const publicId = decodeURIComponent(linkRawTranscribeMatch[2])
    const sourceId = decodeURIComponent(linkRawTranscribeMatch[3])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await transcribeLinkRawSourceEntry(project, publicId, sourceId, body)
      if (result.error) {
        json(res, result.status, {
          error: result.error,
          ...(result.detail ? { detail: result.detail } : {}),
        })
        return true
      }
      json(res, 200, { ok: true, source: result.source })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkRawOneMatch = url.match(
    /^\/api\/projects\/([^/]+)\/links\/([^/]+)\/raw-sources\/([^/]+)\/?$/,
  )
  if (linkRawOneMatch) {
    const projectCode = decodeURIComponent(linkRawOneMatch[1])
    const publicId = decodeURIComponent(linkRawOneMatch[2])
    const sourceId = decodeURIComponent(linkRawOneMatch[3])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'PATCH') {
      const result = await updateLinkRawSourceEntry(project, publicId, sourceId, body)
      if (result.error) {
        json(res, result.status, { error: result.error })
        return true
      }
      json(res, 200, { ok: true, source: result.source })
      return true
    }
    if (method === 'DELETE') {
      const result = await deleteLinkRawSourceEntry(project, publicId, sourceId)
      if (result.error) {
        json(res, result.status, { error: result.error })
        return true
      }
      json(res, 200, { ok: true })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkRawMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/([^/]+)\/raw-sources\/?$/)
  if (linkRawMatch) {
    const projectCode = decodeURIComponent(linkRawMatch[1])
    const publicId = decodeURIComponent(linkRawMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await addLinkRawSource(project, publicId, body)
      if (result.error) {
        json(res, result.status, {
          error: result.error,
          ...(result.detail ? { detail: result.detail } : {}),
        })
        return true
      }
      json(res, 200, { ok: true, source: result.source })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkProbeCallRecordingsMatch = url.match(
    /^\/api\/projects\/([^/]+)\/links\/([^/]+)\/probe-call-recordings\/?$/,
  )
  if (linkProbeCallRecordingsMatch) {
    const projectCode = decodeURIComponent(linkProbeCallRecordingsMatch[1])
    const publicId = decodeURIComponent(linkProbeCallRecordingsMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await probeProjectLinkCallRecordings(project, publicId, body)
      if (result.error) {
        json(res, result.status, { error: result.error })
        return true
      }
      json(res, 200, { ok: true, results: result.results })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkSyncAmoCallsMatch = url.match(
    /^\/api\/projects\/([^/]+)\/links\/([^/]+)\/sync-amo-calls\/?$/,
  )
  if (linkSyncAmoCallsMatch) {
    const projectCode = decodeURIComponent(linkSyncAmoCallsMatch[1])
    const publicId = decodeURIComponent(linkSyncAmoCallsMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await syncProjectLinkAmoCalls(project, publicId)
      if (result.error) {
        json(res, result.status, { error: result.error })
        return true
      }
      json(res, 200, {
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        found: result.found ?? 0,
        withRecording: result.withRecording ?? 0,
        matched: result.matched ?? 0,
        pruned: result.pruned ?? 0,
        recordingUnavailable: result.recordingUnavailable ?? 0,
        timings: result.timings ?? null,
        link: result.link,
      })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkStatsMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/([^/]+)\/stats\/?$/)
  if (linkStatsMatch) {
    const projectCode = decodeURIComponent(linkStatsMatch[1])
    const publicId = decodeURIComponent(linkStatsMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      const linkRow = await getProjectLinkRow(project.id, publicId)
      if (!linkRow) {
        json(res, 404, { error: 'link not found' })
        return true
      }
      const stats = await linkEventStats(
        linkRow.id,
        project.id,
        statsRangeFromReq(req),
        linkRow.created_at,
        linkRow.config,
      )
      json(res, 200, { ok: true, stats })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkReassembleMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/([^/]+)\/reassemble\/?$/)
  if (linkReassembleMatch) {
    const projectCode = decodeURIComponent(linkReassembleMatch[1])
    const publicId = decodeURIComponent(linkReassembleMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await reassembleProjectLink(project, publicId, body)
      if (result.error) {
        json(res, result.status, { error: result.error })
        return true
      }
      json(res, 200, {
        ok: true,
        link: result.link,
        publishedDraft: Boolean(result.publishedDraft),
      })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linkExtractMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/([^/]+)\/extract-summary\/?$/)
  if (linkExtractMatch) {
    const projectCode = decodeURIComponent(linkExtractMatch[1])
    const publicId = decodeURIComponent(linkExtractMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const result = await extractProjectLinkSummary(project, publicId)
      if (result.error) {
        json(res, result.status, {
          error: result.error,
          ...(result.detail ? { detail: result.detail } : {}),
        })
        return true
      }
      json(res, 200, {
        ok: true,
        summary: result.summary,
        summaryJson: result.summaryJson,
        explanation: result.explanation,
        model: result.model,
        sourceCount: result.sourceCount,
      })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const oneLinkMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/([^/]+)\/?$/)
  if (oneLinkMatch) {
    const projectCode = decodeURIComponent(oneLinkMatch[1])
    const publicId = decodeURIComponent(oneLinkMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      const detail = await getProjectLinkDetail(project.id, publicId)
      if (!detail) {
        json(res, 404, { error: 'link not found' })
        return true
      }
      json(res, 200, { ok: true, link: detail })
      return true
    }
    if (method === 'DELETE') {
      const removed = await deleteProjectLink(project.id, publicId)
      if (!removed.ok) {
        json(res, 404, { error: 'link not found' })
        return true
      }
      if (removed.externalId) {
        const connection = await getAmoConnection(project.id)
        if (connection) {
          try {
            await clearAmoLeadPresentationUrl(
              { ...connection, projectId: project.id },
              removed.externalId,
              amoRedirectUri(req),
            )
          } catch (err) {
            console.error('amo clear presentation url', project.code, removed.externalId, err)
          }
        }
      }
      json(res, 200, { ok: true })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const linksMatch = url.match(/^\/api\/projects\/([^/]+)\/links\/?$/)
  if (linksMatch) {
    const projectCode = decodeURIComponent(linksMatch[1])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      const issued = await issueGuestLink(project, body)
      if (issued.error) {
        json(res, issued.status, { error: issued.error })
        return true
      }
      json(res, 200, { ok: true, reused: Boolean(issued.reused), ...issued.link })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, links: await listLinks(project.id) })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const planMatch = url.match(/^\/api\/projects\/([^/]+)\/plan\/?$/)
  if (planMatch) {
    const projectCode = decodeURIComponent(planMatch[1])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      const plan = await loadProjectPlan(project.id)
      if (!plan) {
        json(res, 404, { error: 'project not found' })
        return true
      }
      json(res, 200, { ok: true, ...plan })
      return true
    }
    if (method === 'POST') {
      if (!canManageProject(project)) {
        json(res, 403, { error: 'Тариф меняет владелец объекта' })
        return true
      }
      const changed = await changeProjectPlan(project, userId, body?.plan)
      if (changed.error) {
        json(res, changed.status, { error: changed.error })
        return true
      }
      json(res, 200, { ok: true, ...changed.plan })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const oneKeyMatch = url.match(/^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/?$/)
  if (oneKeyMatch) {
    const projectCode = decodeURIComponent(oneKeyMatch[1])
    const keyId = decodeURIComponent(oneKeyMatch[2])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (!canManageProject(project)) {
      json(res, 403, { error: 'Ключи API выдаёт владелец объекта' })
      return true
    }
    if (method === 'POST') {
      const action = typeof body?.action === 'string' ? body.action.trim() : 'revoke'
      if (action !== 'revoke') {
        json(res, 400, { error: 'unknown action' })
        return true
      }
      const ok = await revokeApiKey(project.id, keyId)
      if (!ok) {
        json(res, 404, { error: 'key not found' })
        return true
      }
      json(res, 200, { ok: true })
      return true
    }
    if (method === 'DELETE') {
      const ok = await deleteApiKey(project.id, keyId)
      if (!ok) {
        json(res, 404, { error: 'key not found' })
        return true
      }
      json(res, 200, { ok: true })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const keysMatch = url.match(/^\/api\/projects\/([^/]+)\/keys\/?$/)
  if (keysMatch) {
    const projectCode = decodeURIComponent(keysMatch[1])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'POST') {
      if (!canManageProject(project)) {
        json(res, 403, { error: 'Ключи API выдаёт владелец объекта' })
        return true
      }
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const created = await createApiKey(project.id, name)
      json(res, 200, { ok: true, key: created })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, keys: await listApiKeys(project.id) })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const oneProject = url.match(/^\/api\/projects\/([^/]+)\/?$/)
  if (oneProject && method === 'PATCH') {
    const projectCode = decodeURIComponent(oneProject[1])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    const wantsIdentity =
      typeof body?.name === 'string' || typeof body?.code === 'string'
    if (wantsIdentity && !canManageProject(project)) {
      json(res, 403, { error: 'Менять название и адрес может только владелец объекта' })
      return true
    }
    const updated = await updateProjectForUser(project, body)
    if (updated.error) {
      json(res, updated.status, { error: updated.error })
      return true
    }
    json(res, 200, { ok: true, project: updated.project, guestHost: updated.guestHost ?? null })
    return true
  }

  if (url === '/api/projects' || url === '/api/projects/') {
    if (method === 'POST') {
      const created = await createProjectForUser(userId, body)
      if (created.error) {
        json(res, created.status, { error: created.error })
        return true
      }
      json(res, 200, { ok: true, project: created.project, templates: created.templates })
      return true
    }
  }

  const templatesCol = url.match(/^\/api\/projects\/([^/]+)\/templates\/?$/)
  if (templatesCol && method === 'POST') {
    const projectCode = decodeURIComponent(templatesCol[1])
    const project = await projectForUser(userId, projectCode)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    const created = await createTemplateForProject(project, body)
    if (created.error) {
      json(res, created.status, { error: created.error })
      return true
    }
    json(res, 200, { ok: true, template: created.template })
    return true
  }

  if (method !== 'GET' && method !== 'HEAD') return false

  if (url === '/api/projects' || url === '/api/projects/') {
    json(res, 200, { ok: true, projects: await listProjects(userId) })
    return true
  }

  const extra = url.match(/^\/api\/projects\/([^/]+)\/(stats|templates)\/?$/)
  if (extra) {
    const code = decodeURIComponent(extra[1])
    const kind = extra[2]
    const project = await projectForUser(userId, code)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (kind === 'stats') {
      const stats = await projectStats(project.id, statsRangeFromReq(req))
      json(res, 200, { ok: true, project: await projectPayload(project, stats), stats })
      return true
    }
    if (kind === 'templates') {
      json(res, 200, { ok: true, templates: await listTemplates(project.id) })
      return true
    }
    json(res, 404, { error: 'not found' })
    return true
  }

  const one = url.match(/^\/api\/projects\/([^/]+)\/?$/)
  if (one) {
    const code = decodeURIComponent(one[1])
    const project = await projectForUser(userId, code)
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    const stats = await projectStats(project.id)
    json(res, 200, {
      ok: true,
      project: await projectPayload(project, stats),
      templates: await listTemplates(project.id),
    })
    return true
  }

  return false
}
