import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    hmr: {
      host: '127.0.0.1',
    },
    proxy: {
      '/api': 'http://127.0.0.1:9000',
      '/trade': 'http://127.0.0.1:9000',
      '/ws': { target: 'ws://127.0.0.1:9000', ws: true },
      '/history': 'http://127.0.0.1:9000',
      '/quotes': 'http://127.0.0.1:9000',
      '/symbols': 'http://127.0.0.1:9000',
      '/config': 'http://127.0.0.1:9000',
      '/time': 'http://127.0.0.1:9000',
      '/search': 'http://127.0.0.1:9000',
      '/instruments': 'http://127.0.0.1:9000',
      '/tradovate-history': 'http://127.0.0.1:9000',
      '/tradovate-quotes': 'http://127.0.0.1:9000',
      '/tradovate-proxy': 'http://127.0.0.1:9000',
      '/pine': 'http://127.0.0.1:9000',
      '/indicators': 'http://127.0.0.1:9000',
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  }
})
