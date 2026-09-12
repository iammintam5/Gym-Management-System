import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [
  {
    ignores: [
      'dist/**',
      '.next/**',
      'src/generated/**',
      'node_modules/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: Object.fromEntries(
        [
          'process',
          'console',
          '__dirname',
          'Buffer',
          'URL',
          'require',
          'module',
          'exports',
          'fetch',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
