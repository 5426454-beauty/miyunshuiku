import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/*.tif', '**/*.tiff', '**/淹没水深计算系统V2.0/**', '**/data/flood/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:  './index.html',
        admin: './admin/index.html',
      },
    },
  },
})
