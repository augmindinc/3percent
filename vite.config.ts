import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/uapi': {
        target: 'https://openapi.koreainvestment.com:9443',
        changeOrigin: true,
      },
      '/oauth2': {
        target: 'https://openapi.koreainvestment.com:9443',
        changeOrigin: true,
      }
    }
  }
})
