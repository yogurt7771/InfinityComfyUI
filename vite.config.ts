import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Electron renderer bundle. Vite's server is used only by the local desktop development launcher.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'app-dist',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
    globals: false,
  },
})
