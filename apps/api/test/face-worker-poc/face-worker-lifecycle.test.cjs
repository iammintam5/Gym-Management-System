'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const {
  FaceWorkerController,
  FaceWorkerError,
} = require('./face-worker-controller.cjs');

const SYNTHETIC_WORKER_PATH = path.join(__dirname, 'synthetic-busy-worker.cjs');

function createTrackedAbortController() {
  const controller = new globalThis.AbortController();
  const signal = controller.signal;
  const listeners = new Set();
  const rawAdd = signal.addEventListener.bind(signal);
  const rawRemove = signal.removeEventListener.bind(signal);

  signal.addEventListener = (type, fn, options) => {
    if (type === 'abort') {
      listeners.add(fn);
    }
    return rawAdd(type, fn, options);
  };

  signal.removeEventListener = (type, fn, options) => {
    if (type === 'abort') {
      listeners.delete(fn);
    }
    return rawRemove(type, fn, options);
  };

  return {
    controller,
    signal,
    abortListenerCount: () => listeners.size,
  };
}

async function waitForAtomicFlag(view, index, expected = 1, maxWaitMs = 3000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (Atomics.load(view, index) === expected) {
      return;
    }
    await delay(5);
  }
  throw new Error(`Timed out waiting for SharedArrayBuffer flag[${index}]`);
}

test('starts with one worker, enforces bounded queue overload, and recovers capacity cleanly', async (t) => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 2,
    defaultTimeoutMs: 5000,
  });
  t.after(() => pool.shutdown());

  const initialStats = pool.getStats();
  assert.equal(initialStats.workerGeneration, 1);
  assert.equal(initialStats.hasLiveWorker, true);
  assert.equal(initialStats.maxQueueSize, 2);

  // Fill active slot + 2 queue slots using fast tasks where task 1 takes 80ms
  const p1 = pool.submit({ action: 'echo', value: 't1', delayMs: 80 });
  const p2 = pool.submit({ action: 'echo', value: 't2', delayMs: 10 });
  const p3 = pool.submit({ action: 'echo', value: 't3', delayMs: 10 });

  assert.equal(pool.getStats().activeTaskCount, 1);
  assert.equal(pool.getStats().queuedCount, 2);

  // 4th concurrent waiter exceeds maxQueueSize=2 -> rejected immediately with OVERLOAD
  const trackedOverload = createTrackedAbortController();
  await assert.rejects(
    pool.submit(
      { action: 'echo', value: 'overflow' },
      { signal: trackedOverload.signal },
    ),
    (err) => err instanceof FaceWorkerError && err.code === 'OVERLOAD',
  );
  assert.equal(trackedOverload.abortListenerCount(), 0);
  assert.equal(pool.getStats().queuedCount, 2);

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.value, 't1');
  assert.equal(r2.value, 't2');
  assert.equal(r3.value, 't3');
  assert.equal(r1.threadId, r2.threadId);
  assert.equal(r2.threadId, r3.threadId);

  // Queue drained; subsequent task succeeds on the same single worker
  const r4 = await pool.submit({ action: 'echo', value: 't4', delayMs: 5 });
  assert.equal(r4.value, 't4');
  assert.equal(r4.threadId, r1.threadId);
  assert.equal(pool.getStats().restartCount, 0);
  assert.equal(pool.getStats().activeTimerCount, 0);
});

test('queued cancellation removes only the aborted waiter without affecting active or sibling tasks', async (t) => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 2,
    defaultTimeoutMs: 5000,
  });
  t.after(() => pool.shutdown());

  // Pre-aborted signal rejects immediately and attaches zero listeners
  const preAborted = createTrackedAbortController();
  preAborted.controller.abort();
  await assert.rejects(
    pool.submit(
      { action: 'echo', value: 'never' },
      { signal: preAborted.signal },
    ),
    { name: 'AbortError' },
  );
  assert.equal(preAborted.abortListenerCount(), 0);

  const activeKeep = createTrackedAbortController();
  const queuedCancel = createTrackedAbortController();
  const queuedKeep = createTrackedAbortController();

  const pActive = pool.submit(
    { action: 'echo', value: 'active-ok', delayMs: 90 },
    { signal: activeKeep.signal },
  );
  const pCancel = pool.submit(
    { action: 'echo', value: 'cancel-me', delayMs: 10 },
    { signal: queuedCancel.signal },
  );
  const pKeep = pool.submit(
    { action: 'echo', value: 'queued-ok', delayMs: 10 },
    { signal: queuedKeep.signal },
  );

  assert.equal(pool.getStats().queuedCount, 2);
  assert.equal(queuedCancel.abortListenerCount(), 1);

  // Abort only the middle queued waiter
  queuedCancel.controller.abort();
  await assert.rejects(pCancel, { name: 'AbortError' });
  assert.equal(queuedCancel.abortListenerCount(), 0);
  assert.equal(pool.getStats().queuedCount, 1);

  // Freed queue slot immediately accepts a replacement waiter while active task is still running
  const pReplacement = pool.submit({
    action: 'echo',
    value: 'replacement-ok',
    delayMs: 5,
  });
  assert.equal(pool.getStats().queuedCount, 2);

  const [resActive, resKeep, resReplacement] = await Promise.all([
    pActive,
    pKeep,
    pReplacement,
  ]);
  assert.equal(resActive.value, 'active-ok');
  assert.equal(resKeep.value, 'queued-ok');
  assert.equal(resReplacement.value, 'replacement-ok');
  assert.equal(resActive.threadId, resKeep.threadId);
  assert.equal(pool.getStats().workerGeneration, 1);
  assert.equal(pool.getStats().restartCount, 0);
  assert.equal(activeKeep.abortListenerCount(), 0);
  assert.equal(queuedKeep.abortListenerCount(), 0);
  assert.equal(pool.getStats().activeTimerCount, 0);
});

test('task deadline interrupts real synchronous CPU work via worker.terminate(), fences stale replies, and restarts worker for next request', async (t) => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 4,
    defaultTimeoutMs: 5000,
  });
  t.after(() => pool.shutdown());

  const firstEcho = await pool.submit({
    action: 'double_reply',
    value: 'fenced-ok',
    staleTaskId: 7777,
  });
  assert.equal(firstEcho.value, 'fenced-ok');
  const firstThreadId = firstEcho.threadId;
  await delay(15);
  // Both staleTaskId and trailing duplicate for settled taskId were ignored
  assert.ok(pool.getStats().ignoredLateMessages >= 2);

  const sab = new SharedArrayBuffer(8);
  const view = new Int32Array(sab);
  const trackedSpin = createTrackedAbortController();

  const spinPromise = pool.submit(
    { action: 'spin_sab', sab, spinMs: 15_000 },
    { timeoutMs: 90, signal: trackedSpin.signal },
  );
  // Queue next request behind the doomed spin task
  const nextPromise = pool.submit(
    { action: 'echo', value: 'served-after-timeout', delayMs: 5 },
    { timeoutMs: 5000 },
  );

  // Confirm worker actually entered synchronous CPU spin loop
  await waitForAtomicFlag(view, 1, 1);
  assert.ok(Atomics.load(view, 0) > 0);

  await assert.rejects(
    spinPromise,
    (err) => err instanceof FaceWorkerError && err.code === 'TIMEOUT',
  );
  assert.equal(trackedSpin.abortListenerCount(), 0);

  // Prove actual worker CPU execution halted (not merely Promise.race while spin continued)
  const counterAtReject = Atomics.load(view, 0);
  await delay(60);
  assert.equal(
    Atomics.load(view, 0),
    counterAtReject,
    'terminated worker must stop incrementing SharedArrayBuffer counter',
  );

  // Restarted worker automatically serves the queued next request
  const nextResult = await nextPromise;
  assert.equal(nextResult.value, 'served-after-timeout');
  assert.notEqual(nextResult.threadId, firstThreadId);

  // Queued timeout while waiting in queue rejects only that queued task without killing active worker
  const activeLong = pool.submit(
    { action: 'echo', value: 'still-fine', delayMs: 90 },
    { timeoutMs: 5000 },
  );
  const queuedShortTimeout = pool.submit(
    { action: 'echo', value: 'expires-in-queue', delayMs: 5 },
    { timeoutMs: 25 },
  );
  await assert.rejects(
    queuedShortTimeout,
    (err) => err instanceof FaceWorkerError && err.code === 'TIMEOUT',
  );
  const activeLongRes = await activeLong;
  assert.equal(activeLongRes.value, 'still-fine');
  assert.equal(activeLongRes.threadId, nextResult.threadId);

  const stats = pool.getStats();
  assert.equal(stats.workerGeneration, 2);
  assert.equal(stats.terminatedCount, 1);
  assert.equal(stats.restartCount, 1);
  assert.equal(stats.activeTimerCount, 0);
});

test('aborting an in-flight active task terminates the busy worker and serves remaining queued work on a fresh worker', async (t) => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 3,
    defaultTimeoutMs: 10_000,
  });
  t.after(() => pool.shutdown());

  const sab = new SharedArrayBuffer(8);
  const view = new Int32Array(sab);
  const activeAbort = createTrackedAbortController();

  const pSpin = pool.submit(
    { action: 'spin_sab', sab, spinMs: 15_000 },
    { signal: activeAbort.signal },
  );
  const pFollowUp = pool.submit({
    action: 'echo',
    value: 'after-active-abort',
    delayMs: 5,
  });

  await waitForAtomicFlag(view, 1, 1);
  activeAbort.controller.abort();

  await assert.rejects(pSpin, { name: 'AbortError' });
  const counterAfterAbort = Atomics.load(view, 0);
  await delay(50);
  assert.equal(Atomics.load(view, 0), counterAfterAbort);
  assert.equal(activeAbort.abortListenerCount(), 0);

  const followUp = await pFollowUp;
  assert.equal(followUp.value, 'after-active-abort');
  assert.equal(pool.getStats().workerGeneration, 2);
  assert.equal(pool.getStats().activeTimerCount, 0);
});

test('worker crash (uncaught error and unexpected exit) settles every waiter and restarts for subsequent work', async (t) => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 4,
    defaultTimeoutMs: 5000,
  });
  t.after(() => pool.shutdown());

  // Ensure initial worker is online
  const warm = await pool.submit({ action: 'echo', value: 'warm', delayMs: 2 });
  assert.equal(warm.value, 'warm');

  // 1. Uncaught exception crash settles active + all queued waiters
  const a1 = createTrackedAbortController();
  const a2 = createTrackedAbortController();
  const a3 = createTrackedAbortController();

  const crashActive = pool.submit(
    { action: 'crash_throw', message: 'boom-uncaught', delayMs: 15 },
    { signal: a1.signal },
  );
  const crashWaiter1 = pool.submit(
    { action: 'echo', value: 'w1' },
    { signal: a2.signal },
  );
  const crashWaiter2 = pool.submit(
    { action: 'echo', value: 'w2' },
    { signal: a3.signal },
  );

  for (const waiter of [crashActive, crashWaiter1, crashWaiter2]) {
    await assert.rejects(
      waiter,
      (err) => err instanceof FaceWorkerError && err.code === 'WORKER_CRASHED',
    );
  }
  assert.equal(a1.abortListenerCount(), 0);
  assert.equal(a2.abortListenerCount(), 0);
  assert.equal(a3.abortListenerCount(), 0);
  assert.equal(pool.getStats().activeTimerCount, 0);

  // Restarted worker serves subsequent request
  const recovered1 = await pool.submit({
    action: 'echo',
    value: 'recovered-1',
    delayMs: 5,
  });
  assert.equal(recovered1.value, 'recovered-1');
  assert.notEqual(recovered1.threadId, warm.threadId);

  // 2. Abrupt non-zero process.exit(2) settles active + queued waiters and recovers again
  const exitActive = pool.submit({
    action: 'crash_exit',
    exitCode: 2,
    delayMs: 15,
  });
  const exitWaiter = pool.submit({ action: 'echo', value: 'w-exit' });

  for (const waiter of [exitActive, exitWaiter]) {
    await assert.rejects(
      waiter,
      (err) => err instanceof FaceWorkerError && err.code === 'WORKER_CRASHED',
    );
  }
  assert.equal(pool.getStats().activeTimerCount, 0);

  const recovered2 = await pool.submit({
    action: 'echo',
    value: 'recovered-2',
    delayMs: 5,
  });
  assert.equal(recovered2.value, 'recovered-2');
  assert.notEqual(recovered2.threadId, recovered1.threadId);
  assert.equal(pool.getStats().workerGeneration, 3);
});

test('shutdown settles every active and queued waiter, terminates worker, and cleans up all timers and listeners', async () => {
  const pool = new FaceWorkerController({
    workerPath: SYNTHETIC_WORKER_PATH,
    maxQueueSize: 3,
    defaultTimeoutMs: 10_000,
  });

  const sab = new SharedArrayBuffer(8);
  const view = new Int32Array(sab);
  const t1 = createTrackedAbortController();
  const t2 = createTrackedAbortController();
  const t3 = createTrackedAbortController();

  const pActive = pool.submit(
    { action: 'spin_sab', sab, spinMs: 20_000 },
    { signal: t1.signal },
  );
  const pQueued1 = pool.submit(
    { action: 'echo', value: 'q1' },
    { signal: t2.signal },
  );
  const pQueued2 = pool.submit(
    { action: 'echo', value: 'q2' },
    { signal: t3.signal },
  );

  await waitForAtomicFlag(view, 1, 1);
  assert.equal(pool.getStats().activeTimerCount, 3);

  const waiterAssertions = Promise.all(
    [pActive, pQueued1, pQueued2].map((p) =>
      assert.rejects(
        p,
        (err) => err instanceof FaceWorkerError && err.code === 'SHUTDOWN',
      ),
    ),
  );

  await pool.shutdown();
  // Idempotent second shutdown call
  await pool.shutdown();
  await waiterAssertions;

  const countPostShutdown = Atomics.load(view, 0);
  await delay(40);
  assert.equal(Atomics.load(view, 0), countPostShutdown);

  assert.equal(t1.abortListenerCount(), 0);
  assert.equal(t2.abortListenerCount(), 0);
  assert.equal(t3.abortListenerCount(), 0);

  const finalStats = pool.getStats();
  assert.equal(finalStats.isShutdown, true);
  assert.equal(finalStats.hasLiveWorker, false);
  assert.equal(finalStats.activeTaskCount, 0);
  assert.equal(finalStats.queuedCount, 0);
  assert.equal(finalStats.activeTimerCount, 0);

  await assert.rejects(
    pool.submit({ action: 'echo', value: 'after-close' }),
    (err) => err instanceof FaceWorkerError && err.code === 'SHUTDOWN',
  );
  await assert.rejects(
    pool.analyzePhoto('data:image/jpeg;base64,QUFBQQ=='),
    (err) => err instanceof FaceWorkerError && err.code === 'SHUTDOWN',
  );
});
