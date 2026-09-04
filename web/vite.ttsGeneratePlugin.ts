import type { Plugin } from 'vite'

function json(res: import('http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const DIRECT_TTS_RE = /^\/media\/(?:tts\/|projects\/[^/]+\/tts)/

/**
 * TTS генерация идёт через API: POST /api/projects/:code/tts/generate
 * (vite проксирует /api на :3000). Старый общий /api/tts/generate закрыт.
 *
 * Прямой путь к файлам озвучки закрыт и в dev — как в nginx, чтобы сразу
 * ловить места, которые играют файл мимо защищённого потока.
 */
export function ttsGeneratePlugin(): Plugin {
  return {
    name: 'tts-generate',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        if (url === '/api/tts/generate') {
          json(res, 400, { error: 'Используйте /api/projects/:code/tts/generate' })
          return
        }
        if (DIRECT_TTS_RE.test(url)) {
          json(res, 404, { error: 'Озвучка отдаётся только через API' })
          return
        }
        next()
      })
    },
  }
}
