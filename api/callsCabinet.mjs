import { amoRedirectUri } from './amoAuth.mjs'
import {
  deleteAmoCallSummaryById,
  getAmoCallSummaryById,
  listAmoCallSummaries,
  patchAmoCallSummary,
} from './amoCallSummaries.mjs'
import { getAmoConnection } from './amoConnections.mjs'
import { projectForUser } from './cabinet.mjs'
import { reprocessCallSummaryNote } from './callSummaryPipeline.mjs'

function parseListQuery(req) {
  let limit = 50
  let offset = 0
  let status = ''
  let leadId = ''
  try {
    const url = new URL(req.url || '/', 'http://local')
    limit = Number(url.searchParams.get('limit') || 50)
    offset = Number(url.searchParams.get('offset') || 0)
    status = String(url.searchParams.get('status') || '').trim()
    leadId = String(url.searchParams.get('leadId') || '').trim()
  } catch {
    /* ignore */
  }
  return { limit, offset, status, leadId }
}

function canReprocessCall(call) {
  const status = String(call?.status || '')
  return status === 'failed' || status === 'skipped'
}

/** GET|DELETE /api/projects/:code/calls[/:id] — звонки с саммари/транскриптом.
 *  POST /api/projects/:code/calls/:id/reprocess — ручной перезапуск анализа.
 */
export async function handleCallsCabinet(req, res, url, method, json, userId) {
  const reprocess = url.match(/^\/api\/projects\/([^/]+)\/calls\/([^/]+)\/reprocess\/?$/)
  if (reprocess) {
    const project = await projectForUser(userId, decodeURIComponent(reprocess[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const callId = decodeURIComponent(reprocess[2])
    const call = await getAmoCallSummaryById(project.id, callId)
    if (!call) {
      json(res, 404, { error: 'call not found' })
      return true
    }
    if (call.status === 'running' || call.status === 'pending') {
      json(res, 409, { error: 'Звонок уже в обработке' })
      return true
    }
    if (!canReprocessCall(call)) {
      json(res, 400, { error: 'Анализ уже выполнен' })
      return true
    }
    const connection = await getAmoConnection(project.id)
    if (!connection) {
      json(res, 400, { error: 'AmoCRM не подключён' })
      return true
    }

    const leadId = String(call.leadId || '').trim()
    const callNoteId = String(call.callNoteId || '').trim()
    const updated =
      (await patchAmoCallSummary(project.id, callNoteId, {
        status: 'pending',
        skipReason: null,
        error: null,
      })) || { ...call, status: 'pending', skipReason: null, error: null }

    void reprocessCallSummaryNote({
      projectId: project.id,
      projectCode: project.code,
      connection: { ...connection, projectId: project.id },
      redirectUri: amoRedirectUri(req),
      callNoteId,
      leadId: leadId && leadId !== '0' ? leadId : '',
    }).catch((err) => console.error('amo call reprocess', project.code, callNoteId, err))

    json(res, 200, { ok: true, call: updated })
    return true
  }

  const one = url.match(/^\/api\/projects\/([^/]+)\/calls\/([^/]+)\/?$/)
  if (one) {
    const project = await projectForUser(userId, decodeURIComponent(one[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    const callId = decodeURIComponent(one[2])
    if (method === 'DELETE') {
      const deleted = await deleteAmoCallSummaryById(project.id, callId)
      if (!deleted) {
        json(res, 404, { error: 'call not found' })
        return true
      }
      json(res, 200, { ok: true })
      return true
    }
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const call = await getAmoCallSummaryById(project.id, callId)
    if (!call) {
      json(res, 404, { error: 'call not found' })
      return true
    }
    const connection = await getAmoConnection(project.id)
    json(res, 200, {
      ok: true,
      call,
      amoBaseDomain: connection?.baseDomain || null,
    })
    return true
  }

  const list = url.match(/^\/api\/projects\/([^/]+)\/calls\/?$/)
  if (list) {
    const project = await projectForUser(userId, decodeURIComponent(list[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const q = parseListQuery(req)
    const data = await listAmoCallSummaries(project.id, q)
    const connection = await getAmoConnection(project.id)
    json(res, 200, {
      ok: true,
      ...data,
      amoBaseDomain: connection?.baseDomain || null,
    })
    return true
  }

  return false
}
