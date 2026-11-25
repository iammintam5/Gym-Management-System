/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(
  __dirname,
  '../src/features/members/member-profile.tsx',
);
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const values = (names) => Object.fromEntries(names.map((name) => [name, name]));
const context = vm.createContext({
  exports: {},
  require(name) {
    if (name === 'react/jsx-runtime') {
      const element = (type, props) => ({ type, props });
      return { jsx: element, jsxs: element };
    }
    if (name === 'react') return { useState: (value) => [value, () => {}] };
    if (name === '@gym/contracts')
      return {
        PaymentStatus: values(['PENDING', 'PAID', 'REFUNDED', 'CANCELLED']),
        SubscriptionStatus: values([
          'ACTIVE',
          'UPCOMING',
          'SUSPENDED',
          'EXPIRED',
          'CANCELLED',
        ]),
        UserRole: values(['ADMIN', 'STAFF']),
      };
    if (name === '@/stores/auth-store')
      return {
        useAuthStore: (selector) => selector({ user: { roles: ['STAFF'] } }),
      };
    if (name === '@/lib/utils')
      return { cn: (...items) => items.filter(Boolean).join(' ') };
    if (name === '@/lib/formatters')
      return { formatVnd: (amount) => `${amount}đ` };
    return {};
  },
});
vm.runInContext(source, context);

function text(node) {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(text).filter(Boolean).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return text(node.props?.children);
}

function subscription(overrides = {}) {
  return {
    id: 'subscription',
    plan: { name: 'Test plan' },
    agreedPrice: 200,
    effectiveStatus: 'ACTIVE',
    paymentStatus: 'PENDING',
    startDate: '2026-11-01T00:00:00+07:00',
    endDate: '2026-12-01T00:00:00+07:00',
    createdAt: '2026-10-20T12:00:00+07:00',
    activatedAt: null,
    quotas: [],
    freezeCount: 0,
    payments: [],
    ...overrides,
  };
}

function render(sub, compact = false) {
  return text(context.SubscriptionRow({ sub, memberId: 'member', compact }));
}

test('registration details separate historical receipts and refunds while outstanding uses retained payments', () => {
  const result = render(
    subscription({
      payments: [
        { status: 'PAID', amount: 100 },
        { status: 'REFUNDED', amount: 40 },
        { status: 'PENDING', amount: 999 },
      ],
    }),
  );
  assert.ok(result.includes('Thông tin đăng ký'));
  assert.ok(result.includes('Đã thu 140đ'));
  assert.ok(result.includes('Đã hoàn 40đ'));
  assert.ok(result.includes('Còn phải thu 100đ'));
  assert.ok(!result.includes('Đã thu sau hoàn tiền'));
});

test('cancelled subscriptions preserve financial history and omit an active collection balance', () => {
  const result = render(
    subscription({
      effectiveStatus: 'CANCELLED',
      payments: [{ status: 'REFUNDED', amount: 200 }],
    }),
  );
  assert.ok(result.includes('Đã thu 200đ'));
  assert.ok(result.includes('Đã hoàn 200đ'));
  assert.ok(!result.includes('Còn phải thu'));
});

test('compact upcoming packages retain expiry and purchased entitlements', () => {
  const result = render(
    subscription({
      effectiveStatus: 'UPCOMING',
      quotas: [
        {
          id: 'quota',
          serviceName: 'Lớp nhóm',
          allocated: 8,
          used: 0,
          reserved: 0,
        },
      ],
    }),
    true,
  );
  assert.ok(result.includes('Hạn kết thúc 01/12/2026'));
  assert.ok(result.includes('Quyền lợi gói Lớp nhóm 8 buổi'));
});

test('normal packages avoid duplicate entitlement and zero refund blocks', () => {
  const result = render(
    subscription({
      paymentStatus: 'PAID',
      quotas: [
        {
          id: 'quota',
          serviceName: 'Lớp nhóm',
          allocated: 8,
          used: 2,
          reserved: 1,
        },
      ],
      payments: [{ status: 'PAID', amount: 200 }],
    }),
  );
  assert.ok(!result.includes('Đã hoàn'));
  assert.ok(!result.includes('Còn phải thu'));
  assert.ok(!result.includes('Quyền lợi gói'));
  assert.equal(result.split('Lớp nhóm').length - 1, 2);
});
