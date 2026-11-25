/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contracts = require('@gym/contracts');

function transpileAndRun(relativePath, bindings = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const mod = { exports };
  vm.runInNewContext(code, {
    exports,
    module: mod,
    Buffer,
    URL,
    URLSearchParams,
    Date,
    Math,
    Number,
    Promise,
    ...bindings,
    require(name) {
      if (name === '@gym/contracts') return contracts;
      if (bindings.__require) return bindings.__require(name);
      throw new Error(`Unexpected require in ${relativePath}: ${name}`);
    },
  });
  return mod.exports;
}

test('staff/pos/page.tsx displays standalone PT package name on payment rows without subscription link', async () => {
  const states = [];
  const effects = [];
  const el = (type, props) => ({ type, props });
  const iconProxy = new Proxy({}, { get: (_, prop) => String(prop) });

  const apiClientMock = async (url) => {
    if (url.startsWith('/payments?')) {
      return {
        data: [
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            subscriptionId: null,
            ptPurchaseId: 'pt-pur-1',
            memberId: 'mem-1',
            memberCode: 'MEM-00000001',
            memberFullName: 'Nguyen Van A',
            amount: 4000000,
            currency: 'VND',
            status: contracts.PaymentStatus.PAID,
            method: 'TRANSFER',
            note: null,
            confirmedBy: 'staff-1',
            confirmedByName: 'Cashier',
            confirmedAt: '2026-11-17T03:00:00.000Z',
            createdAt: '2026-11-17T03:00:00.000Z',
            ptPurchase: {
              id: 'pt-pur-1',
              packageCode: 'PT10',
              packageName: 'Gói PT 10 buổi (60 phút)',
              sessionCount: 10,
              sessionMinutes: 60,
            },
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };
    }
    if (url.startsWith('/members?')) {
      return {
        data: [],
        meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
      };
    }
    if (url.startsWith('/membership-plans?')) {
      return {
        data: [],
        meta: { page: 1, limit: 50, total: 0, totalPages: 1 },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  let receiptRequests = 0;
  apiClientMock.get = async (url) => {
    if (url.startsWith('/payments/')) receiptRequests += 1;
    return apiClientMock(url);
  };

  let cursor = 0;
  const scheduledFns = [];
  const posMod = transpileAndRun('src/app/dashboard/staff/pos/page.tsx', {
    window: {
      location: { search: '' },
      history: { replaceState: () => {} },
      setTimeout: (fn) => {
        scheduledFns.push(fn);
        return scheduledFns.length;
      },
      clearTimeout: () => {},
      print: () => {},
    },
    __require(name) {
      if (name === '@/features/pt-bookings/staff-pt-booking')
        return { StaffPtBookingButton: 'StaffPtBookingButton' };
      if (name === '@/features/pt-assignments/pt-assignment')
        return {
          MemberPtAssignments: 'MemberPtAssignments',
          SubscriptionPtAssignment: 'SubscriptionPtAssignment',
          TrainerAssignedMembers: 'TrainerAssignedMembers',
        };
      if (name.startsWith('@/features/pt-packages/'))
        return {
          PtPackageSaleButton: 'PtPackageSaleButton',
          PtPackageCatalog: 'PtPackageCatalog',
          MemberPtPackages: 'MemberPtPackages',
        };
      if (name === 'react') {
        return {
          useState: (init) => {
            const idx = cursor++;
            if (!(idx in states)) {
              states[idx] = typeof init === 'function' ? init() : init;
            }
            return [
              states[idx],
              (val) => {
                states[idx] =
                  typeof val === 'function' ? val(states[idx]) : val;
              },
            ];
          },
          useEffect: (fn) => {
            effects.push(fn);
          },
          useCallback: (fn) => fn,
          useRef: (v) => ({ current: v }),
        };
      }
      if (name === 'react/jsx-runtime') {
        return { jsx: el, jsxs: el, Fragment: 'Fragment' };
      }
      if (name === 'lucide-react') return iconProxy;
      if (name === '@/stores/auth-store') {
        return {
          useAuthStore: () => ({
            user: { id: 'admin-1', roles: [contracts.UserRole.ADMIN] },
          }),
        };
      }
      if (name === '@/features/members/member-quick-view') {
        return { MemberQuickView: 'MemberQuickView' };
      }
      if (name === '@/features/members/member-onboarding-modal') {
        return { MemberOnboardingModal: 'MemberOnboardingModal' };
      }
      if (name === '@/components/shared/domain-status-badge') {
        return { PaymentStatusBadge: 'PaymentStatusBadge' };
      }
      if (name === '@/components/shared/data-state') {
        return { DataState: 'DataState' };
      }
      if (name === '@/components/shared/table-pagination') {
        return { TablePagination: 'TablePagination' };
      }
      if (name === '@/components/ui/modal-frame') {
        return { ModalFrame: 'ModalFrame' };
      }
      if (name === '@/lib/staff-date') {
        return { staffDate: () => '2026-11-17' };
      }
      if (name === '@/lib/staff-request-key') {
        return { stableStaffRequestKey: () => 'req-key-1' };
      }
      if (name === '@/lib/formatters') {
        return {
          formatVnd: (n) => `${n}đ`,
          formatDurationVi: (d) => `${d} ngày`,
        };
      }
      if (name === '@/lib/utils') {
        return {
          formatReceiptNumber: () => 'REC-20261117-A1B2C3D4',
        };
      }
      if (name === '@/services/api-client') {
        return { apiClient: apiClientMock, ApiClientError: Error };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });

  posMod.default();
  for (const eff of effects) eff();
  for (const fn of scheduledFns) fn();
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  cursor = 0;
  const rendered = posMod.default();
  const texts = [];
  let saleButton = null;
  const walk = (node) => {
    if (node == null || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'PtPackageSaleButton') saleButton = node.props;
    if (typeof node === 'object' && node.props?.children !== undefined) {
      walk(node.props.children);
    }
  };
  walk(rendered);
  assert.ok(texts.join(' ').includes('Gói PT 10 buổi (60 phút)'));
  assert.equal(saleButton, null, 'Retired PT sales must not be offered');
  assert.equal(receiptRequests, 0);
});

test('admin/page.tsx offers only Gym and Class when editing Gym plans', async () => {
  const states = [];
  const effects = [];
  const sentRequests = [];
  const el = (type, props) => ({ type, props });
  const iconProxy = new Proxy({}, { get: (_, prop) => String(prop) });

  const apiClientMock = async (url, init) => {
    if (init?.method) {
      sentRequests.push({
        url,
        method: init.method,
        body: JSON.parse(init.body),
      });
      return {};
    }
    if (url.startsWith('/membership-plans?')) {
      return {
        data: [
          {
            id: 'plan-gym-1',
            name: 'AURA PRO',
            description: 'Gói tập Gym & Group Class',
            durationDays: 30,
            price: 690000,
            isActive: true,
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-17T00:00:00.000Z',
            entitlements: [
              {
                id: 'ent-gym',
                service: contracts.ServiceTypeCode.GYM_ACCESS,
                serviceName: 'Full Gym',
                limitType: 'UNLIMITED',
                limitValue: null,
              },
              {
                id: 'ent-cls',
                service: contracts.ServiceTypeCode.CLASS,
                serviceName: 'Group Class',
                limitType: 'COUNT',
                limitValue: 8,
              },
            ],
          },
        ],
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      };
    }
    if (url === '/membership-plans/service-types') {
      // Post-cutover: PT is omitted from Gym plan service-types
      return [
        {
          id: 'st-cls',
          code: contracts.ServiceTypeCode.CLASS,
          name: 'Group Class',
        },
        {
          id: 'st-gym',
          code: contracts.ServiceTypeCode.GYM_ACCESS,
          name: 'Full Gym',
        },
      ];
    }
    if (url.startsWith('/reports/revenue')) {
      return {
        from: '2026-10-17T00:00:00.000Z',
        to: '2026-11-17T00:00:00.000Z',
        groupBy: 'MONTH',
        totalRevenue: 0,
        totalPayments: 0,
        items: [],
        byPlan: [],
      };
    }
    if (url.startsWith('/subscriptions?')) {
      return {
        data: [],
        meta: { page: 1, limit: 50, total: 0, totalPages: 1 },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  let cursor = 0;
  let scheduledFn = null;
  const adminMod = transpileAndRun('src/app/dashboard/admin/page.tsx', {
    window: {
      setTimeout: (fn) => {
        scheduledFn = fn;
        return 1;
      },
      clearTimeout: () => {},
    },
    __require(name) {
      if (name === '@/features/pt-bookings/staff-pt-booking')
        return { StaffPtBookingButton: 'StaffPtBookingButton' };
      if (name === '@/features/pt-assignments/pt-assignment')
        return {
          MemberPtAssignments: 'MemberPtAssignments',
          SubscriptionPtAssignment: 'SubscriptionPtAssignment',
          TrainerAssignedMembers: 'TrainerAssignedMembers',
        };
      if (name.startsWith('@/features/pt-packages/'))
        return {
          PtPackageSaleButton: 'PtPackageSaleButton',
          PtPackageCatalog: 'PtPackageCatalog',
          MemberPtPackages: 'MemberPtPackages',
        };
      if (name === 'react') {
        return {
          useState: (init) => {
            const idx = cursor++;
            if (!(idx in states))
              states[idx] = typeof init === 'function' ? init() : init;
            return [
              states[idx],
              (val) => {
                states[idx] =
                  typeof val === 'function' ? val(states[idx]) : val;
              },
            ];
          },
          useEffect: (fn) => {
            effects.push(fn);
          },
          useCallback: (fn) => fn,
          useRef: (v) => ({ current: v }),
        };
      }
      if (name === 'react/jsx-runtime') {
        return { jsx: el, jsxs: el, Fragment: 'Fragment' };
      }
      if (name === 'lucide-react') return iconProxy;
      if (name === '@/lib/utils') {
        return { cn: (...parts) => parts.filter(Boolean).join(' ') };
      }
      if (name === '@/components/shared/data-state') {
        return {
          DataState: 'DataState',
          assertDataLoaded: (list) => {
            for (const item of list) {
              if (item.status === 'rejected') throw item.reason;
            }
          },
        };
      }
      if (name === '@/components/ui/modal-frame') {
        return { ModalFrame: ({ children }) => el('div', { children }) };
      }
      if (name === '@/services/api-client') {
        return { apiClient: apiClientMock };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });

  adminMod.default();
  for (const eff of effects) eff();
  scheduledFn();
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Render loaded cards and click "Sửa gói" on AURA PRO
  cursor = 0;
  const loadedTree = adminMod.default();
  const findButtons = (node, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach((n) => findButtons(n, out));
      return out;
    }
    if (node.type === 'button') out.push(node.props || {});
    if (node.props?.children !== undefined)
      findButtons(node.props.children, out);
    return out;
  };
  const nodeText = (n) => {
    if (n == null || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(nodeText).join(' ');
    if (typeof n === 'object' && n.props?.children !== undefined) {
      return nodeText(n.props.children);
    }
    return '';
  };
  const cardButtons = findButtons(loadedTree);
  const editBtn = cardButtons.find((b) =>
    nodeText(b.children).includes('Chỉnh sửa gói'),
  );
  assert.ok(editBtn && typeof editBtn.onClick === 'function');
  editBtn.onClick();

  // Render modal open state: bundled PT selector must NOT appear, and saving must send PT: NONE
  cursor = 0;
  const modalTree = adminMod.default();
  const modalTexts = [];
  const collectTexts = (node) => {
    if (node == null || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      modalTexts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(collectTexts);
      return;
    }
    if (typeof node === 'object' && node.props?.children !== undefined) {
      collectTexts(node.props.children);
    }
  };
  collectTexts(modalTree);
  assert.equal(
    modalTexts.join(' ').includes('Chế độ tập PT 1 kèm 1'),
    false,
    'Bundled PT selector must be hidden after cutover',
  );

  const modalButtons = findButtons(modalTree);
  const saveBtn = modalButtons.find((b) =>
    String(b.children || '').includes('Lưu thay đổi'),
  );
  assert.ok(saveBtn && typeof saveBtn.onClick === 'function');
  saveBtn.onClick();
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const entPut = sentRequests.find((r) => r.method === 'PUT');
  assert.ok(entPut);
  assert.deepEqual(entPut.body.entitlements, [
    { service: contracts.ServiceTypeCode.GYM_ACCESS, limitType: 'UNLIMITED' },
    {
      service: contracts.ServiceTypeCode.CLASS,
      limitType: 'COUNT',
      limitValue: 8,
    },
  ]);
});
