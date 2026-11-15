const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { localPostgres } = require('./local-postgres.cjs');

(async () => {
  const cluster = await localPostgres();
  try {
    if (new URL(cluster.url).hostname !== '127.0.0.1')
      throw new Error('Regression database must be localhost');
    const root = path.resolve(__dirname, '../../..');
    const env = {
      ...process.env,
      DATABASE_URL: cluster.url,
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
    };
    const run = (args) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          cwd: root,
          env,
          windowsHide: true,
          stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Local regression process exited ${code}`)),
        );
      });
    await run([
      'packages/database/node_modules/tsx/dist/cli.mjs',
      'packages/database/prisma/seed.ts',
    ]);
    await run([
      '--test',
      '--test-concurrency=1',
      ...fs
        .readdirSync(__dirname)
        .filter((filename) => filename.endsWith('.test.cjs'))
        .sort()
        .map((filename) => path.join(__dirname, filename)),
    ]);
  } finally {
    await cluster.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
