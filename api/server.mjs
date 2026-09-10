import { applyDerivedFlowToConfig } from './assembly.mjs'
import http from 'node:http'
import {
  isProtectedApi,
  issueToken,
  readSession,
  requestIsHttps,
  requestSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from './auth.js'
import { createProjectForUser, handleCabinetApi, projectForUser } from './cabinet.mjs'
import { generateCueCopy } from './cueCopyGenerate.mjs'
import { adminSetProjectPlan } from './plans.mjs'
import { parseProjectCode } from './projectCode.mjs'
import { query } from './db.js'
import { clientIp, consumeRateLimit, rateLimited } from './rateLimit.mjs'
import { deviceFromUa, EVENT_TYPES, parseContactChannel, parseTopic, recordLinkEvent, userAgentOf } from './events.mjs'
import { getLinkForEvent, getPublicPlayback, touchLinkOpen } from './links.mjs'
import { parsePreviewPath, previewJpegForRow } from './linkPreview.mjs'
import { rewriteConfigMedia } from './projectMedia.mjs'
import { handleProjectMedia } from './media.mjs'
import { handleProjectTts, handlePublicTts, signConfigTts } from './tts.mjs'
import { exportTemplateArchiveForUser, importTemplateArchiveForUser } from './templateArchive.mjs'
import { applyCaptionsFromTts, personalizeConfigTts } from './ttsPersonalize.mjs'
import {
  changeUserPassword,
  deleteUserAccount,
  findUserByEmail,
  findUserById,
  getUserWorkspace,
  isAdminUser,
  isBlockedUser,
  loginUser,
  markEmailVerified,
  publicUser,
  registerUser,
  searchUsers,
  setUserAdmin,
  setUserBlocked,
  setUserPassword,
} from './users.mjs'
import { handleV1Api } from './v1.mjs'
import { amoRedirectUri, ensureAllAmoWebhooks } from './amoAuth.mjs'
import { parseV1Body } from './amoWebhook.mjs'
import {
  consumeInvite,
  consumePasswordReset,
  createInvite,
  createPasswordReset,
  listInvites,
  markInviteUsed,
  publicOrigin,
  publicRegistration,
  registrationMode,
} from './access.mjs'
import {
  claimProjectInvite,
  peekProjectInvite,
} from './members.mjs'
import { isOtpPurpose, issueEmailOtp, verifyEmailOtp } from './otp.mjs'
import { sendTeamJoinCredentialsMail } from './mail.mjs'
import { getAdminTtsUsageOverview } from './ttsUsage.mjs'
import { createDemoGuestLead } from './demoLead.mjs'
import {
  getAdminIntegrationsOverview,
  updateAdminIntegrations,
} from './platformIntegrations.mjs'

const PORT = Number(process.env.PORT || 3000)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024
const MAX_JSON_BYTES = 8 * 1024 * 1024

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function issueSession(req, res, userId, { remember = false } = {}) {
  const token = issueToken(userId, { remember })
  setSessionCookie(res, token, { remember, secure: requestIsHttps(req) })
  return token
}

function pathnameOf(req) {
  try {
    return new URL(req.url || '/', 'http://local').pathname
  } catch {
    return (req.url || '').split('?')[0]
  }
}

function queryOf(req) {
  try {
    return new URL(req.url || '/', 'http://local').searchParams
  } catch {
    return new URLSearchParams()
  }
}

function headerStr(value, fallback) {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      const buf = Buffer.from(c)
      size += buf.length
      if (size > maxBytes) {
        reject(new Error('file too large'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}


const server = http.createServer(async (req, res) => {
  const url = pathnameOf(req)
  try {
    if (url === '/health' || url === '/api/health') {
      try {
        await query('SELECT 1')
        json(res, 200, { ok: true, db: true })
      } catch {
        json(res, 503, { ok: false, db: false })
      }
      return
    }

    const previewId = parsePreviewPath(url)
    if (previewId && (req.method === 'GET' || req.method === 'HEAD')) {
      const limited = consumeRateLimit(`preview:${clientIp(req)}`, { windowMs: 60 * 1000, max: 40 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много запросов превью.')
        return
      }
      const row = await getPublicPlayback(previewId)
      if (!row) {
        json(res, 404, { error: 'link not found' })
        return
      }
      try {
        const result = await previewJpegForRow(row)
        if (result.disabled) {
          json(res, 404, { error: 'preview disabled' })
          return
        }
        const { jpeg, cacheKey } = result
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/jpeg')
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
        res.setHeader('ETag', `"${cacheKey}"`)
        if (req.method === 'HEAD') {
          res.setHeader('Content-Length', String(jpeg.length))
          res.end()
          return
        }
        res.end(jpeg)
      } catch (err) {
        console.error('link preview', previewId, err)
        json(res, 500, { error: 'preview failed' })
      }
      return
    }

    if (url.startsWith('/api/properties') || url.startsWith('/api/shares')) {
      json(res, 410, { error: 'Используйте /api/projects/:code/templates' })
      return
    }

    const publicEvent = url.match(/^\/api\/public\/links\/([^/]+)\/events\/?$/)
    if (publicEvent && req.method === 'POST') {
      const publicId = decodeURIComponent(publicEvent[1]).replace(/[^a-z0-9]/gi, '')
      const eventLimit = consumeRateLimit(`event:${clientIp(req)}:${publicId}`, {
        windowMs: 60 * 1000,
        max: 60,
      })
      if (!eventLimit.ok) {
        rateLimited(res, json, eventLimit.retryAfterSec, 'Слишком много событий. Подождите минуту.')
        return
      }
      const row = await getLinkForEvent(publicId)
      if (!row) {
        json(res, 404, { error: 'link not found' })
        return
      }
      const raw = await readBuffer(req, 64 * 1024)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}')
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const type = typeof payload?.type === 'string' ? payload.type.trim() : ''
      if (!EVENT_TYPES.includes(type) || type === 'open') {
        json(res, 400, { error: 'unknown event' })
        return
      }
      const topic =
        type === 'topic'
          ? parseTopic(payload?.topic)
          : type === 'contact'
            ? parseContactChannel(payload?.channel ?? payload?.topic)
            : null
      if ((type === 'topic' || type === 'contact') && !topic) {
        json(res, 400, { error: 'unknown event' })
        return
      }
      const ua = userAgentOf(req)
      await recordLinkEvent({
        linkId: row.id,
        projectId: row.project_id,
        type,
        userAgent: ua,
        device: deviceFromUa(ua),
        topic,
      })
      json(res, 200, { ok: true })
      return
    }

    const publicTts = url.match(/^\/api\/public\/tts\/([^/]+)\/?$/)
    if (publicTts) {
      handlePublicTts(req, res, decodeURIComponent(publicTts[1]), json)
      return
    }

    if (url === '/api/public/demo' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`demo:${ip}`, { windowMs: 60 * 60 * 1000, max: 8 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много запросов демо. Подождите.')
        return
      }
      const raw = await readBuffer(req, 16 * 1024)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}')
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const result = await createDemoGuestLead({
        name: payload?.name,
        email: payload?.email,
        source: 'offer_demo',
      })
      if (!result.ok) {
        json(res, result.status || 500, { error: result.error || 'demo failed' })
        return
      }
      json(res, 200, { ok: true, mailed: result.mailed, reused: Boolean(result.reused) })
      return
    }

    const publicLink = url.match(/^\/api\/public\/links\/([^/]+)\/?$/)
    if (publicLink && (req.method === 'GET' || req.method === 'HEAD')) {
      const publicId = decodeURIComponent(publicLink[1]).replace(/[^a-z0-9]/gi, '')
      const row = await getPublicPlayback(publicId)
      if (!row) {
        json(res, 404, { error: 'link not found' })
        return
      }
      if (req.method === 'GET') {
        try {
          await touchLinkOpen(row.id)
          const ua = userAgentOf(req)
          await recordLinkEvent({
            linkId: row.id,
            projectId: row.project_id,
            type: 'open',
            userAgent: ua,
            device: deviceFromUa(ua),
          })
        } catch (err) {
          console.error('link open event failed', err)
        }
      }
      let playbackConfig = applyDerivedFlowToConfig(
        rewriteConfigMedia(row.config, row.project_code),
        row.derived_flow,
      )
      if (row.captions_from_tts) {
        playbackConfig = applyCaptionsFromTts(playbackConfig)
      }
      json(res, 200, {
        ok: true,
        id: row.public_id,
        guestName: row.guest_name,
        property: signConfigTts(
          (
            await personalizeConfigTts(
              { id: row.project_id, code: row.project_code },
              playbackConfig,
              row.guest_name,
              {
                required: false,
                // Массовую статику не генерируем на открытии — иначе таймаут гостевой ссылки.
                // Статика дожимается при сборке (fill_missing_tts).
                fillMissingStatic: false,
              },
            )
          ).config,
          row.project_code,
        ),
      })
      return
    }

    if (url.startsWith('/api/v1/')) {
      let body
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        const parsed = parseV1Body(
          raw,
          Array.isArray(req.headers['content-type'])
            ? req.headers['content-type'][0]
            : req.headers['content-type'],
        )
        if (!parsed.ok) {
          json(res, 400, { error: parsed.error || 'invalid json' })
          return
        }
        body = parsed.body
      }
      if (await handleV1Api(req, res, url, json, { body })) return
      json(res, 404, { error: 'not found' })
      return
    }

    if (url === '/api/auth/registration' && (req.method === 'GET' || req.method === 'HEAD')) {
      json(res, 200, { ok: true, ...publicRegistration() })
      return
    }

    if (
      (url === '/api/auth/join' || url === '/api/auth/join/') &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      const peeked = await peekProjectInvite(queryOf(req).get('invite') || queryOf(req).get('token'))
      if (!peeked.ok) {
        json(res, 400, { error: peeked.error })
        return
      }
      json(res, 200, {
        ok: true,
        projectName: peeked.projectName,
        projectCode: peeked.projectCode,
        email: peeked.email,
        existingUser: peeked.existingUser,
        expiresAt: peeked.expiresAt,
      })
      return
    }

    if ((url === '/api/auth/join' || url === '/api/auth/join/') && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`join:${ip}`, { windowMs: 60 * 60 * 1000, max: 20 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много попыток. Подождите.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload = {}
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}')
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const inviteToken = String(payload.invite ?? payload.inviteToken ?? '').trim()
      const claimed = await claimProjectInvite({ token: inviteToken })
      if (!claimed.ok) {
        json(res, claimed.status, { error: claimed.error })
        return
      }
      const origin = publicOrigin(req)
      const loginUrl = origin ? `${origin}/login` : '/login'
      const mailed = await sendTeamJoinCredentialsMail(claimed.email, {
        projectName: claimed.projectName,
        password: claimed.password,
        loginUrl,
        email: claimed.email,
      })
      if (!mailed.ok && !mailed.skipped) {
        console.error('team join credentials mail', claimed.email, mailed.error)
      }
      const remember = payload?.remember !== false
      issueSession(req, res, claimed.user.id, { remember })
      json(res, 200, {
        ok: true,
        emailed: Boolean(mailed?.ok),
        email: claimed.email,
        projectCode: claimed.projectCode,
        projectName: claimed.projectName,
        user: claimed.user,
      })
      return
    }

    if (url === '/api/auth/register' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`register:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много регистраций с этого адреса. Подождите.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const mode = registrationMode()
      if (mode === 'closed') {
        json(res, 403, { error: 'Регистрация закрыта' })
        return
      }
      let invite = null
      if (mode === 'invite') {
        invite = await consumeInvite(payload?.invite ?? payload?.inviteToken, payload?.email ?? payload?.login)
        if (!invite.ok) {
          json(res, 403, { error: invite.error })
          return
        }
      }
      const projectName =
        typeof payload?.projectName === 'string'
          ? payload.projectName.trim()
          : typeof payload?.name === 'string'
            ? payload.name.trim()
            : ''
      if (!projectName) {
        json(res, 400, { error: 'Укажите название объекта' })
        return
      }
      const parsedCode = parseProjectCode(payload?.projectCode ?? payload?.code ?? '')
      if (!parsedCode.ok) {
        json(res, 400, { error: parsedCode.error })
        return
      }
      const { rows: taken } = await query(`SELECT 1 FROM projects WHERE code = $1 LIMIT 1`, [
        parsedCode.code,
      ])
      if (taken[0]) {
        json(res, 409, { error: 'Этот адрес уже занят. Выберите другой.' })
        return
      }
      const result = await registerUser({
        email: payload?.email ?? payload?.login,
        password: payload?.password,
        name: projectName,
      })
      if (!result.ok) {
        json(res, result.status, { error: result.error })
        return
      }
      if (invite?.id) {
        await markInviteUsed(invite.id, result.user.id)
      }
      const created = await createProjectForUser(result.user.id, {
        name: projectName,
        code: parsedCode.code,
      })
      if (created.error) {
        json(res, created.status, { error: created.error })
        return
      }
      await issueEmailOtp(result.user.email, 'register')
      json(res, 200, {
        ok: true,
        needsOtp: true,
        purpose: 'register',
        email: result.user.email,
        project: created.project ?? null,
        guestHost: created.guestHost ?? null,
      })
      return
    }

    if (url === '/api/auth/login' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`login:${ip}`, { windowMs: 15 * 60 * 1000, max: 10 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много попыток входа. Подождите несколько минут.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const email =
        typeof payload.email === 'string'
          ? payload.email.trim()
          : typeof payload.login === 'string'
            ? payload.login.trim()
            : ''
      const password = typeof payload.password === 'string' ? payload.password : ''
      const remember = Boolean(payload.remember)
      const result = await loginUser(email, password)
      if (!result.ok) {
        json(res, 401, { error: result.error })
        return
      }
      if (result.user.email_verified === false) {
        await issueEmailOtp(result.user.email || email, 'login')
        json(res, 200, {
          ok: true,
          needsOtp: true,
          purpose: 'login',
          email: result.user.email || email,
        })
        return
      }
      json(res, 200, {
        ok: true,
        token: issueSession(req, res, result.user.id, { remember }),
        user: publicUser(result.user),
      })
      return
    }

    if (url === '/api/auth/forgot' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`forgot:${ip}`, { windowMs: 60 * 60 * 1000, max: 8 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много запросов сброса. Подождите.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const email =
        typeof payload.email === 'string'
          ? payload.email.trim()
          : typeof payload.login === 'string'
            ? payload.login.trim()
            : ''
      const user = email ? await findUserByEmail(email) : null
      if (user) await issueEmailOtp(user.email || email, 'reset')
      json(res, 200, {
        ok: true,
        needsOtp: true,
        purpose: 'reset',
        email,
        message: 'Если такая почта есть, отправим код из 4 цифр. Действует 10 минут.',
      })
      return
    }

    if (url === '/api/auth/otp/resend' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`otp-resend:${ip}`, { windowMs: 60 * 60 * 1000, max: 8 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много запросов кода. Подождите.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const email = typeof payload.email === 'string' ? payload.email.trim() : ''
      const purpose = isOtpPurpose(payload.purpose) ? payload.purpose : ''
      if (!email || !purpose) {
        json(res, 400, { error: 'Укажите почту и назначение кода' })
        return
      }
      const user = await findUserByEmail(email)
      if (user) await issueEmailOtp(user.email || email, purpose)
      json(res, 200, { ok: true, needsOtp: true, email, purpose })
      return
    }

    if (url === '/api/auth/otp/verify' && req.method === 'POST') {
      const ip = clientIp(req)
      const limited = consumeRateLimit(`otp-verify:${ip}`, { windowMs: 15 * 60 * 1000, max: 20 })
      if (!limited.ok) {
        rateLimited(res, json, limited.retryAfterSec, 'Слишком много попыток. Подождите.')
        return
      }
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const email = typeof payload.email === 'string' ? payload.email.trim() : ''
      const purpose = isOtpPurpose(payload.purpose) ? payload.purpose : ''
      const code = typeof payload.code === 'string' ? payload.code : String(payload.code ?? '')
      const checked = await verifyEmailOtp(email, purpose, code)
      if (!checked.ok) {
        json(res, 400, { error: checked.error })
        return
      }
      const user = await findUserByEmail(checked.email)
      if (purpose === 'reset') {
        if (!user) {
          json(res, 400, { error: 'Код недействителен' })
          return
        }
        const token = await createPasswordReset(user.id)
        json(res, 200, { ok: true, purpose: 'reset', resetToken: token })
        return
      }
      if (!user) {
        json(res, 400, { error: 'Код недействителен' })
        return
      }
      await markEmailVerified(user.id)
      const remember = Boolean(payload.remember)
      json(res, 200, {
        ok: true,
        purpose,
        token: issueSession(req, res, user.id, { remember }),
        user: publicUser(user),
      })
      return
    }

    if (url === '/api/auth/reset' && req.method === 'POST') {
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const consumed = await consumePasswordReset(payload?.token)
      if (!consumed.ok) {
        json(res, 400, { error: consumed.error })
        return
      }
      const updated = await setUserPassword(consumed.userId, payload?.password)
      if (!updated.ok) {
        json(res, updated.status, { error: updated.error })
        return
      }
      json(res, 200, {
        ok: true,
        token: issueSession(req, res, consumed.userId),
      })
      return
    }

    if (url === '/api/auth/logout' && req.method === 'POST') {
      clearSessionCookie(res, { secure: requestIsHttps(req) })
      json(res, 200, { ok: true })
      return
    }

    const session = readSession(requestSessionToken(req))

    if (url === '/api/auth/me' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!session) {
        json(res, 401, { ok: false })
        return
      }
      const user = await findUserById(session.userId)
      if (!user || isBlockedUser(user)) {
        json(res, 401, { ok: false })
        return
      }
      json(res, 200, { ok: true, user: publicUser(user) })
      return
    }

    if (isProtectedApi(url, req.method) && !session) {
      json(res, 401, { error: 'unauthorized' })
      return
    }

    if (session && isProtectedApi(url, req.method)) {
      const actor = await findUserById(session.userId)
      if (!actor || isBlockedUser(actor)) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
    }

    if (session && url === '/api/auth/password' && req.method === 'POST') {
      const raw = await readBuffer(req, MAX_JSON_BYTES)
      let payload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        json(res, 400, { error: 'invalid json' })
        return
      }
      const updated = await changeUserPassword(
        session.userId,
        payload?.currentPassword ?? payload?.password,
        payload?.newPassword ?? payload?.nextPassword,
      )
      if (!updated.ok) {
        json(res, updated.status, { error: updated.error })
        return
      }
      json(res, 200, { ok: true })
      return
    }

    if (session && (url === '/api/auth/invites' || url === '/api/auth/invites/')) {
      const actor = await findUserById(session.userId)
      const canInvite = isAdminUser(actor)
      if (req.method === 'GET' || req.method === 'HEAD') {
        json(res, 200, {
          ok: true,
          ...publicRegistration(),
          canInvite,
          invites: canInvite ? await listInvites() : [],
        })
        return
      }
      if (req.method === 'POST') {
        if (!canInvite) {
          json(res, 403, { error: 'Приглашать может только администратор' })
          return
        }
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        let payload = {}
        try {
          payload = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          json(res, 400, { error: 'invalid json' })
          return
        }
        if (registrationMode() === 'closed') {
          json(res, 403, { error: 'Регистрация закрыта. Создайте пользователя вручную.' })
          return
        }
        const created = await createInvite({
          createdBy: session.userId,
          email: payload?.email,
        })
        json(res, 200, { ok: true, invite: created })
        return
      }
      json(res, 405, { error: 'method not allowed' })
      return
    }

    if (session && url.startsWith('/api/admin/')) {
      const actor = await findUserById(session.userId)
      if (!isAdminUser(actor)) {
        json(res, 403, { error: 'Только для администратора' })
        return
      }
      if ((url === '/api/admin/users' || url === '/api/admin/users/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const q = queryOf(req).get('q') || ''
        const users = await searchUsers(q)
        json(res, 200, { ok: true, users })
        return
      }
      const userMatch = url.match(/^\/api\/admin\/users\/([^/]+)\/?$/)
      if (userMatch) {
        const targetId = decodeURIComponent(userMatch[1])
        if (req.method === 'GET' || req.method === 'HEAD') {
          const workspace = await getUserWorkspace(targetId)
          if (!workspace) {
            json(res, 404, { error: 'Пользователь не найден' })
            return
          }
          json(res, 200, { ok: true, ...workspace })
          return
        }
        if (req.method === 'PATCH') {
          const raw = await readBuffer(req, MAX_JSON_BYTES)
          let payload = {}
          try {
            payload = JSON.parse(raw.toString('utf8') || '{}')
          } catch {
            json(res, 400, { error: 'invalid json' })
            return
          }
          const hasAdmin = typeof payload.isAdmin === 'boolean'
          const hasBlocked = typeof payload.isBlocked === 'boolean'
          if (hasAdmin === hasBlocked) {
            json(res, 400, { error: 'Укажите isAdmin или isBlocked: true|false' })
            return
          }
          const updated = hasAdmin
            ? await setUserAdmin(session.userId, targetId, payload.isAdmin)
            : await setUserBlocked(session.userId, targetId, payload.isBlocked)
          if (!updated.ok) {
            json(res, updated.status, { error: updated.error })
            return
          }
          json(res, 200, { ok: true, user: updated.user })
          return
        }
        if (req.method === 'DELETE') {
          const removed = await deleteUserAccount(session.userId, targetId)
          if (!removed.ok) {
            json(res, removed.status, { error: removed.error })
            return
          }
          json(res, 200, { ok: true })
          return
        }
        json(res, 405, { error: 'method not allowed' })
        return
      }
      if ((url === '/api/admin/tts-usage' || url === '/api/admin/tts-usage/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const daysRaw = Number(queryOf(req).get('days') || 0)
        const days = Number.isFinite(daysRaw) ? daysRaw : 0
        const overview = await getAdminTtsUsageOverview({ days })
        json(res, 200, { ok: true, ...overview })
        return
      }
      if (
        (url === '/api/admin/integrations' || url === '/api/admin/integrations/') &&
        (req.method === 'GET' || req.method === 'HEAD' || req.method === 'PATCH')
      ) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const overview = await getAdminIntegrationsOverview()
          json(res, 200, { ok: true, ...overview })
          return
        }
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        let payload = {}
        try {
          payload = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          json(res, 400, { error: 'invalid json' })
          return
        }
        const updated = await updateAdminIntegrations(payload)
        if (!updated.ok) {
          json(res, updated.status || 400, { error: updated.error || 'Не удалось сохранить' })
          return
        }
        json(res, 200, { ok: true, ...updated })
        return
      }
      const adminPlanMatch = url.match(/^\/api\/admin\/projects\/([^/]+)\/plan\/?$/)
      if (adminPlanMatch) {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        const projectCode = decodeURIComponent(adminPlanMatch[1])
        const project = await projectForUser(session.userId, projectCode)
        if (!project) {
          json(res, 404, { error: 'project not found' })
          return
        }
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        let payload = {}
        try {
          payload = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          json(res, 400, { error: 'invalid json' })
          return
        }
        const changed = await adminSetProjectPlan(project, session.userId, payload?.plan)
        if (changed.error) {
          json(res, changed.status, { error: changed.error })
          return
        }
        json(res, 200, { ok: true, ...changed.plan })
        return
      }
      if ((url === '/api/admin/generate-cue-copy' || url === '/api/admin/generate-cue-copy/') && req.method === 'POST') {
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        let payload = {}
        try {
          payload = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          json(res, 400, { error: 'invalid json' })
          return
        }
        const generated = await generateCueCopy(payload)
        if (!generated.ok) {
          json(res, generated.status || 502, {
            error: generated.error || 'generate failed',
            ...(generated.detail ? { detail: generated.detail } : {}),
          })
          return
        }
        json(res, 200, {
          ok: true,
          title: generated.title,
          cue: generated.cue,
          model: generated.model,
        })
        return
      }
      json(res, 404, { error: 'not found' })
      return
    }

    if (session && (url.startsWith('/api/projects') || url.startsWith('/api/project-code/'))) {
      const importArchiveMatch = url.match(
        /^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/import-archive\/?$/,
      )
      if (importArchiveMatch) {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        const raw = await readBuffer(req, MAX_ARCHIVE_BYTES)
        const imported = await importTemplateArchiveForUser(
          session.userId,
          decodeURIComponent(importArchiveMatch[1]),
          decodeURIComponent(importArchiveMatch[2]),
          raw,
        )
        if (imported.error) {
          json(res, imported.status, { error: imported.error })
          return
        }
        json(res, 200, { ok: true, ...imported })
        return
      }
      const exportArchiveMatch = url.match(
        /^\/api\/projects\/([^/]+)\/templates\/([^/]+)\/export-archive\/?$/,
      )
      if (exportArchiveMatch) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        const exported = await exportTemplateArchiveForUser(
          session.userId,
          decodeURIComponent(exportArchiveMatch[1]),
          decodeURIComponent(exportArchiveMatch[2]),
        )
        if (exported.error) {
          json(res, exported.status, { error: exported.error })
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Length', String(exported.buffer.length))
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(exported.buffer)
        return
      }
      const mediaMatch = url.match(/^\/api\/projects\/([^/]+)\/media(?:\/(upload|file))?\/?$/)
      if (mediaMatch) {
        await handleProjectMedia(req, res, {
          userId: session.userId,
          projectCode: decodeURIComponent(mediaMatch[1]),
          action: mediaMatch[2] || '',
          json,
          readBuffer,
          headerStr,
          queryOf,
          maxBytes: MAX_UPLOAD_BYTES,
        })
        return
      }
      const ttsMatch = url.match(
        /^\/api\/projects\/([^/]+)\/tts(?:\/(generate|voices|voice|file))?(?:\/([^/]+))?\/?$/,
      )
      if (ttsMatch) {
        await handleProjectTts(req, res, {
          userId: session.userId,
          projectCode: decodeURIComponent(ttsMatch[1]),
          action: ttsMatch[2] || '',
          param: ttsMatch[3] ? decodeURIComponent(ttsMatch[3]) : '',
          json,
          readBuffer,
          maxBytes: MAX_JSON_BYTES,
        })
        return
      }
      let body
      if (req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH') {
        const raw = await readBuffer(req, MAX_JSON_BYTES)
        try {
          body = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          json(res, 400, { error: 'invalid json' })
          return
        }
      }
      if (await handleCabinetApi(req, res, url, session.userId, json, { body })) {
        return
      }
    }

    if (url === '/api/media/upload' || url === '/api/media/file') {
      json(res, 400, { error: 'Используйте /api/projects/:code/media' })
      return
    }
    if (url === '/api/tts/generate') {
      json(res, 400, { error: 'Используйте /api/projects/:code/tts/generate' })
      return
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error'
    const status = message === 'file too large' ? 413 : 500
    console.error('api error', req.method, url, err)
    if (!res.headersSent) json(res, status, { error: message })
    else res.destroy()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`promo-api listening on :${PORT}`)
  void ensureAllAmoWebhooks(amoRedirectUri()).catch((err) => {
    console.warn('amo webhook ensure all', err?.message || err)
  })
})
