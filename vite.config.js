import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Electron packaged apps are loaded through file://, so asset paths must be relative.
  base: './',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
})
