import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { ChildProcess } from 'node:child_process'

const webDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(webDir, '..')
const apiDir = path.resolve(rootDir, 'api')
const API_PORT = 3000

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })
}

async function waitForPort(port: number, timeoutMs = 25000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

let apiChild: ChildProcess | null = null
let startedByPlugin = false
let ensuring: Promise<boolean> | null = null
let lastFailAt = 0
const FAIL_COOLDOWN_MS = 15_000

async function startApi(): Promise<boolean> {
  if (await isPortOpen(API_PORT)) return true
  if (Date.now() - lastFailAt < FAIL_COOLDOWN_MS) return false

  spawnSync('docker', ['compose', 'up', 'db', '-d'], {
    cwd: rootDir,
    stdio: 'ignore',
    timeout: 20_000,
  })

  console.warn(`[vite] API на :${API_PORT} не запущен — поднимаю (cd api && npm start)`)
  apiChild = spawn('npm', ['start'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
  startedByPlugin = true
  apiChild.on('exit', (code) => {
    apiChild = null
    if (code && code !== 0) lastFailAt = Date.now()
  })
  const ok = await waitForPort(API_PORT)
  if (!ok) lastFailAt = Date.now()
  return ok
}

async function ensureApi(): Promise<boolean> {
  if (await isPortOpen(API_PORT)) return true
  ensuring ??= startApi().finally(() => {
    ensuring = null
  })
  return ensuring
}

/** Держит локальный API на :3000, пока крутится Vite. */
export function ensureApiPlugin(): Plugin {
  return {
    name: 'ensure-local-api',
    apply: 'serve',
    configureServer(server) {
      void ensureApi()
      const timer = setInterval(() => {
        void ensureApi()
      }, 4000)

      server.httpServer?.once('close', () => {
        clearInterval(timer)
        if (startedByPlugin && apiChild && !apiChild.killed) {
          try {
            apiChild.kill('SIGTERM')
          } catch {
            /* ignore */
          }
        }
      })

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api') && !url.startsWith('/health')) {
          next()
          return
        }
        void ensureApi().then((ok) => {
          if (ok) {
            next()
            return
          }
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Сервер входа недоступен. Запустите API на :3000.' }))
        })
      })
    },
  }
}
