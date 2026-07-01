import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single-binary contract: build output goes into the Go embed package, and the dev
// server proxies /api to the Go backend on :8080 (see DESIGN.md §2).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../internal/assets/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
