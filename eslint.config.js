// Flat-config ESLint setup. Type-aware rules off by default — they require a
// project pointer to tsconfig and slow lint by ~3x. Add a typed-config slice
// later if any rule actually needs it.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      'pnpm-lock.yaml',
      // Tailwind brings its own preflight; lint our source only.
      'src/renderer/public/**',
      // Node CJS scripts run by package.json hooks — different module/global
      // shape from the TS sources; not worth the lint coverage.
      'scripts/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Catches the bug where a const, type, or function is left in the file
      // after a refactor — the kind of dead code the cleanup pass had to find
      // by hand.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      // Allow `any` — third-party SDK shapes (web search hits, image data
      // URLs) routinely arrive untyped. We can tighten later.
      '@typescript-eslint/no-explicit-any': 'off',
      // electron-vite SSR build sometimes needs `require()` for native deps.
      // Per-call eslint-disable is heavier than blanket-allowing this rule.
      '@typescript-eslint/no-require-imports': 'off',
      // The new react-hooks v7 rules are stricter than v6 and flag pre-existing
      // patterns (Date.now() during render, setState-in-effect for debounce
      // helpers). Keep them visible as warnings rather than CI-breaking errors
      // — fix incrementally.
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn'
    }
  },
  prettier
)
