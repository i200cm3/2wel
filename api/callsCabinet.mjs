import {
  amoRedirectUri,
  buildPipelineStatusIndex,
  enrichCallWithPipelineNames,
  fetchAmoLeadSnapshot,
  fetchAmoPipelinesCached,
  resolvePipelineStatusNames,
} from './amoAuth.mjs'
import {
  deleteAmoCallSummaryById,
  getAmoCallSummaryById,
  listAmoCallSummaries,
  patchAmoCallSummary,
  summarizeAmoCallInsights,
} from './amoCallSummaries.mjs'
import { getAmoConnection } from './amoConnections.mjs'
import { projectForUser } from './cabinet.mjs'
import { reprocessCallSummaryNote } from './callSummaryPipeline.mjs'

function parseListQuery(req) {
  let limit = 50
  let offset = 0
  let status = ''
  let leadId = ''
  let intent = ''
  let declineReason = ''
  let needsFollowUp = ''
  let hasOperatorReview = ''
  let followUpStatus = ''
  let warmLeads = ''
  let days = ''
  let orderBy = ''
  let orderDir = ''
  let pipelineId = ''
  let statusId = ''
  try {
    const url = new URL(req.url || '/', 'http://local')
    limit = Number(url.searchParams.get('limit') || 50)
    offset = Number(url.searchParams.get('offset') || 0)
    status = String(url.searchParams.get('status') || '').trim()
    leadId = String(url.searchParams.get('leadId') || '').trim()
    intent = String(url.searchParams.get('intent') || '').trim()
    declineReason = String(url.searchParams.get('declineReason') || '').trim()
    needsFollowUp = String(url.searchParams.get('needsFollowUp') || '').trim()
    hasOperatorReview = String(url.searchParams.get('hasOperatorReview') || '').trim()
    followUpStatus = String(url.searchParams.get('followUpStatus') || '').trim()
    warmLeads = String(url.searchParams.get('warmLeads') || '').trim()
    days = String(url.searchParams.get('days') || '').trim()
    orderBy = String(url.searchParams.get('orderBy') || url.searchParams.get('sort') || '').trim()
    orderDir = String(url.searchParams.get('orderDir') || url.searchParams.get('sortDir') || '').trim()
    pipelineId = String(url.searchParams.get('pipelineId') || '').trim()
    statusId = String(url.searchParams.get('statusId') || '').trim()
  } catch {
    /* ignore */
  }
  return {
    limit,
    offset,
    status,
    leadId,
    intent,
    declineReason,
    needsFollowUp,
    hasOperatorReview,
    followUpStatus,
    warmLeads,
    days,
    orderBy,
    orderDir,
    pipelineId,
    statusId,
  }
}

async function loadPipelinesForCalls(connection, redirectUri) {
  if (!connection) return []
  try {
    return await fetchAmoPipelinesCached(connection, redirectUri)
  } catch (err) {
    console.warn('amo pipelines for calls', err?.message || err)
    return []
  }
}

async function enrichCallDetail(call, connection, redirectUri, index) {
  const enriched = enrichCallWithPipelineNames(call, index)
  const leadId = String(call?.leadId || '').trim()
  if (!connection || !leadId || leadId === '0') {
    return {
      ...enriched,
      currentPipelineId: null,
      currentStatusId: null,
      currentPipelineName: null,
      currentStatusName: null,
      currentStatusType: null,
    }
  }
  try {
    const snap = await fetchAmoLeadSnapshot(connection, leadId, redirectUri)
    const currentPipelineId = snap.pipelineId || null
    const currentStatusId = snap.statusId || null
    const names = resolvePipelineStatusNames(index, currentPipelineId, currentStatusId)
    return {
      ...enriched,
      currentPipelineId,
      currentStatusId,
      currentPipelineName: names.pipelineName,
      currentStatusName: names.statusName,
      currentStatusType: names.statusType,
    }
  } catch (err) {
    console.warn('amo lead snapshot for call', leadId, err?.message || err)
    return {
      ...enriched,
      currentPipelineId: null,
      currentStatusId: null,
      currentPipelineName: null,
      currentStatusName: null,
      currentStatusType: null,
    }
  }
}

function canReprocessCall(call) {
  const status = String(call?.status || '')
  return status !== 'pending' && status !== 'running'
}

/** GET|DELETE /api/projects/:code/calls[/:id] — звонки с саммари/транскриптом.
 *  GET /api/projects/:code/calls/stats — сводка insights.
 *  POST /api/projects/:code/calls/:id/reprocess — ручной перезапуск анализа.
 */
export async function handleCallsCabinet(req, res, url, method, json, userId, extras = {}) {
  const body = extras.body || {}
  const stats = url.match(/^\/api\/projects\/([^/]+)\/calls\/stats\/?$/)
  if (stats) {
    const project = await projectForUser(userId, decodeURIComponent(stats[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    let days = 30
    try {
      const parsed = new URL(req.url || '/', 'http://local')
      days = Number(parsed.searchParams.get('days') || 30)
    } catch {
      /* ignore */
    }
    const summary = await summarizeAmoCallInsights(project.id, { days })
    const connection = await getAmoConnection(project.id)
    json(res, 200, {
      ok: true,
      stats: summary,
      amoBaseDomain: connection?.baseDomain || null,
    })
    return true
  }

  const followUp = url.match(/^\/api\/projects\/([^/]+)\/calls\/([^/]+)\/follow-up\/?$/)
  if (followUp) {
    const project = await projectForUser(userId, decodeURIComponent(followUp[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'POST' && method !== 'PATCH') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const callId = decodeURIComponent(followUp[2])
    const call = await getAmoCallSummaryById(project.id, callId)
    if (!call) {
      json(res, 404, { error: 'call not found' })
      return true
    }
    let nextStatus = String(body.status || body.followUpStatus || '').trim()
    if (!nextStatus) {
      // allow query ?status=done as fallback
      try {
        const parsed = new URL(req.url || '/', 'http://local')
        nextStatus = String(parsed.searchParams.get('status') || '').trim()
      } catch {
        /* ignore */
      }
    }
    if (nextStatus !== 'open' && nextStatus !== 'done') {
      json(res, 400, { error: 'status: open|done' })
      return true
    }
    const updated = await patchAmoCallSummary(project.id, call.callNoteId, {
      followUpStatus: nextStatus,
      ...(body.dueAt ? { followUpDueAt: body.dueAt } : {}),
    })
    json(res, 200, { ok: true, call: updated })
    return true
  }

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
      json(res, 400, { error: 'Нельзя перезапустить' })
      return true
    }
    const connection = await getAmoConnection(project.id)
    if (!connection) {
      json(res, 400, { error: 'AmoCRM не подключён' })
      return true
    }

    const leadId = String(call.leadId || '').trim()
    const callNoteId = String(call.callNoteId || '').trim()
    // Полный перезапуск: STT + саммари + insights. Старый транскрипт сбрасываем.
    const updated =
      (await patchAmoCallSummary(project.id, callNoteId, {
        status: 'pending',
        skipReason: null,
        error: null,
        transcript: null,
        summaryOutcome: null,
        summaryNextStep: null,
        operatorReviewMiss: null,
        operatorReviewDetail: null,
        insights: null,
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

  const leadPage = url.match(/^\/api\/projects\/([^/]+)\/calls\/leads\/([^/]+)\/?$/)
  if (leadPage) {
    const project = await projectForUser(userId, decodeURIComponent(leadPage[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const leadId = String(decodeURIComponent(leadPage[2] || '')).trim()
    if (!leadId || leadId === '0') {
      json(res, 400, { error: 'leadId required' })
      return true
    }
    const data = await listAmoCallSummaries(project.id, {
      leadId,
      limit: 100,
      offset: 0,
    })
    const connection = await getAmoConnection(project.id)
    const redirectUri = amoRedirectUri(req)
    const pipelines = await loadPipelinesForCalls(connection, redirectUri)
    const index = buildPipelineStatusIndex(pipelines)
    const calls = (data.calls || []).map((call) => enrichCallWithPipelineNames(call, index))

    let leadName = null
    let currentPipelineId = null
    let currentStatusId = null
    let currentPipelineName = null
    let currentStatusName = null
    let currentStatusType = null
    let leadUpdatedAt = null
    if (connection) {
      try {
        const snap = await fetchAmoLeadSnapshot(connection, leadId, redirectUri)
        leadName = snap.name || null
        currentPipelineId = snap.pipelineId || null
        currentStatusId = snap.statusId || null
        leadUpdatedAt = snap.updatedAt || null
        const names = resolvePipelineStatusNames(index, currentPipelineId, currentStatusId)
        currentPipelineName = names.pipelineName
        currentStatusName = names.statusName
        currentStatusType = names.statusType
      } catch (err) {
        console.warn('amo lead page snapshot', leadId, err?.message || err)
      }
    }

    json(res, 200, {
      ok: true,
      lead: {
        leadId,
        name: leadName,
        currentPipelineId,
        currentStatusId,
        currentPipelineName,
        currentStatusName,
        currentStatusType,
        updatedAt: leadUpdatedAt,
      },
      total: data.total,
      calls,
      amoBaseDomain: connection?.baseDomain || null,
    })
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
    const redirectUri = amoRedirectUri(req)
    const pipelines = await loadPipelinesForCalls(connection, redirectUri)
    const index = buildPipelineStatusIndex(pipelines)
    const enriched = await enrichCallDetail(call, connection, redirectUri, index)
    json(res, 200, {
      ok: true,
      call: enriched,
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
    const redirectUri = amoRedirectUri(req)
    const pipelines = await loadPipelinesForCalls(connection, redirectUri)
    const index = buildPipelineStatusIndex(pipelines)
    json(res, 200, {
      ok: true,
      ...data,
      calls: (data.calls || []).map((call) => enrichCallWithPipelineNames(call, index)),
      pipelines,
      amoBaseDomain: connection?.baseDomain || null,
    })
    return true
  }

  return false
}
