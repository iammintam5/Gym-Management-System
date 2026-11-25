import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

export function demoEnvironment(root, inherited = process.env) {
  const file = join(root, '.env');
  const env = {
    ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}),
    ...inherited,
    NODE_ENV: 'production',
  };
  env.API_PORT ??= '4000';
  const port = Number(env.API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3000)
    throw Error('API_PORT must be a valid port different from web port 3000.');
  env.API_INTERNAL_URL ??= `http://127.0.0.1:${port}/api`;
  env.NEXT_PUBLIC_API_URL ??= env.API_INTERNAL_URL;
  const api = new URL(env.API_INTERNAL_URL);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(api.hostname) ||
    api.protocol !== 'http:' ||
    Number(api.port || 80) !== port ||
    api.pathname.replace(/\/$/, '') !== '/api'
  ) {
    throw Error(
      'API_INTERNAL_URL must point to the local API_PORT with path /api.',
    );
  }
  return env;
}

export async function ensurePortsFree(ports) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', (error) =>
        reject(
          Error(
            `Port ${port} is unavailable (${error.code}). Stop the existing dev/demo instance first.`,
          ),
        ),
      );
      server.listen({ port, host: '127.0.0.1' }, () => server.close(resolve));
    });
  }
}

export function ensureBuild(root) {
  for (const file of ['apps/api/dist/main.js', 'apps/web/.next/BUILD_ID']) {
    if (!existsSync(join(root, file)))
      throw Error(
        'Production build is missing. Run pnpm demo to build and start it.',
      );
  }
}

function exited(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const done = exited(child);
  if (process.platform === 'win32') {
    // Only a child launched by this supervisor is targeted; never stop unrelated listeners.
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    await exited(killer);
  } else {
    child.kill('SIGTERM');
  }
  let timer;
  await Promise.race([
    done,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 5000);
    }),
  ]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGKILL');
}

async function ready(url, signal) {
  const deadline = Date.now() + 60000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* The owned service may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error(
    signal.aborted
      ? 'Demo stopped.'
      : 'Demo startup timed out. Check the API/web output above.',
  );
}

export async function runServers({
  root,
  env,
  apiEntry,
  webEntry,
  webPort = 3000,
}) {
  const apiPort = Number(env.API_PORT);
  await ensurePortsFree([apiPort, webPort]);
  const children = [];
  const controller = new AbortController();
  let stopping = false;
  let shutdown;
  const close = () => {
    stopping = true;
    controller.abort();
    shutdown ??= Promise.all(children.map(stop));
    return shutdown;
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  try {
    const require = createRequire(join(root, 'apps/web/package.json'));
    children.push(
      spawn(
        process.execPath,
        [apiEntry ?? join(root, 'apps/api/dist/main.js')],
        {
          cwd: join(root, 'apps/api'),
          env,
          windowsHide: true,
          stdio: 'inherit',
        },
      ),
    );
    children.push(
      spawn(
        process.execPath,
        [
          webEntry ?? require.resolve('next/dist/bin/next'),
          'start',
          '--port',
          String(webPort),
        ],
        {
          cwd: join(root, 'apps/web'),
          env,
          windowsHide: true,
          stdio: 'inherit',
        },
      ),
    );
    const firstExit = Promise.race(children.map((child) => exited(child)));
    const earlyExit = firstExit.then((result) => {
      throw (
        result.error ??
        Error(
          `A demo service exited before startup (${result.code ?? result.signal}).`,
        )
      );
    });
    await Promise.race([
      Promise.all([
        ready(`http://127.0.0.1:${apiPort}/api/health`, controller.signal),
        ready(`http://127.0.0.1:${webPort}/login`, controller.signal),
      ]),
      earlyExit,
    ]);
    console.log(
      `Aura Gym ready: http://localhost:${webPort} (API ${apiPort}). Ctrl+C stops both services.`,
    );
    const result = await firstExit;
    if (!stopping)
      throw (
        result.error ??
        Error(
          `A demo service exited (${result.code ?? result.signal}); the other service has been stopped.`,
        )
      );
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    await close();
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  }
}

async function build(root, env) {
  const child =
    process.platform === 'win32'
      ? spawn(
          process.env.ComSpec ?? 'cmd.exe',
          ['/d', '/s', '/c', 'pnpm build'],
          { cwd: root, env, windowsHide: true, stdio: 'inherit' },
        )
      : spawn('pnpm', ['build'], { cwd: root, env, stdio: 'inherit' });
  const close = () => {
    void stop(child);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  try {
    const result = await exited(child);
    if (result.error || result.code !== 0)
      throw (
        result.error ??
        Error('Production build failed; no demo servers were started.')
      );
  } finally {
    await stop(child);
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--build'))
    throw Error(
      'Usage: pnpm demo (build + start), or pnpm demo:start (existing build).',
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const env = demoEnvironment(root);
  await ensurePortsFree([Number(env.API_PORT), 3000]);
  if (args.includes('--build')) await build(root, env);
  ensureBuild(root);
  await runServers({ root, env });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
