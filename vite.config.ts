import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Browser-direct only: Vite serves Infinity itself and never registers a ComfyUI proxy route.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'app-dist',
  },
  server: {
    port: 7930,
    allowedHosts: ['.localhost'],
  },
  preview: {
    port: 7930,
    allowedHosts: ['.localhost'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
    globals: false,
  },
})
