const fs = require('node:fs');
const { setTimeout } = require('node:timers');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

/** Resolve native Linux binaries against the host's installed shared libraries. */
function systemPostgresBin() {
  const result = spawnSync('pg_config', ['--bindir'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0) {
    throw new Error(
      'Linux API tests require native PostgreSQL server binaries and pg_config on PATH',
    );
  }
  const directory = result.stdout.trim();
  if (!path.isAbsolute(directory))
    throw new Error(
      'pg_config returned an invalid PostgreSQL binary directory',
    );
  for (const executable of ['initdb', 'postgres', 'pg_ctl']) {
    fs.accessSync(path.join(directory, executable), fs.constants.X_OK);
  }
  return directory;
}

/** Never reads DATABASE_URL: always creates a fresh localhost-only cluster. */
async function localPostgres() {
  const resolver = createRequire(require.resolve('embedded-postgres'));
  let binaryDirectory;
  if (os.platform() === 'linux') {
    binaryDirectory = systemPostgresBin();
  } else {
    const binaries = await import(
      pathToFileURL(
        resolver.resolve(
          `@embedded-postgres/${os.platform() === 'win32' ? 'windows' : os.platform()}-${os.arch()}`,
        ),
      ).href
    );
    binaryDirectory = path.dirname(binaries.initdb);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-face-pg-'));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  // Windows PostgreSQL re-executes initdb through an ANSI path; the repository may contain Unicode.
  const native = path.join(directory, 'native');
  const sourceNative = path.resolve(binaryDirectory, '..');
  if (os.platform() === 'win32') {
    // Node's recursive copy crashes on some Windows/Unicode paths; use literal-path copy.
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Copy-Item -LiteralPath $env:AURA_TEST_PG_SOURCE -Destination $env:AURA_TEST_PG_NATIVE -Recurse',
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          AURA_TEST_PG_SOURCE: sourceNative,
          AURA_TEST_PG_NATIVE: native,
        },
      },
    );
    binaryDirectory = path.join(native, 'bin');
  } else if (os.platform() !== 'linux') {
    fs.cpSync(sourceNative, native, { recursive: true });
    binaryDirectory = path.join(native, 'bin');
  }
  const executable = (name) =>
    path.join(
      binaryDirectory,
      name + (os.platform() === 'win32' ? '.exe' : ''),
    );
  const dataDirectory = path.join(directory, 'data');
  const initialized = spawnSync(
    executable('initdb'),
    [
      '-D',
      dataDirectory,
      '-U',
      'postgres',
      '--auth=trust',
      '--locale=C',
      '-E',
      'UTF8',
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 60000 },
  );
  if (initialized.status !== 0)
    throw new Error(`Local initdb failed: ${initialized.stderr}`);
  const child = spawn(
    executable('postgres'),
    [
      '-D',
      dataDirectory,
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      ...(os.platform() === 'win32' ? [] : ['-k', directory]),
      '-c',
      'shared_buffers=16MB',
      '-c',
      'max_connections=25',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let errors = '';
  child.stderr.on('data', (data) => {
    errors = (errors + data).slice(-4000);
  });
  const { Client } = resolver('pg');
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  let connected;
  for (let attempt = 0; attempt < 100; attempt++) {
    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 500,
    });
    try {
      await client.connect();
      connected = client;
      break;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!connected) {
    child.kill();
    throw new Error(`Local postgres failed: ${errors}`);
  }
  const root = path.resolve(__dirname, '../../..');
  const migrations = path.join(root, 'packages/database/prisma/migrations');
  for (const name of fs.readdirSync(migrations).sort()) {
    const file = path.join(migrations, name, 'migration.sql');
    if (fs.existsSync(file))
      await connected.query(fs.readFileSync(file, 'utf8'));
  }
  await connected.end();
  return {
    url,
    async stop() {
      spawnSync(
        executable('pg_ctl'),
        ['-D', dataDirectory, 'stop', '-m', 'fast', '-w'],
        { windowsHide: true, timeout: 20000, stdio: 'ignore' },
      );
      // Only remove the exact generated temp cluster; never a configured database directory.
      const resolved = path.resolve(directory);
      if (
        !resolved.startsWith(path.join(os.tmpdir(), 'aura-face-pg-')) ||
        fs.lstatSync(resolved).isSymbolicLink()
      )
        throw new Error('Unexpected temp cluster directory');
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  };
}
module.exports = { localPostgres };
