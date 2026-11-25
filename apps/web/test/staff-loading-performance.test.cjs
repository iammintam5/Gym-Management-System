/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, nodes, text } = require('./helpers/component-harness.cjs');
const pos = 'src/app/dashboard/staff/pos/page.tsx',
  directory = 'src/app/dashboard/staff/members/page.tsx';
const plan = {
  id: 'plan',
  name: 'Gym',
  price: 100000,
  durationDays: 30,
  isActive: true,
  entitlements: [],
};
const member = {
  id: 'member',
  memberCode: 'MEM-12345678',
  fullName: 'Test Member',
  phone: null,
  idPhotoUrl: null,
};
const receipt = (name) => ({
  id: 'receipt',
  memberId: 'member',
  memberCode: 'MEM-12345678',
  memberFullName: name,
  subscription: { planName: 'Gym' },
  amount: 100000,
  status: 'PAID',
  method: 'CASH',
  createdAt: '2026-11-25T01:00:00Z',
});
const payments = (name) => ({
  data: [receipt(name)],
  meta: { total: 21, totalPages: 3 },
});
async function settle(h, delay = 0) {
  for (let i = 0; i < 3; i++) {
    h.render('default');
    await h.flush(delay);
  }
  return h.render('default');
}
function button(tree, label) {
  const found = nodes(tree).find(
    (n) => n.type === 'button' && text(n).trim() === label,
  );
  assert.ok(found, 'Missing button ' + label);
  return found;
}
test('POS renders receipts without loading member options or waiting for catalog, then loads options on demand', async () => {
  const calls = [];
  let resolvePlans;
  const api = async (url) => {
    calls.push(url);
    if (url.startsWith('/payments?')) return payments('Receipt Member');
    if (url.startsWith('/membership-plans?'))
      return new Promise((r) => {
        resolvePlans = r;
      });
    if (url.startsWith('/members?')) return { data: [member] };
    throw Error('Unexpected ' + url);
  };
  const h = harness(pos, api);
  let tree = await settle(h);
  assert.match(text(tree), /Receipt Member/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('/payments?'));
  button(tree, 'Bán gói / Gia hạn').props.onClick();
  tree = await settle(h);
  assert.match(text(tree), /Receipt Member/);
  assert.match(text(tree), /Đang tải gói tập/);
  assert.equal(calls.filter((url) => url.startsWith('/members?')).length, 1);
  await h.flush(250);
  resolvePlans({ data: [plan] });
  await h.flush(0);
  tree = h.render('default');
  assert.equal(
    calls.filter((url) => url.startsWith('/membership-plans?')).length,
    1,
  );
  assert.equal(calls.filter((url) => url.startsWith('/members?')).length, 1);
  nodes(tree)
    .find((n) => n.type === 'button' && n.props['aria-label'] === 'Đóng')
    .props.onClick();
  tree = await settle(h);
  const filter = nodes(tree).find(
    (n) =>
      n.type === 'select' &&
      n.props['aria-label'] === 'Lọc theo trạng thái thanh toán',
  );
  filter.props.onChange({ target: { value: 'Paid' } });
  tree = await settle(h);
  assert.equal(calls.filter((url) => url.startsWith('/payments?')).length, 2);
  assert.equal(
    calls.filter((url) => url.startsWith('/membership-plans?')).length,
    1,
  );
  assert.equal(calls.filter((url) => url.startsWith('/members?')).length, 1);
});
test('POS applies initial member filter before its first request and debounces only typing', async () => {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    return payments('Scoped Member');
  };
  const h = harness(pos, api, { search: '?memberId=member&search=MEM-123' });
  let tree = await settle(h);
  assert.equal(calls.length, 1);
  const initial = new URL('http://test' + calls[0]);
  assert.equal(initial.searchParams.get('memberId'), 'member');
  assert.equal(initial.searchParams.get('search'), 'MEM-123');
  const search = nodes(tree).find(
    (n) =>
      n.type === 'input' &&
      n.props.placeholder?.includes('Tìm theo mã biên lai'),
  );
  search.props.onChange({ target: { value: 'new' } });
  await settle(h);
  assert.equal(calls.length, 1);
  tree = h.render('default');
  nodes(tree)
    .find(
      (n) =>
        n.type === 'input' &&
        n.props.placeholder?.includes('Tìm theo mã biên lai'),
    )
    .props.onChange({ target: { value: 'new query' } });
  await settle(h);
  await h.flush(250);
  await settle(h);
  assert.equal(calls.length, 2);
  assert.equal(
    new URL('http://test' + calls[1]).searchParams.get('search'),
    'new query',
  );
});
test('late payment responses cannot replace a newer filter result', async () => {
  let count = 0,
    finishOld;
  const api = async () => {
    count++;
    if (count === 2)
      return new Promise((r) => {
        finishOld = r;
      });
    return payments(count === 1 ? 'Initial Member' : 'Newest Member');
  };
  const h = harness(pos, api);
  let tree = await settle(h);
  const filter = () =>
    nodes(tree).find(
      (n) =>
        n.type === 'select' &&
        n.props['aria-label'] === 'Lọc theo trạng thái thanh toán',
    );
  filter().props.onChange({ target: { value: 'Paid' } });
  tree = await settle(h);
  filter().props.onChange({ target: { value: 'Refunded' } });
  tree = await settle(h);
  assert.match(text(tree), /Newest Member/);
  finishOld(payments('Stale Member'));
  await h.flush(0);
  tree = h.render('default');
  assert.doesNotMatch(text(tree), /Stale Member/);
});
test('staff directory requests summaries immediately and pagination does not load the catalog', async () => {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    if (url.startsWith('/members/directory?'))
      return {
        data: [member],
        subscriptions: [
          {
            id: 'sub',
            memberId: 'member',
            planId: 'plan',
            plan,
            startDate: '2026-01-01T00:00:00Z',
            endDate: '2099-01-01T00:00:00Z',
            effectiveStatus: 'ACTIVE',
            quotas: [
              {
                id: 'q',
                service: 'CLASS',
                serviceName: 'Class',
                allocated: 10,
                used: 2,
                reserved: 1,
              },
            ],
          },
        ],
        meta: { total: 21, totalPages: 3 },
      };
    throw Error('Unexpected ' + url);
  };
  const h = harness(directory, api);
  let tree = await settle(h);
  assert.match(text(tree), /Test Member/);
  assert.match(text(tree), /Class: 7\/10/);
  assert.equal(calls.length, 1);
  assert.equal(
    new URL('http://test' + calls[0]).searchParams.get('summary'),
    'true',
  );
  nodes(tree)
    .find((n) => n.type === 'TablePagination')
    .props.onPageChange(2);
  tree = await settle(h);
  assert.equal(calls.length, 2);
  assert.equal(new URL('http://test' + calls[1]).searchParams.get('page'), '2');
  assert.ok(calls.every((url) => url.startsWith('/members/directory?')));
});

test('POS member lookup ignores an aborted older search and waits only for typed queries', async () => {
  let finishOld;
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    if (url.startsWith('/payments?')) return payments('Receipt');
    if (url.startsWith('/membership-plans?')) return { data: [plan] };
    if (url.startsWith('/members?')) {
      if (new URL('http://test' + url).searchParams.get('search') === '')
        return new Promise((r) => {
          finishOld = r;
        });
      return { data: [{ ...member, fullName: 'New Search Member' }] };
    }
    throw Error(url);
  };
  const h = harness(pos, api);
  let tree = await settle(h);
  button(tree, 'Bán gói / Gia hạn').props.onClick();
  tree = await settle(h);
  assert.equal(calls.filter((url) => url.startsWith('/members?')).length, 1);
  const input = nodes(tree).find(
    (n) =>
      n.type === 'input' && n.props.placeholder?.includes('Tìm nhanh theo tên'),
  );
  input.props.onChange({ target: { value: 'new' } });
  tree = await settle(h);
  assert.equal(calls.filter((url) => url.startsWith('/members?')).length, 1);
  finishOld({ data: [{ ...member, fullName: 'Old Search Member' }] });
  await h.flush(0);
  tree = h.render('default');
  assert.doesNotMatch(text(tree), /Old Search Member/);
  await h.flush(250);
  tree = await settle(h);
  assert.match(text(tree), /New Search Member/);
  assert.doesNotMatch(text(tree), /Old Search Member/);
});
