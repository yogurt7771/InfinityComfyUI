import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'test-results', 'output']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // These component modules intentionally export pure helpers that are shared with their focused tests.
    files: [
      'src/components/CanvasWorkspace.tsx',
      'src/components/ModalFrame.tsx',
      'src/components/ResourcePreviewModal.tsx',
      'src/components/WorkbenchPanels.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
