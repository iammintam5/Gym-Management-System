/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contracts = require('@gym/contracts');
const { randomUUID } = require('node:crypto');

function load(file, imports, testWindow) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    module: { exports },
    require: imports,
    AbortController,
    URLSearchParams,
    Error,
    Date,
    Intl,
    crypto: { randomUUID },
    window: testWindow,
  });
  return exports;
}

function harness(file, apiClient) {
  apiClient.get ??= apiClient;
  const states = [],
    refs = [],
    effectDeps = [],
    timers = new Map();
  let stateCursor = 0,
    refCursor = 0,
    effectCursor = 0,
    timerId = 0;
  const effects = [];
  const react = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn, deps) {
      const index = effectCursor++;
      if (
        !effectDeps[index] ||
        deps.some((value, key) => value !== effectDeps[index][key])
      ) {
        effectDeps[index] = deps;
        effects.push(fn);
      }
    },
  };
  const window = {
    setTimeout(fn) {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    confirm: () => true,
  };
  const requestKeys = load(
    'src/lib/staff-request-key.ts',
    () => {
      throw Error('Unexpected import');
    },
    window,
  );
  const loadedModule = load(
    file,
    (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime')
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
          Fragment: 'Fragment',
        };
      if (name === '@gym/contracts') return contracts;
      if (name === '@/stores/auth-store')
        return {
          useAuthStore: (selector) => selector({ user: { roles: ['ADMIN'] } }),
        };
      if (name === '@/services/api-client')
        return { apiClient, ApiClientError: Error };
      if (name === '@/features/pt-bookings/staff-pt-booking')
        return { StaffPtBookingButton: 'StaffPtBookingButton' };
      if (name === '@/lib/staff-date') return { staffDate: () => '2099-01-01' };
      if (name === '@/lib/staff-request-key') return requestKeys;
      if (name === '@/lib/formatters')
        return {
          formatVnd: (value) => value + 'đ',
          formatDurationVi: (days) => days + ' ngày',
        };
      if (name === '@/lib/utils') return { formatReceiptNumber: (id) => id };
      if (name === 'lucide-react')
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/components/ui/modal-frame')
        return { ModalFrame: 'ModalFrame' };
      if (name === '@/components/shared/domain-status-badge')
        return {
          FreezeStatusBadge: 'FreezeStatusBadge',
          PaymentStatusBadge: 'PaymentStatusBadge',
        };
      if (name === '@/components/shared/data-state')
        return {
          DataState: 'DataState',
          assertDataLoaded: (results) => {
            for (const result of results)
              if (result.status === 'rejected') throw result.reason;
          },
        };
      if (name === '@/components/ui/staff-form-modal')
        return { StaffFormModal: 'StaffFormModal' };
      if (name === '@/components/shared/table-pagination')
        return { TablePagination: 'TablePagination' };
      throw Error('Unexpected import ' + name);
    },
    window,
  );
  return {
    render(component, props) {
      stateCursor = refCursor = effectCursor = 0;
      return loadedModule[component](props);
    },
    async flush() {
      for (const effect of effects.splice(0)) effect();
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer();
      }
      for (let index = 0; index < 10; index++)
        await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.footer)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}

test('member PT history renders sold snapshot balance and routes pagination and receipts', async () => {
  const routes = [],
    receipts = [];
  const api = async (route, options) => {
    if (route.startsWith('/payments/me?') || route.includes('/pt-purchases?'))
      assert.equal(options.skipCache, true);
    routes.push(route);
    return {
      data: [
        {
          id: 'p1',
          packageNameSnapshot: 'PT đã mua',
          origin: 'STANDALONE',
          createdAt: '2026-11-17T00:00:00Z',
          agreedPrice: 2250000,
          effectiveStatus: 'ACTIVE',
          paymentStatus: 'PAID',
          remaining: 3,
          reserved: 1,
          used: 1,
          paymentId: 'receipt-1',
        },
      ],
      meta: { total: 6 },
    };
  };
  const view = harness('src/features/pt-packages/member-pt-packages.tsx', api);
  const props = { memberId: 'member-1', onReceipt: (id) => receipts.push(id) };
  view.render('MemberPtPackages', props);
  await view.flush();
  let tree = view.render('MemberPtPackages', props);
  assert.ok(text(tree).includes('PT đã mua'));
  assert.ok(text(tree).includes('Còn lại 3'));
  assert.ok(text(tree).includes('Đang giữ 1'));
  assert.ok(text(tree).includes('Đã dùng 1'));
  nodes(tree)
    .find(
      (node) => node.type === 'button' && text(node).includes('Xem biên lai'),
    )
    .props.onClick();
  assert.deepEqual(receipts, ['receipt-1']);
  nodes(tree)
    .find((node) => node.type === 'TablePagination')
    .props.onPageChange(2);
  tree = view.render('MemberPtPackages', props);
  await view.flush();
  assert.equal(routes[1], '/members/member-1/pt-purchases?limit=5&page=2');
});

test('member billing includes a standalone PT receipt even with no Gym subscriptions', async () => {
  const routes = [];
  const api = async (route) => {
    routes.push(route);
    if (route === '/subscriptions/me/current') return null;
    if (route === '/subscriptions/me') return [];
    if (route.startsWith('/payments/me?'))
      return {
        data: [
          {
            id: 'pt-receipt',
            createdAt: '2026-11-17T00:00:00Z',
            amount: 2250000,
            method: 'TRANSFER',
            status: 'PAID',
            ptPurchase: { packageName: 'PT 5 đã mua' },
          },
        ],
        meta: { total: 1 },
      };
    if (route === '/payments/pt-receipt/receipt')
      return {
        receiptNumber: 'REC-PT',
        amount: 2250000,
        method: 'TRANSFER',
        member: { fullName: 'Hội viên', memberCode: 'MEM-TEST' },
        cashier: { fullName: 'Lễ tân' },
        subscription: {
          planName: 'PT 5 đã mua',
          startDate: '1970-01-01',
          endDate: '1970-01-01',
        },
        ptPurchase: {
          packageName: 'PT 5 đã mua',
          sessionCount: 5,
          sessionMinutes: 60,
        },
      };
    throw Error('Unexpected request ' + route);
  };
  api.get = api;
  const view = harness('src/app/dashboard/member/billing/page.tsx', api);
  view.render('default', {});
  await view.flush();
  let tree = view.render('default', {});
  assert.ok(text(tree).includes('PT 5 đã mua'));
  assert.ok(routes.includes('/payments/me?limit=10&page=1'));
  nodes(tree)
    .find(
      (node) => node.type === 'button' && text(node).includes('Xem biên lai'),
    )
    .props.onClick();
  await view.flush();
  tree = view.render('default', {});
  assert.ok(text(tree).includes('Buổi PT'));
  assert.ok(text(tree).includes('5 buổi · 60 phút/buổi'));
  assert.ok(!text(tree).includes('1970'));
});
