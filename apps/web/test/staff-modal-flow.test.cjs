/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function callback(name, bindings) {
  const filename = path.join(root, 'src/app/dashboard/staff/members/page.tsx');
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, name);
  const context = { ...bindings };
  const code = ts.transpileModule(
    'globalThis.run = ' + expression.getText(source),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  return context.run;
}

function loadComponent(relative, bindings) {
  const exports = {};
  const context = { exports, module: { exports }, ...bindings };
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, relative), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  return exports;
}

test('clean forms close immediately, changed forms ask before discarding, busy forms stay open', () => {
  let pending = null;
  let closed = 0;
  const close = callback('requestClose', {
    setDiscardAction: (factory) => {
      pending = factory();
    },
  });
  close(false, false, () => {
    closed += 1;
  });
  assert.equal(closed, 1);
  close(true, false, () => {
    closed += 1;
  });
  assert.equal(closed, 1);
  assert.equal(typeof pending, 'function');
  pending();
  assert.equal(closed, 2);
  pending = null;
  close(true, true, () => {
    closed += 1;
  });
  assert.equal(pending, null);
  assert.equal(closed, 2);
});

test('closing a changed renewal restores the originating profile only after discard confirmation', () => {
  let pending;
  let targetClosed = false;
  let restored = 0;
  const requestClose = callback('requestClose', {
    setDiscardAction: (factory) => {
      pending = factory();
    },
  });
  const close = callback('closeRenewModal', {
    renewBaseline: {
      current: { plan: 'plan', method: 'CASH', note: 'original' },
    },
    renewPlanId: 'plan',
    renewMethod: 'CASH',
    renewNote: 'changed',
    isSubmitting: false,
    requestClose,
    setRenewTarget: (value) => {
      targetClosed = value === null;
    },
    restoreProfile: () => {
      restored += 1;
    },
  });
  close();
  assert.equal(targetClosed, false);
  assert.equal(restored, 0);
  pending();
  assert.equal(targetClosed, true);
  assert.equal(restored, 1);
});

test('renewal success restores the profile, failure retains the form and entered draft', async () => {
  for (const fail of [false, true]) {
    let closed = false;
    let restored = 0;
    let busy;
    const bindings = {
      catalogLoading: false,
      catalogError: '',
      renewTarget: { memberId: 'member', subscriptionId: 'sub', name: 'QA' },
      PaymentStatus: { PAID: 'PAID' },
      isSubmitting: false,
      renewPlanId: 'plan',
      renewMethod: 'TRANSFER',
      renewNote: 'draft',
      renewalRequestKey: { current: 'key' },
      stableStaffRequestKey: () => 'key',
      setIsSubmitting: (value) => {
        busy = value;
      },
      apiClient: {
        post: async () => {
          if (fail) throw new Error('Network error');
        },
      },
      ApiClientError: class ApiClientError extends Error {},
      setFeedbackBanner: () => {},
      setRenewTarget: () => {
        closed = true;
      },
      loadMembersDirectory: async () => {},
      restoreProfile: () => {
        restored += 1;
      },
    };
    await callback(
      'handleRenewSubscription',
      bindings,
    )({ preventDefault() {} });
    assert.equal(closed, !fail);
    assert.equal(restored, fail ? 0 : 1);
    assert.equal(busy, false);
    assert.equal(bindings.renewalRequestKey.current, fail ? 'key' : null);
  }
});

test('nested modal scroll locking releases only after the last modal closes in either order', () => {
  const effects = [];
  const document = {
    activeElement: null,
    body: { style: { overflow: 'auto' } },
  };
  const jsx = (type, props) => ({ type, props });
  const { ModalFrame } = loadComponent('src/components/ui/modal-frame.tsx', {
    document,
    HTMLElement: class HTMLElement {},
    require: (name) => {
      if (name === 'react')
        return {
          useRef: () => ({ current: { showModal() {}, close() {} } }),
          useEffect: (effect) => effects.push(effect),
        };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@/lib/utils')
        return { cn: (...values) => values.join(' ') };
      throw new Error('Unexpected import ' + name);
    },
  });
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    ModalFrame({ onClose() {}, children: null });
    const first = effects.shift()();
    ModalFrame({ onClose() {}, children: null });
    const second = effects.shift()();
    const cleanups = [first, second];
    cleanups[order[0]]();
    assert.equal(document.body.style.overflow, 'hidden');
    cleanups[order[1]]();
    assert.equal(document.body.style.overflow, 'auto');
  }
});

test('busy form modal disables fields and ignores Escape-driven close requests', () => {
  let closeCount = 0;
  const jsx = (type, props) => ({ type, props });
  const { StaffFormModal } = loadComponent(
    'src/components/ui/staff-form-modal.tsx',
    {
      require: (name) => {
        if (name === 'react') return { useId: () => 'modal-title' };
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'lucide-react') return { X: 'icon' };
        if (name === '@/components/ui/modal-frame')
          return { ModalFrame: 'modal' };
        throw new Error('Unexpected import ' + name);
      },
    },
  );
  const tree = StaffFormModal({
    title: 'QA',
    subtitle: 'Member',
    busy: true,
    onClose: () => {
      closeCount += 1;
    },
    onSubmit() {},
    children: null,
    footer: null,
  });
  tree.props.onClose();
  assert.equal(closeCount, 0);
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children])
      visit(child);
  }
  visit(tree);
  assert.equal(
    nodes.find((node) => node.type === 'fieldset').props.disabled,
    true,
  );
  assert.equal(
    nodes.find((node) => node.type === 'form').props['aria-busy'],
    true,
  );
});
