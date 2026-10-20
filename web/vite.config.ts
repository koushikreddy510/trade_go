import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The Go engine (Atlas) is proxied on /api; the Python trading-service that powers the
// workspace (watchlists, screener, live candles, rules) is proxied on /terminal,
// including its websocket at /terminal/ws.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080',
      '/terminal': { target: 'http://127.0.0.1:8001', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/workspace/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
