/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function runtime(fetch) {
  let now = Date.now();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../src/services/api-client.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(
    code + '\nexports.cacheSize = () => getResponseCache.size;',
    {
      exports,
      Date: Clock,
      Headers,
      FormData,
      Response,
      fetch,
      require: (name) =>
        name.includes('auth-tokens')
          ? { getToken: async () => undefined }
          : { useAuthStore: { getState: () => ({ logout() {} }) } },
    },
  );
  return {
    ...exports,
    advance(ms) {
      now += ms;
    },
  };
}

test('member photos bypass the secondary cache; other entries are bounded and expired entries are removed', async () => {
  let requests = 0;
  const client = runtime(async () => {
    requests++;
    return Response.json({ value: requests });
  });
  await client.apiClient.get('/members/one');
  await client.apiClient.get('/members/one');
  assert.equal(requests, 2);
  assert.equal(client.cacheSize(), 0);
  for (let index = 0; index < 100; index++)
    await client.apiClient.get(`/other/${index}`);
  assert.equal(client.cacheSize(), 64);
  client.advance(21000);
  await client.apiClient.get('/other/new');
  assert.equal(client.cacheSize(), 1);
});

test('a request from before logout/cache clearing cannot refill the new session cache', async () => {
  let requests = 0;
  let resolveOld;
  const client = runtime(async () => {
    requests++;
    if (requests === 1)
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return Response.json({ value: 'new-session' });
  });
  const previous = client.apiClient.get('/other/profile');
  while (!resolveOld) await Promise.resolve();
  client.clearApiClientCache();
  const current = await client.apiClient.get('/other/profile');
  resolveOld(Response.json({ value: 'old-session' }));
  await previous;
  assert.equal(current.value, 'new-session');
  assert.equal(
    (await client.apiClient.get('/other/profile')).value,
    'new-session',
  );
  assert.equal(requests, 2);
});

test('API errors preserve structured duplicate-face details for forms', async () => {
  const conflicts = [
    { memberId: 'one', memberCode: 'MEM-ONE', fullName: 'One' },
  ];
  const client = runtime(async () =>
    Response.json(
      { code: 'DUPLICATE_MEMBER_FACE', message: 'Ảnh nghi trùng', conflicts },
      { status: 409 },
    ),
  );
  await assert.rejects(client.apiClient.post('/members', {}), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.details.code, 'DUPLICATE_MEMBER_FACE');
    assert.deepEqual(error.details.conflicts, conflicts);
    return true;
  });
});
