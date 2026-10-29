import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // A plugin runs in a studio's SharedWorker, which has fetch and WebSocket but
      // no window; tests and this file run under Node.
      globals: { ...globals.worker, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // Node, not a bundler, resolves what you publish, and Node refuses a relative
    // import without its extension: `from './events'` passes every test here and
    // throws ERR_MODULE_NOT_FOUND the moment a studio loads the package.
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$)/], ExportNamedDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$)/], ExportAllDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$)/]',
          message: 'A relative import needs its .js: Node resolves the published package, not a bundler.',
        },
      ],
    },
  },
]
