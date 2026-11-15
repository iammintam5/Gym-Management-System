'use strict';

const { parentPort, threadId } = require('node:worker_threads');
const { setTimeout } = require('node:timers');
const { performance } = require('node:perf_hooks');

if (!parentPort) {
  throw new Error('synthetic-busy-worker.cjs must run inside worker_threads');
}

parentPort.on('message', (msg) => {
  const { taskId, payload } = msg;
  const action = payload?.action ?? 'echo';

  if (action === 'echo') {
    const delayMs = payload?.delayMs ?? 5;
    setTimeout(() => {
      parentPort.postMessage({
        taskId,
        ok: true,
        result: {
          value: payload?.value ?? 'ok',
          threadId,
        },
      });
    }, delayMs);
    return;
  }

  if (action === 'double_reply') {
    // Sends a stale/duplicate message first or second to verify parent generation/task fencing.
    parentPort.postMessage({
      taskId: payload?.staleTaskId ?? 999_999,
      ok: true,
      result: { stale: true },
    });
    parentPort.postMessage({
      taskId,
      ok: true,
      result: { value: payload?.value ?? 'real', threadId },
    });
    parentPort.postMessage({
      taskId,
      ok: true,
      result: { duplicate: true },
    });
    return;
  }

  if (action === 'spin_sab') {
    // True synchronous CPU-blocking loop incrementing an atomic counter in SharedArrayBuffer.
    // Proves worker.terminate() genuinely halts V8 execution rather than leaving background work running.
    const view = payload?.sab ? new Int32Array(payload.sab) : null;
    const spinMs = payload?.spinMs ?? 10_000;
    const start = performance.now();
    if (view) {
      Atomics.store(view, 1, 1); // Flag that worker entered synchronous CPU loop
    }
    while (performance.now() - start < spinMs) {
      if (view) {
        Atomics.add(view, 0, 1);
      }
    }
    parentPort.postMessage({
      taskId,
      ok: true,
      result: { completedSpin: true, threadId },
    });
    return;
  }

  if (action === 'hold') {
    // Never settles on its own; used for deterministic queue-fill and cancellation tests.
    if (payload?.sab) {
      const view = new Int32Array(payload.sab);
      Atomics.store(view, 0, 1);
    }
    return;
  }

  if (action === 'crash_throw') {
    setTimeout(() => {
      throw new Error(payload?.message ?? 'Synthetic uncaught worker error');
    }, payload?.delayMs ?? 5);
    return;
  }

  if (action === 'crash_exit') {
    setTimeout(() => {
      process.exit(payload?.exitCode ?? 2);
    }, payload?.delayMs ?? 5);
    return;
  }

  parentPort.postMessage({
    taskId,
    ok: false,
    error: {
      code: 'UNKNOWN_ACTION',
      message: `Unsupported synthetic action: ${String(action)}`,
    },
  });
});
