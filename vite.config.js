import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Electron packaged apps are loaded through file://, so asset paths must be relative.
  base: './',
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/naive-ui/es/locales') || id.includes('node_modules/date-fns')) return 'naive-locale'
          if (id.includes('node_modules/naive-ui/es/_')) return 'naive-core'
          if (id.includes('node_modules/naive-ui')) return 'naive-ui'
          if (id.includes('node_modules/')) return 'vendor'
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
})
