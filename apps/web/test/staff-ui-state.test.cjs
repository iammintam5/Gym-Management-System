/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/lib', name), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.compileFunction(code, ['exports', 'require'])(exports, require);
  return exports;
}
test('staff date inputs follow Vietnam day boundaries', () => {
  const { staffDate } = load('staff-date.ts');
  const instant = Date.parse('2026-11-11T18:00:00Z');
  assert.equal(staffDate(0, instant), '2026-11-12');
  assert.equal(staffDate(1, instant), '2026-11-13');
});
test('one form preserves its request key across retries and changed input until reset', () => {
  const { stableStaffRequestKey } = load('staff-request-key.ts');
  const state = { current: null };
  const first = stableStaffRequestKey(state, { member: 'a' });
  assert.equal(stableStaffRequestKey(state, { member: 'a' }), first);
  assert.equal(stableStaffRequestKey(state, { member: 'b' }), first);
  state.current = null;
  assert.notEqual(stableStaffRequestKey(state, { member: 'a' }), first);
});
