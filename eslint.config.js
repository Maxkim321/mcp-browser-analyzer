import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'chrome-extension/**', 'server/**'],
  },
]
