import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  },
  test: {
    // Bound jsdom workers so local backend/browser QA cannot starve UI tests.
    maxWorkers: 2,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true
  }
})
