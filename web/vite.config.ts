import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { authPlugin } from './vite.authPlugin.ts'
import { ensureApiPlugin } from './vite.ensureApiPlugin.ts'
import { mediaLibraryPlugin } from './vite.mediaLibraryPlugin.ts'
import { ttsGeneratePlugin } from './vite.ttsGeneratePlugin.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ensureApiPlugin(),
    authPlugin(),
    ttsGeneratePlugin(),
    mediaLibraryPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  appType: 'spa',
  server: {
    host: true, // доступ с телефона в локальной сети
    port: 5173,
    proxy: {
      '^/[a-zA-Z0-9]{3,16}/preview\\.jpe?g$': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            const response = res as import('http').ServerResponse
            if (response.headersSent) return
            response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify({ error: 'Сервер входа недоступен. Запустите API на :3000.' }))
          })
        },
      },
      '/health': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
    watch: {
      ignored: ['**/public/media/projects/**'],
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
})
