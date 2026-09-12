import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default [
  ...next,
  ...nextTs,
  { ignores: ['.next/**', 'dist/**', 'next-env.d.ts'] },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@gym/database',
                '@gym/database/*',
                '**/packages/database/**',
                '@prisma/*',
              ],
              message: 'Use the REST API; database access belongs to apps/api.',
            },
          ],
        },
      ],
    },
  },
];
