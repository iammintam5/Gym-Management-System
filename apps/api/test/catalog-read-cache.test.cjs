const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CatalogReadCache,
} = require('../dist/modules/membership-plans/catalog-read-cache');
test('catalog reuses reads, expires them and isolates caller mutations', async () => {
  let now = 0,
    calls = 0;
  const cache = new CatalogReadCache(100, 2, () => now);
  const load = async () => {
    calls++;
    return { plans: [{ price: 100 }] };
  };
  const first = await cache.get('plans', load);
  first.plans[0].price = 999;
  assert.equal((await cache.get('plans', load)).plans[0].price, 100);
  assert.equal(calls, 1);
  now = 101;
  await cache.get('plans', load);
  assert.equal(calls, 2);
});
test('catalog coalesces concurrent reads and does not cache failed loads', async () => {
  const cache = new CatalogReadCache();
  let resolve,
    calls = 0;
  const load = () => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const a = cache.get('x', load),
    b = cache.get('x', load);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ id: 1 });
  assert.deepEqual(await a, await b);
  await assert.rejects(
    cache.get('bad', async () => {
      throw Error('db unavailable');
    }),
    /db unavailable/,
  );
  assert.equal(await cache.get('bad', async () => 2), 2);
});
test('an invalidated in-flight read cannot refill or remove a newer cached read', async () => {
  const cache = new CatalogReadCache();
  let finish;
  const old = cache.get(
    'x',
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await Promise.resolve();
  cache.invalidate();
  assert.equal(await cache.get('x', async () => 20), 20);
  finish(10);
  assert.equal(await old, 10);
  assert.equal(await cache.get('x', async () => 30), 20);
});
test('catalog evicts old keys when its capacity is reached', async () => {
  const cache = new CatalogReadCache(1000, 2);
  await cache.get('a', async () => 1);
  await cache.get('b', async () => 2);
  await cache.get('c', async () => 3);
  let calls = 0;
  assert.equal(
    await cache.get('a', async () => {
      calls++;
      return 4;
    }),
    4,
  );
  assert.equal(calls, 1);
});
