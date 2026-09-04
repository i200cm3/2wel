import http from 'node:http'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { guestBaseDomain } from './publicUrl.mjs'
import { loadEnv } from './env.js'
import { parseSanNames, guestSslRequestAuthorized } from './guestSsl.mjs'

loadEnv()

const PORT = Number(process.env.GUEST_SSL_PORT || 9299)
const DOMAIN = String(process.env.DOMAIN || '2wel.ru').trim().toLowerCase()
const EMAIL = String(process.env.LETSENCRYPT_EMAIL || '').trim()
const CERT_LIVE = `/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function allowedHost(host) {
  const value = String(host ?? '').trim().toLowerCase()
  const base = guestBaseDomain()
  if (!value) return ''
  if (value === DOMAIN || value === base) return value
  if (value.endsWith(`.${base}`) && !value.slice(0, -`.${base}`.length).includes('.')) {
    return value
  }
  return ''
}

function run(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timeout`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited ${code}`))
    })
  })
}

function currentSans() {
  if (!fs.existsSync(CERT_LIVE)) return []
  const out = spawnSync(
    'openssl',
    ['x509', '-noout', '-ext', 'subjectAltName', '-in', CERT_LIVE],
    { encoding: 'utf8' },
  )
  if (out.status !== 0) return []
  return parseSanNames(`${out.stdout || ''}\n${out.stderr || ''}`)
}

async function expandCert(host) {
  const names = new Set(currentSans())
  names.add(DOMAIN)
  names.add(host)
  if (!EMAIL) throw new Error('Задайте LETSENCRYPT_EMAIL в .env')
  const args = [
    'run',
    '--rm',
    '-v',
    'certbot-data:/etc/letsencrypt',
    '-v',
    'certbot-www:/var/www/certbot',
    'certbot/certbot:latest',
    'certonly',
    '--webroot',
    '--webroot-path=/var/www/certbot',
    '--cert-name',
    DOMAIN,
    '--expand',
    '--non-interactive',
    '--agree-tos',
    '--email',
    EMAIL,
    '--keep-until-expiring',
  ]
  for (const name of names) {
    args.push('-d', name)
  }
  await run('docker', args)
}

async function reloadNginx() {
  await run(
    'nsenter',
    ['-t', '1', '-m', '-u', '-i', '-n', '-p', '--', '/usr/sbin/nginx', '-s', 'reload'],
    { timeoutMs: 15_000 },
  )
}

const locks = new Map()

async function ensureHost(host) {
  const pending = locks.get(host)
  if (pending) return pending
  const job = (async () => {
    const sans = currentSans()
    if (sans.includes(host)) {
      return { ok: true, host, already: true }
    }
    await expandCert(host)
    try {
      await reloadNginx()
    } catch (err) {
      console.error('nginx reload failed', err)
      return { ok: true, host, issued: true, reload: false, warning: String(err.message || err) }
    }
    return { ok: true, host, issued: true, reload: true }
  })()
  locks.set(host, job)
  try {
    return await job
  } finally {
    locks.delete(host)
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (url.pathname === '/health') {
    json(res, 200, { ok: true, domain: DOMAIN, cert: fs.existsSync(CERT_LIVE) })
    return
  }
  if (url.pathname === '/ensure' && req.method === 'POST') {
    if (!guestSslRequestAuthorized(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      json(res, 400, { ok: false, error: 'invalid json' })
      return
    }
    const host = allowedHost(body.host)
    if (!host) {
      json(res, 400, { ok: false, error: 'Недопустимый хост' })
      return
    }
    try {
      json(res, 200, await ensureHost(host))
    } catch (err) {
      json(res, 500, { ok: false, host, error: err instanceof Error ? err.message : 'ssl failed' })
    }
    return
  }
  json(res, 404, { ok: false, error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`guest-ssl agent :${PORT} cert=${CERT_LIVE}`)
})
