/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
const jpeg = require('jpeg-js');
const webRoot = path.resolve(__dirname, '..');

const matchModule = { exports: {} };
const matchSource = ts.transpileModule(
  fs.readFileSync(
    path.join(webRoot, 'src/features/checkins/face-match.ts'),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
vm.runInNewContext(matchSource, {
  exports: matchModule.exports,
  Float32Array,
  Number,
});
const { selectFaceMatch } = matchModule.exports;

test('reject unknown, ambiguous and incompatible face descriptors', () => {
  const reference = new Float32Array(128);
  const known = { member: 'known', descriptor: reference };
  assert.equal(selectFaceMatch(reference, [known]).member, 'known');
  assert.equal(selectFaceMatch(new Float32Array(128).fill(1), [known]), null);
  assert.equal(
    selectFaceMatch(reference, [
      known,
      { member: 'other', descriptor: reference },
    ]),
    null,
  );
  assert.equal(selectFaceMatch(new Float32Array(1664), [known]), null);
  assert.equal(selectFaceMatch(new Float32Array(128).fill(NaN), [known]), null);
});

test(
  'local browser models produce identity descriptors from a real sample photograph',
  { timeout: 180000 },
  async (t) => {
    const context = {
      TextEncoder,
      TextDecoder,
      console,
      setTimeout,
      clearTimeout,
      fetch,
      performance,
    };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(
      fs.readFileSync(
        path.join(
          webRoot,
          'node_modules/@vladmandic/face-api/dist/face-api.js',
        ),
        'utf8',
      ),
      context,
    );
    const faceapi = context.faceapi;
    faceapi.tf.setPlatform('test', {
      fetch,
      now: () => performance.now(),
      encode: (text) => new TextEncoder().encode(text),
      decode: (bytes) => new TextDecoder().decode(bytes),
      isTypedArray: ArrayBuffer.isView,
    });
    // This test supplies tensors, so no DOM media or canvas implementation is used.
    faceapi.env.setEnv({
      fetch,
      Canvas: class {},
      Image: class {},
      Video: class {},
    });
    await faceapi.tf.setBackend('cpu');
    await faceapi.tf.ready();
    const modelRoot = path.join(webRoot, 'public/models/face-api');
    const server = http.createServer((request, response) => {
      const filename = path.basename(request.url);
      const filepath = path.join(modelRoot, filename);
      if (!fs.existsSync(filepath)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        'Content-Type',
        filename.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
      );
      fs.createReadStream(filepath).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const uri = `http://127.0.0.1:${server.address().port}`;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(uri),
      faceapi.nets.faceLandmark68Net.loadFromUri(uri),
      faceapi.nets.faceRecognitionNet.loadFromUri(uri),
    ]);
    const image = jpeg.decode(
      fs.readFileSync(
        path.join(
          webRoot,
          'node_modules/@vladmandic/face-api/demo/sample1.jpg',
        ),
      ),
      { useTArray: true },
    );
    const RuntimeArray = vm.runInContext('Float32Array', context);
    const pixels = new RuntimeArray(image.width * image.height * 3);
    for (let index = 0; index < image.width * image.height; index++) {
      for (let channel = 0; channel < 3; channel++)
        pixels[index * 3 + channel] = image.data[index * 4 + channel];
    }
    const input = faceapi.tf.tensor3d(pixels, [image.height, image.width, 3]);
    t.after(() => {
      input.dispose();
      faceapi.nets.tinyFaceDetector.dispose();
      faceapi.nets.faceLandmark68Net.dispose();
      faceapi.nets.faceRecognitionNet.dispose();
    });
    const faces = await faceapi
      .detectAllFaces(
        input,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5,
        }),
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
    assert.ok(
      faces.length > 0,
      'must detect a face in the upstream sample photograph',
    );
    for (const face of faces) {
      assert.equal(face.descriptor.length, 128);
      assert.ok(face.descriptor.every(Number.isFinite));
    }
    // Execute the production helper too: reuse existing detections and reject multiple faces.
    const runtimeExports = {};
    const runtimeSource = ts.transpileModule(
      fs.readFileSync(
        path.join(webRoot, 'src/lib/trained-face-recognition.ts'),
        'utf8',
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(runtimeSource, {
      exports: runtimeExports,
      require: () => faceapi,
      setTimeout: (...args) => {
        const timer = setTimeout(...args);
        timer.unref();
        return timer;
      },
      clearTimeout,
    });
    const release = runtimeExports.retainFaceRecognizer();
    try {
      const box = faces[0].detection.box;
      const x = Math.max(0, Math.floor(box.x - box.width * 0.2));
      const y = Math.max(0, Math.floor(box.y - box.height * 0.3));
      const width = Math.min(image.width - x, Math.floor(box.width * 1.4));
      const height = Math.min(image.height - y, Math.floor(box.height * 1.6));
      const portrait = faceapi.tf.tidy(() =>
        faceapi.tf.image.resizeBilinear(
          input.slice([y, x, 0], [height, width, 3]),
          [480, 360],
        ),
      );
      try {
        const face = await runtimeExports.describeFace(portrait);
        assert.equal(face.faceCount, 1);
        assert.equal(face.descriptor.length, 128);
        const before = faceapi.tf.memory().numTensors;
        await runtimeExports.describeFace(portrait);
        assert.equal(
          faceapi.tf.memory().numTensors,
          before,
          'repeated production inference must not retain extra tensors',
        );
        const aborted = new AbortController();
        aborted.abort();
        await assert.rejects(
          runtimeExports.describeFace(portrait, aborted.signal),
        );
        assert.equal(faceapi.tf.memory().numTensors, before);
      } finally {
        portrait.dispose();
      }
    } finally {
      release();
    }
    const candidates = faces.map((face, member) => ({
      member,
      descriptor: face.descriptor,
    }));
    assert.equal(selectFaceMatch(faces[0].descriptor, candidates).member, 0);
    // A slight lighting change should retain the same identity without weakening the cutoff.
    const dimmed = input.mul(0.9);
    try {
      const changed = await faceapi
        .detectAllFaces(
          dimmed,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 416,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptors();
      assert.ok(
        changed.some(
          (face) => selectFaceMatch(face.descriptor, candidates)?.member === 0,
        ),
      );
    } finally {
      dimmed.dispose();
    }
  },
);
