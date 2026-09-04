import {
  amoRedirectUri,
  amoAuthorizeUrl,
  amoEnv,
  ensureAmoWebhook,
  fetchAmoPipelines,
  signAmoState,
  unsubscribeAmoWebhook,
} from './amoAuth.mjs'
import { deleteAmoConnection, getAmoConnection } from './amoConnections.mjs'
import { listAmoStatusMaps, replaceAmoStatusMaps } from './amoStatusMaps.mjs'
import { listTemplates, projectForUser } from './cabinet.mjs'

export async function handleAmoCabinet(req, res, url, method, json, userId, extras = {}) {
  const connect = url.match(/^\/api\/projects\/([^/]+)\/amocrm\/connect\/?$/)
  if (connect) {
    const project = await projectForUser(userId, decodeURIComponent(connect[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const env = amoEnv()
    if (!env.configured) {
      json(res, 503, { error: 'AmoCRM на сервере не настроена (AMO_CLIENT_ID / AMO_CLIENT_SECRET)' })
      return true
    }
    json(res, 200, {
      ok: true,
      authUrl: amoAuthorizeUrl(signAmoState(project.id)),
      redirectUri: amoRedirectUri(req),
    })
    return true
  }

  const statusMapPath = url.match(/^\/api\/projects\/([^/]+)\/amocrm\/status-map\/?$/)
  if (statusMapPath) {
    const project = await projectForUser(userId, decodeURIComponent(statusMapPath[1]))
    if (!project) {
      json(res, 404, { error: 'project not found' })
      return true
    }
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, maps: await listAmoStatusMaps(project.id) })
      return true
    }
    if (method === 'PUT') {
      const body = extras.body && typeof extras.body === 'object' ? extras.body : {}
      const templates = await listTemplates(project.id)
      const codes = new Set(templates.map((item) => item.code))
      const saved = await replaceAmoStatusMaps(project.id, body.maps ?? body, codes)
      if (!saved.ok) {
        json(res, 400, { error: saved.error })
        return true
      }
      json(res, 200, { ok: true, maps: saved.maps })
      return true
    }
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  const root = url.match(/^\/api\/projects\/([^/]+)\/amocrm\/?$/)
  if (!root) return false
  const project = await projectForUser(userId, decodeURIComponent(root[1]))
  if (!project) {
    json(res, 404, { error: 'project not found' })
    return true
  }

  if (method === 'GET' || method === 'HEAD') {
    const env = amoEnv()
    const conn = await getAmoConnection(project.id)
    let pipelines = []
    if (conn) {
      try {
        pipelines = await fetchAmoPipelines(conn, amoRedirectUri(req))
      } catch (err) {
        console.error('amo pipelines', project.code, err)
      }
      if (conn.webhookDestination) {
        try {
          await ensureAmoWebhook(conn, conn.webhookDestination, amoRedirectUri(req))
        } catch (err) {
          console.warn('amo webhook ensure', project.code, err?.message || err)
        }
      }
    }
    json(res, 200, {
      ok: true,
      configured: env.configured,
      connected: Boolean(conn),
      baseDomain: conn?.baseDomain ?? null,
      webhookUrl: conn?.webhookDestination ?? null,
      connectedAt: conn?.connectedAt ?? null,
      statusMaps: await listAmoStatusMaps(project.id),
      pipelines,
    })
    return true
  }

  if (method === 'DELETE') {
    const conn = await getAmoConnection(project.id)
    if (conn) {
      await unsubscribeAmoWebhook(conn, conn.webhookDestination, amoRedirectUri(req))
      await deleteAmoConnection(project.id)
    }
    json(res, 200, { ok: true })
    return true
  }

  json(res, 405, { error: 'method not allowed' })
  return true
}
