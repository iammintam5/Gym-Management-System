import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const target = new URL('../.env', import.meta.url);
if (existsSync(target)) {
  console.log('.env already exists; kept unchanged.');
} else {
  const template = readFileSync(
    new URL('../.env.example', import.meta.url),
    'utf8',
  );
  writeFileSync(
    target,
    template
      .replace(
        'replace-with-at-least-32-random-characters',
        randomBytes(48).toString('hex'),
      )
      .replace(
        'replace-with-a-different-32-character-secret',
        randomBytes(48).toString('hex'),
      ),
  );
  console.log('Created root .env with random local JWT secrets.');
}
