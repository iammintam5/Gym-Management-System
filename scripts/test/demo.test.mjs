import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { demoEnvironment, ensureBuild, ensurePortsFree } from '../run-demo.mjs';
function fixture() {
  return mkdtempSync(join(tmpdir(), 'aura-demo-'));
}
function remove(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('aura-demo-'));
  rmSync(root, { recursive: true, force: true });
}
test('demo loads root environment, respects explicit overrides and fixes production mode', () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, '.env'),
      'API_PORT=4141\nNODE_ENV=development\nJWT_ACCESS_SECRET=fixture-only\n',
    );
    const env = demoEnvironment(root, {});
    assert.equal(env.API_PORT, '4141');
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.API_INTERNAL_URL, 'http://127.0.0.1:4141/api');
    assert.equal(demoEnvironment(root, { API_PORT: '4142' }).API_PORT, '4142');
    assert.throws(
      () =>
        demoEnvironment(root, {
          API_INTERNAL_URL: 'http://127.0.0.1:4000/api',
        }),
      /API_INTERNAL_URL/,
    );
  } finally {
    remove(root);
  }
});
test('missing production artifacts fail before starting a server', () => {
  const root = fixture();
  try {
    assert.throws(() => ensureBuild(root), /build is missing/);
    mkdirSync(join(root, 'apps/api/dist'), { recursive: true });
    mkdirSync(join(root, 'apps/web/.next'), { recursive: true });
    writeFileSync(join(root, 'apps/api/dist/main.js'), '');
    writeFileSync(join(root, 'apps/web/.next/BUILD_ID'), 'fixture');
    assert.doesNotThrow(() => ensureBuild(root));
  } finally {
    remove(root);
  }
});
test('occupied ports are reported and the existing listener stays alive', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    await assert.rejects(ensurePortsFree([port]), /unavailable/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
async function freePorts() {
  const servers = [createServer(), createServer()];
  await Promise.all(
    servers.map(async (s) => {
      s.listen(0, '127.0.0.1');
      await once(s, 'listening');
    }),
  );
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
}
for (const mode of ['stop', 'startup-failure', 'runtime-failure'])
  test(
    'demo supervisor cleans up both owned services: ' + mode,
    { timeout: 25000 },
    async () => {
      const root = fixture(),
        [apiPort, webPort] = await freePorts();
      mkdirSync(join(root, 'apps/api'), { recursive: true });
      mkdirSync(join(root, 'apps/web'), { recursive: true });
      const api = join(root, 'api.mjs'),
        web = join(root, 'web.mjs'),
        wrapper = join(root, 'wrapper.mjs');
      writeFileSync(
        api,
        mode === 'startup-failure'
          ? 'process.exit(7);'
          : `import{createServer}from'node:http';createServer((q,s)=>{s.end('{"status":"ok"}');if(q.url==='/crash')setTimeout(()=>process.exit(7),20)}).listen(Number(process.env.API_PORT),'127.0.0.1');`,
      );
      writeFileSync(
        web,
        `import{createServer}from'node:http';createServer((q,s)=>s.end('demo')).listen(Number(process.argv.at(-1)),'127.0.0.1');`,
      );
      const moduleUrl = pathToFileURL(
        resolve(import.meta.dirname, '../run-demo.mjs'),
      ).href;
      writeFileSync(
        wrapper,
        `import{runServers}from${JSON.stringify(moduleUrl)};process.on('message',()=>process.emit('SIGINT'));try{await runServers({root:${JSON.stringify(root)},env:{...process.env,API_PORT:${JSON.stringify(String(apiPort))}},webPort:${webPort},apiEntry:${JSON.stringify(api)},webEntry:${JSON.stringify(web)}})}catch(e){console.error(e.message);process.exitCode=1}finally{process.disconnect()}`,
      );
      const child = spawn(process.execPath, [wrapper], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      const exit = once(child, 'exit');
      try {
        if (mode !== 'startup-failure') {
          const deadline = Date.now() + 10000;
          while (
            !output.includes('Aura Gym ready:') &&
            child.exitCode === null &&
            Date.now() < deadline
          )
            await new Promise((r) => setTimeout(r, 50));
          assert.match(output, /Aura Gym ready:/);
          assert.equal(
            (await fetch(`http://127.0.0.1:${webPort}/login`)).status,
            200,
          );
          if (mode === 'stop') child.send('stop');
          else await fetch(`http://127.0.0.1:${apiPort}/crash`);
        }
        const [code] = await exit;
        assert.equal(code, mode === 'stop' ? 0 : 1, output);
        await ensurePortsFree([apiPort, webPort]);
      } finally {
        if (child.exitCode === null) {
          if (child.connected) child.send('stop');
          await Promise.race([exit, new Promise((r) => setTimeout(r, 5000))]);
          if (child.exitCode === null) child.kill();
        }
        remove(root);
      }
    },
  );
