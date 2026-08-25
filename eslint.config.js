import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat config covering both workspaces. The two halves run in different
 * environments — Node on the server, the browser on the client — so globals and
 * plugins are scoped per directory rather than declared once and over-applied.
 */
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'docs/**', '**/.vite/**'] },

  js.configs.recommended,

  /* ------------------------------------------------------------- shared */
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // Unused args are usually a signature being honoured (Express needs the
      // 4-arg error handler), so allow a leading underscore to mark intent.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': ['error', { boolean: false }],
    },
  },

  /* ------------------------------------------------------------- server */
  {
    files: ['server/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // AGENTS.md: no console.logs in committed work. Boot and seed output is
      // deliberate operator feedback, exempted below.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['server/src/index.js', 'server/src/config/db.js', 'server/src/seed/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['server/test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // Operator tooling — the local MongoDB helper. Node globals, and its output
    // IS the interface, so console is the point rather than a leftover.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  /* ------------------------------------------------------------- client */
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Props are documented by the component's own JSDoc; prop-types would be
      // ceremony on top of that in a codebase this size.
      'react/prop-types': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  /* ------------------------------------------ config + tooling scripts */
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
