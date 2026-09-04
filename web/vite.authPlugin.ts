import type { Plugin } from 'vite'
import { isProtectedApi, requestSessionToken, verifyToken } from '../api/auth.mjs'

function json(res: import('http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** Логин и /api/auth/me идут в Node API (прокси). Здесь только проверка токена для dev-плагинов. */
export function authPlugin(): Plugin {
  return {
    name: 'editor-auth',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const method = req.method ?? 'GET'

        if (!isProtectedApi(url, method)) {
          next()
          return
        }

        if (!verifyToken(requestSessionToken(req))) {
          json(res, 401, { error: 'unauthorized' })
          return
        }

        next()
      })
    },
  }
}
