const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, 'local-postgres.cjs'),
  'utf8',
);

function loadResolver(result, accessSync = () => {}) {
  const checked = [];
  const context = vm.createContext({
    module: { exports: {} },
    require(name) {
      if (name === 'node:path') return path.posix;
      if (name === 'node:fs')
        return {
          constants: fs.constants,
          accessSync(filename, mode) {
            checked.push(filename);
            assert.equal(mode, fs.constants.X_OK);
            accessSync(filename);
          },
        };
      if (name === 'node:child_process')
        return {
          spawnSync(command, args) {
            assert.equal(command, 'pg_config');
            assert.deepEqual(Array.from(args), ['--bindir']);
            return result;
          },
        };
      return require(name);
    },
  });
  vm.runInContext(source, context);
  return { resolve: context.systemPostgresBin, checked };
}

test('Linux uses the installed PostgreSQL directory and checks every required executable', () => {
  const { resolve, checked } = loadResolver({
    status: 0,
    stdout: '/usr/lib/postgresql/16/bin\n',
  });
  assert.equal(resolve(), '/usr/lib/postgresql/16/bin');
  assert.deepEqual(
    checked,
    ['initdb', 'postgres', 'pg_ctl'].map(
      (name) => `/usr/lib/postgresql/16/bin/${name}`,
    ),
  );
});

test('Linux reports a missing or failed pg_config before creating a cluster', () => {
  for (const status of [1, null]) {
    const { resolve } = loadResolver({ status });
    assert.throws(resolve, /native PostgreSQL server binaries/);
  }
});

test('Linux rejects a relative binary directory', () => {
  const { resolve } = loadResolver({ status: 0, stdout: 'relative/bin\n' });
  assert.throws(resolve, /invalid PostgreSQL binary directory/);
});

test('Linux rejects missing or non-executable server binaries', () => {
  const { resolve } = loadResolver(
    { status: 0, stdout: '/usr/lib/postgresql/16/bin\n' },
    () => {
      throw new Error('server binary is unavailable');
    },
  );
  assert.throws(resolve, /server binary is unavailable/);
});
