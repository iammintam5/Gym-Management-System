'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { setTimeout, clearTimeout } = require('node:timers');

const DEFAULT_MAX_DATA_URL_LENGTH = 200_000;

class FaceWorkerError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'FaceWorkerError';
    this.code = code;
  }
}

function createAbortError(reason) {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  if (typeof globalThis.DOMException === 'function') {
    return new globalThis.DOMException(
      typeof reason === 'string' && reason.length > 0
        ? reason
        : 'The operation was aborted.',
      'AbortError',
    );
  }
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

class FaceWorkerController {
  constructor(options = {}) {
    this.workerPath =
      options.workerPath ?? path.join(__dirname, 'face-worker.cjs');
    this.workerData = options.workerData ?? {};
    this.maxQueueSize = options.maxQueueSize ?? 8;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.maxDataUrlLength =
      options.maxDataUrlLength ?? DEFAULT_MAX_DATA_URL_LENGTH;
    this.eagerStart = options.eagerStart ?? true;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0;
    this._idleTimer = null;
    if (!Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
      throw new RangeError('idleTimeoutMs must be finite and non-negative');
    }
    if (!Number.isFinite(this.defaultTimeoutMs) || this.defaultTimeoutMs <= 0) {
      throw new RangeError('defaultTimeoutMs must be positive and finite');
    }
    if (
      !Number.isInteger(this.maxDataUrlLength) ||
      this.maxDataUrlLength <= 0
    ) {
      throw new RangeError('maxDataUrlLength must be a positive integer');
    }

    if (!Number.isInteger(this.maxQueueSize) || this.maxQueueSize < 0) {
      throw new RangeError('maxQueueSize must be a non-negative integer');
    }

    this._nextGeneration = 0;
    this._nextTaskId = 0;
    this._currentWorker = null;
    this._activeTask = null;
    this._queue = [];
    this._activeTimers = new Set();
    this._pendingTerminations = new Set();
    this._restartingPromise = null;

    this._restartCount = 0;
    this._terminatedCount = 0;
    this._ignoredLateMessages = 0;

    this._shuttingDown = false;
    this._closed = false;
    this._shutdownPromise = null;

    if (this.eagerStart) {
      this._spawnWorker();
    }
  }

  getStats() {
    return {
      workerGeneration: this._currentWorker
        ? this._currentWorker.generation
        : 0,
      hasLiveWorker: Boolean(
        this._currentWorker && !this._currentWorker.terminating,
      ),
      activeTaskCount: this._activeTask ? 1 : 0,
      queuedCount: this._queue.length,
      maxQueueSize: this.maxQueueSize,
      restartCount: this._restartCount,
      terminatedCount: this._terminatedCount,
      ignoredLateMessages: this._ignoredLateMessages,
      activeTimerCount: this._activeTimers.size,
      isShutdown: this._shuttingDown || this._closed,
    };
  }

  warmup(options = {}) {
    return this.submit({ type: 'warmup' }, options);
  }

  analyzePhoto(photo, options = {}) {
    if (this._shuttingDown || this._closed) {
      return Promise.reject(
        new FaceWorkerError('SHUTDOWN', 'Face worker controller is shut down.'),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError(options.signal.reason));
    }
    if (typeof photo !== 'string' || photo.length === 0) {
      return Promise.reject(
        new FaceWorkerError(
          'INVALID_INPUT',
          'Photo input must be a non-empty data URL string.',
        ),
      );
    }
    if (photo.length > this.maxDataUrlLength) {
      return Promise.reject(
        new FaceWorkerError(
          'INVALID_INPUT',
          `Photo exceeds maximum data URL length (${this.maxDataUrlLength}).`,
        ),
      );
    }
    return this.submit(
      {
        type: 'analyze',
        photo,
        alreadyNormalized: Boolean(options.alreadyNormalized),
      },
      options,
    );
  }

  submit(payload, options = {}) {
    if (this._shuttingDown || this._closed) {
      return Promise.reject(
        new FaceWorkerError('SHUTDOWN', 'Face worker controller is shut down.'),
      );
    }
    const signal = options.signal;
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }

    const mustQueue =
      this._activeTask !== null || this._restartingPromise !== null;
    if (mustQueue && this._queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new FaceWorkerError(
          'OVERLOAD',
          `Face worker queue is full (maxQueueSize=${this.maxQueueSize}).`,
        ),
      );
    }

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(
        new RangeError('timeoutMs must be positive and finite'),
      );
    }

    return new Promise((resolve, reject) => {
      const task = {
        id: ++this._nextTaskId,
        payload,
        state: 'queued',
        assignedGeneration: null,
        timeoutHandle: null,
        signal,
        onAbort: null,
        resolve,
        reject,
      };

      if (
        typeof timeoutMs === 'number' &&
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0
      ) {
        const timer = setTimeout(() => {
          this._onTaskTimeout(task, timeoutMs);
        }, timeoutMs);
        this._activeTimers.add(timer);
        task.timeoutHandle = timer;
      }

      if (signal) {
        const onAbort = () => {
          this._onTaskAbort(task, signal.reason);
        };
        task.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._queue.push(task);
      this._pumpQueue();
    });
  }

  async shutdown() {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }
    this._shuttingDown = true;
    clearTimeout(this._idleTimer);
    this._idleTimer = null;

    this._shutdownPromise = (async () => {
      const shutdownError = new FaceWorkerError(
        'SHUTDOWN',
        'Face worker controller shut down.',
      );

      if (this._activeTask) {
        const active = this._activeTask;
        this._activeTask = null;
        this._settleTask(active, { ok: false, error: shutdownError });
      }

      const waiters = this._queue.splice(0);
      for (const waiter of waiters) {
        this._settleTask(waiter, { ok: false, error: shutdownError });
      }

      if (this._currentWorker) {
        const record = this._currentWorker;
        this._currentWorker = null;
        this._terminateWorkerRecord(record);
      }

      while (this._pendingTerminations.size > 0) {
        await Promise.allSettled([...this._pendingTerminations]);
      }

      this._closed = true;
    })();

    return this._shutdownPromise;
  }

  _cleanupTaskResources(task) {
    if (task.timeoutHandle !== null) {
      clearTimeout(task.timeoutHandle);
      this._activeTimers.delete(task.timeoutHandle);
      task.timeoutHandle = null;
    }
    if (task.signal && task.onAbort) {
      task.signal.removeEventListener('abort', task.onAbort);
      task.onAbort = null;
    }
  }

  _settleTask(task, outcome) {
    if (task.state === 'settled') {
      return false;
    }
    task.state = 'settled';
    this._cleanupTaskResources(task);
    if (outcome.ok) {
      task.resolve(outcome.value);
    } else {
      task.reject(outcome.error);
    }
    return true;
  }

  _onTaskTimeout(task, timeoutMs) {
    if (task.state === 'settled') {
      return;
    }
    const timeoutErr = new FaceWorkerError(
      'TIMEOUT',
      `Face worker task timed out after ${timeoutMs}ms.`,
    );
    if (task.state === 'queued') {
      const idx = this._queue.indexOf(task);
      if (idx !== -1) {
        this._queue.splice(idx, 1);
      }
      this._settleTask(task, { ok: false, error: timeoutErr });
      return;
    }
    this._interruptActiveTask(task, timeoutErr);
  }

  _onTaskAbort(task, reason) {
    if (task.state === 'settled') {
      return;
    }
    const abortErr = createAbortError(reason);
    if (task.state === 'queued') {
      const idx = this._queue.indexOf(task);
      if (idx !== -1) {
        this._queue.splice(idx, 1);
      }
      this._settleTask(task, { ok: false, error: abortErr });
      return;
    }
    this._interruptActiveTask(task, abortErr);
  }

  _interruptActiveTask(task, error) {
    task.state = 'settled';
    this._cleanupTaskResources(task);
    if (this._activeTask === task) {
      this._activeTask = null;
    }
    const killAndRestart = this._killAndRestartForGeneration(
      task.assignedGeneration,
    );
    void (async () => {
      try {
        await killAndRestart;
      } finally {
        task.reject(error);
      }
    })();
  }

  _killAndRestartForGeneration(generation) {
    const record =
      this._currentWorker && this._currentWorker.generation === generation
        ? this._currentWorker
        : null;

    if (!record) {
      return this._restartingPromise ?? Promise.resolve();
    }

    this._currentWorker = null;
    const termPromise = this._terminateWorkerRecord(record);

    const restartFlow = (async () => {
      await termPromise;
      if (!this._shuttingDown && !this._closed) {
        this._restartCount += 1;
        this._spawnWorker();
      }
    })();

    this._restartingPromise = restartFlow;
    void restartFlow.finally(() => {
      if (this._restartingPromise === restartFlow) {
        this._restartingPromise = null;
      }
      if (!this._shuttingDown && !this._closed) {
        this._pumpQueue();
      }
    });

    return restartFlow;
  }

  _terminateWorkerRecord(record) {
    if (!record.terminating) {
      record.terminating = true;
      this._terminatedCount += 1;
    }
    if (!record.terminatePromise) {
      const p = Promise.resolve()
        .then(() => record.worker.terminate())
        .catch(() => undefined)
        .finally(() => {
          record.detachListeners();
          this._pendingTerminations.delete(p);
        });
      record.terminatePromise = p;
      this._pendingTerminations.add(p);
    }
    return record.terminatePromise;
  }

  _spawnWorker() {
    if (this._shuttingDown || this._closed || this._currentWorker) {
      return this._currentWorker;
    }

    const generation = ++this._nextGeneration;
    const worker = new Worker(this.workerPath, {
      workerData: this.workerData,
    });

    let exitResolve;
    const exitPromise = new Promise((resolve) => {
      exitResolve = resolve;
    });
    this._pendingTerminations.add(exitPromise);

    const record = {
      generation,
      worker,
      everOnline: false,
      terminating: false,
      terminatePromise: null,
      detachListeners: () => {
        worker.removeListener('online', onOnline);
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      },
    };

    const onOnline = () => {
      record.everOnline = true;
    };

    const onMessage = (msg) => {
      if (
        record.terminating ||
        this._currentWorker !== record ||
        !this._activeTask ||
        this._activeTask.assignedGeneration !== record.generation ||
        this._activeTask.id !== msg?.taskId ||
        this._activeTask.state !== 'active'
      ) {
        this._ignoredLateMessages += 1;
        return;
      }

      const task = this._activeTask;
      this._activeTask = null;

      if (msg.ok) {
        this._settleTask(task, { ok: true, value: msg.result });
      } else {
        const code = msg.error?.code || 'WORKER_TASK_ERROR';
        const message = msg.error?.message || 'Worker failed to process task.';
        this._settleTask(task, {
          ok: false,
          error: new FaceWorkerError(code, message),
        });
      }

      this._pumpQueue();
    };

    const onError = (err) => {
      this._handleUnexpectedWorkerFailure(record, err);
    };

    const onExit = (exitCode) => {
      record.detachListeners();
      this._pendingTerminations.delete(exitPromise);
      exitResolve(exitCode);
      if (!record.terminating && this._currentWorker === record) {
        this._handleUnexpectedWorkerFailure(
          record,
          new Error(`Worker exited unexpectedly with code ${exitCode}.`),
        );
      }
    };

    worker.on('online', onOnline);
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);

    this._currentWorker = record;
    return record;
  }

  _handleUnexpectedWorkerFailure(record, cause) {
    if (record.terminating || this._currentWorker !== record) {
      return;
    }
    this._currentWorker = null;
    record.terminating = true;

    const crashError = new FaceWorkerError(
      'WORKER_CRASHED',
      cause?.message || 'Face worker crashed unexpectedly.',
      { cause },
    );

    if (this._activeTask) {
      const active = this._activeTask;
      this._activeTask = null;
      this._settleTask(active, { ok: false, error: crashError });
    }

    const waiters = this._queue.splice(0);
    for (const waiter of waiters) {
      this._settleTask(waiter, { ok: false, error: crashError });
    }

    const cleanupPromise = Promise.resolve()
      .then(() => record.worker.terminate())
      .catch(() => undefined);

    const restartFlow = (async () => {
      await cleanupPromise;
      if (!this._shuttingDown && !this._closed && record.everOnline) {
        this._restartCount += 1;
        this._spawnWorker();
      }
    })();

    this._restartingPromise = restartFlow;
    void restartFlow.finally(() => {
      if (this._restartingPromise === restartFlow) {
        this._restartingPromise = null;
      }
      if (!this._shuttingDown && !this._closed && this._queue.length > 0) {
        this._pumpQueue();
      }
    });
  }

  _pumpQueue() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    if (
      !this._shuttingDown &&
      !this._closed &&
      !this._activeTask &&
      !this._restartingPromise &&
      this._queue.length === 0 &&
      this._currentWorker &&
      this.idleTimeoutMs > 0
    ) {
      this._idleTimer = setTimeout(() => {
        this._idleTimer = null;
        const record = this._currentWorker;
        if (!record || this._activeTask || this._queue.length) return;
        this._currentWorker = null;
        const termination = this._terminateWorkerRecord(record);
        this._restartingPromise = termination;
        void termination.finally(() => {
          if (this._restartingPromise === termination)
            this._restartingPromise = null;
          this._pumpQueue();
        });
      }, this.idleTimeoutMs);
      this._idleTimer.unref?.();
    }
    if (
      this._shuttingDown ||
      this._closed ||
      this._activeTask !== null ||
      this._restartingPromise !== null ||
      this._queue.length === 0
    ) {
      return;
    }

    const record = this._currentWorker ?? this._spawnWorker();
    if (!record || record.terminating) {
      return;
    }

    const nextTask = this._queue.shift();
    if (!nextTask || nextTask.state !== 'queued') {
      return;
    }

    nextTask.state = 'active';
    nextTask.assignedGeneration = record.generation;
    this._activeTask = nextTask;

    try {
      record.worker.postMessage({
        taskId: nextTask.id,
        payload: nextTask.payload,
      });
    } catch (err) {
      this._activeTask = null;
      this._settleTask(nextTask, {
        ok: false,
        error: new FaceWorkerError(
          'WORKER_POST_FAILED',
          err?.message || 'Failed to dispatch task to worker.',
          { cause: err },
        ),
      });
      this._pumpQueue();
    }
  }
}

module.exports = {
  FaceWorkerController,
  FaceWorkerError,
  DEFAULT_MAX_DATA_URL_LENGTH,
};
