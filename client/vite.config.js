import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server')

// Local HTTPS (plans/06-local-https.md): reuse the server's mkcert cert/key from server/.env, one source of truth.
function tlsFromServerEnv(mode) {
  const env = loadEnv(mode, serverDir, '')
  const certFile = (env.TLS_CERT_FILE || '').trim()
  const keyFile = (env.TLS_KEY_FILE || '').trim()
  if (!certFile || !keyFile) return null
  const cert = path.resolve(serverDir, certFile)
  const key = path.resolve(serverDir, keyFile)
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    console.warn(`[vite] TLS_CERT_FILE/TLS_KEY_FILE set but not found (${cert}, ${key}). Serving over HTTP.`)
    return null
  }
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key), port: env.PORT || '5000' }
}

export default defineConfig(({ mode }) => {
  const tls = tlsFromServerEnv(mode)
  // The proxy runs in Node: it trusts the mkcert CA because "npm run dev" starts Vite with --use-system-ca.
  const target = tls ? `https://127.0.0.1:${tls.port}` : 'http://127.0.0.1:5000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      ...(tls && { https: { cert: tls.cert, key: tls.key } }),
      proxy: {
        '/api': target,
        '/media': target,
      },
    },
  }
})
