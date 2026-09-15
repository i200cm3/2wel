import { deleteAmoCallSummaryById, getAmoCallSummaryById, listAmoCallSummaries } from './amoCallSummaries.mjs'
import { getAmoConnection } from './amoConnections.mjs'
import { projectForUser } from './cabinet.mjs'

function parseListQuery(req) {
  let limit = 50
  let offset = 0
  let status = ''
  try {
    const url = new URL(req.url || '/', 'http://local')
    limit = Number(url.searchParams.get('limit') || 50)
    offset = Number(url.searchParams.get('offset') || 0)
    status = String(url.searchParams.get('status') || '').trim()
  } catch {
    /* ignore */
  }
  return { limit, offset, status }
}

/** GET|DELETE /api/projects/:code/calls[/:id] — звонки с саммари/транскриптом. */
export async function handleCallsCabinet(req, res, url, method, json, userId) {
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
