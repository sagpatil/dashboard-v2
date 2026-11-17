import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API server (server/) listens on 8787 by default; `npm run dev` starts both
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
