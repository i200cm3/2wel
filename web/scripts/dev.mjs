#!/usr/bin/env node
/**
 * Локальный dev: Postgres (docker) + API :3000 + Vite.
 * Один Ctrl+C гасит всё, что поднял этот скрипт.
 */
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rootDir = path.resolve(webDir, '..')
const apiDir = path.resolve(rootDir, 'api')
const API_PORT = 3000

const children = []

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })
}

async function waitForPort(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function run(command, args, cwd, { inherit = true } = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: inherit ? 'inherit' : 'ignore',
    env: process.env,
    shell: process.platform === 'win32',
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

spawnSync('docker', ['compose', 'up', 'db', '-d'], {
  cwd: rootDir,
  stdio: 'inherit',
  timeout: 60_000,
})

let apiAlreadyUp = await isPortOpen(API_PORT)
if (!apiAlreadyUp) {
  console.log('[dev] поднимаю API на :3000…')
  const api = run('npm', ['start'], apiDir)
  api.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0) {
      console.error(`[dev] API упал (code=${code}, signal=${signal})`)
      shutdown(1)
    }
  })
  if (!(await waitForPort(API_PORT))) {
    console.error('[dev] API не поднялся на :3000')
    shutdown(1)
  }
  console.log('[dev] API готов')
} else {
  console.log('[dev] API уже слушает :3000')
}

const vite = run('npx', ['vite'], webDir)
vite.on('exit', (code) => shutdown(code ?? 0))
