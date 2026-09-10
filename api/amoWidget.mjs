/**
 * API для JS-виджета amo в карточке сделки:
 * GET  /api/v1/projects/:code/amo-widget/leads/:leadId
 * POST /api/v1/projects/:code/amo-widget/leads/:leadId/issue
 *
 * Без фильтра воронки — клик менеджера = явный intent.
 */

import { amoRedirectUri, fetchAmoLeadSnapshot } from './amoAuth.mjs'
import { getAmoConnection } from './amoConnections.mjs'
import { bearerToken } from './auth.js'
import { issueGuestLink } from './cabinet.mjs'
import { findApiKey, touchApiKeyUsed } from './keys.mjs'
import { getLinkWidgetStatusByExternalId } from './links.mjs'
import { amoLog } from './amoLog.mjs'
import {
  isLeadPipelineRunning,
  isPublicIdPipelineRunning,
  schedulePresentationPipeline,
} from './presentationPipeline.mjs'
import { guestLinkUrl } from './publicUrl.mjs'
import { clientIp, consumeRateLimit, rateLimited } from './rateLimit.mjs'

const WIDGET_PATH =
  /^\/api\/v1\/projects\/([^/]+)\/amo-widget\/leads\/([^/]+)(?:\/(issue))?\/?$/i

const AMO_ORIGIN_RE = /^https:\/\/([a-z0-9][a-z0-9.-]*\.)?(amocrm\.ru|amocrm\.com|kommo\.com)$/i

export function isAmoWidgetPath(url) {
  return WIDGET_PATH.test(url)
}

export function isAllowedAmoWidgetOrigin(origin) {
  const value = String(origin ?? '').trim()
  if (!value) return false
  if (AMO_ORIGIN_RE.test(value)) return true
  // Локальная отладка виджета / proxy
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) return true
  return false
}

/** CORS для запросов из UI amo (виджет в браузере менеджера). */
export function applyAmoWidgetCors(req, res) {
  const origin = String(req.headers.origin || '').trim()
  if (!isAllowedAmoWidgetOrigin(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, X-Requested-With, X-Api-Key',
  )
  res.setHeader('Access-Control-Max-Age', '86400')
  return true
}

export function mapWidgetPipelineStatus({ meta, publicId, leadId } = {}) {
  const running =
    isPublicIdPipelineRunning(publicId) || isLeadPipelineRunning(leadId)
  const pipelineRaw = meta?.pipeline != null ? String(meta.pipeline).trim() : ''
  const step = meta?.pipelineStep != null ? String(meta.pipelineStep).trim() : ''
  const error = meta?.pipelineError != null ? String(meta.pipelineError).trim() : ''
  const presentationUrl =
    meta?.presentationUrl != null ? String(meta.presentationUrl).trim() : ''

  if (running || pipelineRaw === 'pending' || pipelineRaw === 'running') {
    return {
      pipeline: running ? 'running' : pipelineRaw || 'pending',
      pipelineStep: step || null,
      pipelineError: error || null,
      ready: false,
      running: true,
      presentationUrl: presentationUrl || null,
    }
  }
  if (pipelineRaw === 'failed') {
    return {
      pipeline: 'failed',
      pipelineStep: step || null,
      pipelineError: error || null,
      ready: false,
      running: false,
      presentationUrl: presentationUrl || null,
    }
  }
  // ready_pending_amo / пустой meta у старых ссылок — персонализация уже была или не нужна.
  if (
    !pipelineRaw ||
    pipelineRaw === 'ready_pending_amo' ||
    pipelineRaw === 'ready' ||
    pipelineRaw === 'done'
  ) {
    return {
      pipeline: pipelineRaw || 'ready',
      pipelineStep: step || null,
      pipelineError: error || null,
      ready: true,
      running: false,
      presentationUrl: presentationUrl || null,
    }
  }
  return {
    pipeline: pipelineRaw,
    pipelineStep: step || null,
    pipelineError: error || null,
    ready: false,
    running: false,
    presentationUrl: presentationUrl || null,
  }
}

function statusPayload(projectCode, leadId, link) {
  if (!link) {
    return {
      ok: true,
      leadId: String(leadId),
      exists: false,
      ready: false,
      running: isLeadPipelineRunning(leadId),
      pipeline: 'none',
      pipelineStep: null,
      pipelineError: null,
      url: null,
      publicId: null,
      guestName: null,
      templateCode: null,
      templateName: null,
    }
  }
  const mapped = mapWidgetPipelineStatus({
    meta: link.summaryMeta,
    publicId: link.publicId,
    leadId: link.externalId || leadId,
  })
  const url = guestLinkUrl(projectCode, link.publicId)
  return {
    ok: true,
    leadId: String(leadId),
    exists: true,
    ready: mapped.ready,
    running: mapped.running,
    pipeline: mapped.pipeline,
    pipelineStep: mapped.pipelineStep,
    pipelineError: mapped.pipelineError,
    // Ссылку отдаём всегда (менеджер в виджете), но ready=false пока идёт пайплайн.
    url,
    publicId: link.publicId,
    guestName: link.guestName || null,
    templateCode: link.templateCode || null,
    templateName: link.templateName || null,
  }
}

function widgetToken(req) {
  const fromBearer = bearerToken(req)
  if (fromBearer) return fromBearer
  const header = req.headers?.['x-api-key']
  const fromHeader = Array.isArray(header) ? header[0] : header
  if (fromHeader) return String(fromHeader).trim()
  try {
    const q = new URL(req.url || '/', 'http://local').searchParams
    return String(q.get('key') || '').trim()
  } catch {
    return ''
  }
}

async function authorizeWidget(req, res, json, projectCode) {
  const token = widgetToken(req)
  const key = await findApiKey(token)
  const ip = clientIp(req)
  const limited = consumeRateLimit(key ? `amowidget:key:${key.id}` : `amowidget:ip:${ip}`, {
    windowMs: 60 * 1000,
    max: key ? 120 : 20,
  })
  if (!limited.ok) {
    rateLimited(res, json, limited.retryAfterSec, 'Слишком много запросов. Подождите минуту.')
    return null
  }
  if (!key) {
    json(res, 401, { ok: false, error: 'unauthorized' })
    return null
  }
  if (key.project.code !== projectCode) {
    json(res, 403, { ok: false, error: 'key does not match project' })
    return null
  }
  return key
}

async function issueFromLead(key, leadId, body = {}, req) {
  const connection = await getAmoConnection(key.project.id)
  const redirectUri = amoRedirectUri(req)
  let name = String(body?.name ?? body?.guestName ?? '').trim()
  let statusId = String(body?.statusId ?? body?.status_id ?? '').trim()
  let pipelineId = String(body?.pipelineId ?? body?.pipeline_id ?? '').trim()
  let category = String(body?.category ?? body?.templateCode ?? '').trim()
  let contactId = ''
  let phones = []

  if (connection) {
    try {
      const snap = await fetchAmoLeadSnapshot(connection, leadId, redirectUri)
      name = name || snap.name
      statusId = statusId || snap.statusId
      pipelineId = pipelineId || snap.pipelineId
      contactId = snap.contactId || ''
      phones = snap.phones || []
    } catch (err) {
      console.error('amo widget snapshot', key.project.code, leadId, err)
    }
  }
  // Виджет не должен зависеть от заполненного имени контакта.
  if (!name) name = 'Гость'

  const issued = await issueGuestLink(
    key.project,
    {
      name,
      externalId: String(leadId),
      category: category || undefined,
      statusId: statusId || undefined,
      pipelineId: pipelineId || undefined,
      amoSnapshot: {
        statusId,
        pipelineId,
        externalId: String(leadId),
        contactId,
        phones,
        name,
        source: 'amo_widget',
      },
    },
    { skipTts: true },
  )
  if (issued.error) return issued
  await touchApiKeyUsed(key.id)

  if (issued.link?.publicId) {
    schedulePresentationPipeline({
      project: key.project,
      publicId: issued.link.publicId,
      connection,
      redirectUri,
      leadId: String(leadId),
    })
  }

  amoLog('widget.issue.ok', {
    project: key.project.code,
    leadId: String(leadId),
    publicId: issued.link?.publicId || null,
    reused: Boolean(issued.reused),
    guestName: issued.link?.guestName || null,
  })

  return {
    status: 200,
    reused: Boolean(issued.reused),
    link: issued.link,
    guestName: name || issued.link?.guestName || '',
  }
}

export async function handleAmoWidgetApi(req, res, url, json, extras = {}) {
  const match = url.match(WIDGET_PATH)
  if (!match) return false

  applyAmoWidgetCors(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }

  const projectCode = decodeURIComponent(match[1])
  const leadId = String(decodeURIComponent(match[2] || '')).trim()
  const action = match[3] ? String(match[3]).toLowerCase() : ''

  if (!leadId || !/^\d+$/.test(leadId)) {
    json(res, 400, { ok: false, error: 'invalid lead id' })
    return true
  }

  const key = await authorizeWidget(req, res, json, projectCode)
  if (!key) return true

  if (!action && (req.method === 'GET' || req.method === 'HEAD')) {
    const link = await getLinkWidgetStatusByExternalId(key.project.id, leadId)
    amoLog('widget.status', {
      project: key.project.code,
      leadId,
      exists: Boolean(link),
      publicId: link?.publicId || null,
    })
    json(res, 200, statusPayload(key.project.code, leadId, link))
    return true
  }

  if (action === 'issue' && req.method === 'POST') {
    amoLog('widget.issue.start', {
      project: key.project.code,
      leadId,
    })
    const issued = await issueFromLead(key, leadId, extras.body || {}, req)
    if (issued.error) {
      amoLog('widget.issue.fail', {
        project: key.project.code,
        leadId,
        error: issued.error,
        status: issued.status ?? null,
      })
      json(res, issued.status || 400, { ok: false, error: issued.error })
      return true
    }
    const link = await getLinkWidgetStatusByExternalId(key.project.id, leadId)
    const status = statusPayload(key.project.code, leadId, link)
    json(res, 200, {
      ...status,
      issued: true,
      reused: Boolean(issued.reused),
      // Пока пайплайн не закончил — ready обычно false; url уже известен.
      pipeline: status.running ? status.pipeline : status.pipeline || 'pending',
      running: true,
      ready: false,
    })
    return true
  }

  json(res, 405, { ok: false, error: 'method not allowed' })
  return true
}
