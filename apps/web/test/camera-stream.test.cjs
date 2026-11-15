/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsUnderTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../src/lib/camera-stream.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: exportsUnderTest, setTimeout, clearTimeout, DOMException },
);
const { openCameraStream } = exportsUnderTest;
function fixture() {
  const video = new EventTarget();
  Object.assign(video, {
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    srcObject: null,
    play: () => new Promise(() => {}),
  });
  let stopped = 0;
  const stream = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  };
  return {
    video,
    stream,
    stopped: () => stopped,
    frame() {
      Object.assign(video, {
        readyState: 2,
        videoWidth: 640,
        videoHeight: 480,
      });
      video.dispatchEvent(new Event('loadeddata'));
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a real frame starts the camera even if play() never resolves', async () => {
  const f = fixture();
  const result = openCameraStream(
    f.video,
    { getUserMedia: async () => f.stream },
    { video: true },
    new AbortController().signal,
    1000,
  );
  await flush();
  f.frame();
  assert.equal(await result, f.stream);
  assert.equal(f.stopped(), 0);
});

test('device startup timeout releases a stream returned too late', async () => {
  const f = fixture();
  let resolve;
  const result = openCameraStream(
    f.video,
    {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
    { video: true },
    new AbortController().signal,
    10,
  );
  await assert.rejects(result, /Camera chưa trả về luồng hình/);
  resolve(f.stream);
  await flush();
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});

test('connected camera without frames times out and releases the device', async () => {
  const f = fixture();
  await assert.rejects(
    openCameraStream(
      f.video,
      { getUserMedia: async () => f.stream },
      { video: true },
      new AbortController().signal,
      10,
    ),
    /Đã kết nối camera nhưng chưa nhận được hình/,
  );
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});

test('unmount aborts startup and releases the connected stream', async () => {
  const f = fixture();
  const controller = new AbortController();
  const result = openCameraStream(
    f.video,
    { getUserMedia: async () => f.stream },
    { video: true },
    controller.signal,
    1000,
  );
  await flush();
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});

test('playback failure releases the stream and reports the failure', async () => {
  const f = fixture();
  f.video.play = async () => {
    throw new Error('playback denied');
  };
  await assert.rejects(
    openCameraStream(
      f.video,
      { getUserMedia: async () => f.stream },
      { video: true },
      new AbortController().signal,
      1000,
    ),
    /playback denied/,
  );
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});
