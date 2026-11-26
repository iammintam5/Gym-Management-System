/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, nodes, text } = require('./helpers/component-harness.cjs');
const file = 'src/features/payments/refund-payment-modal.tsx';
const preview = {
  subscriptionId: 'sub',
  planName: 'Gym',
  amount: 100,
  receiptCount: 2,
  futureBookingCount: 1,
  deadline: null,
  eligible: true,
  reasons: [],
};
const button = (tree, label) =>
  nodes(tree).find((n) => n.type === 'button' && text(n).includes(label));
const input = (tree, label) =>
  nodes(tree).find((n) => n.props?.['aria-label'] === label);
function setup(value = preview) {
  const writes = [];
  let closed = 0,
    completed = 0;
  const h = harness(file, async (path, options = {}) => {
    if (options.method === 'POST')
      return new Promise((resolve, reject) =>
        writes.push({ path, body: JSON.parse(options.body), resolve, reject }),
      );
    assert.equal(options.skipCache, true);
    return value;
  });
  const props = {
    paymentId: 'payment',
    memberName: 'Member',
    memberCode: 'MEM-QA',
    onClose: () => closed++,
    onRefunded: () => completed++,
  };
  const render = () => h.render('RefundPaymentModal', props);
  return {
    h,
    writes,
    render,
    closed: () => closed,
    completed: () => completed,
  };
}
async function ready(s) {
  s.render();
  await s.h.flush(0);
  return s.render();
}

test('ineligible package explains the reason and offers no refund action', async () => {
  const s = setup({
    ...preview,
    eligible: false,
    reasons: ['Gói đã được sử dụng.'],
  });
  const tree = await ready(s);
  assert.match(text(tree), /Gói đã được sử dụng/);
  assert.equal(button(tree, 'Xác nhận đã hoàn tiền'), undefined);
  assert.equal(s.writes.length, 0);
});

test('refund requires reason, transfer reference and external confirmation; double clicks submit once', async () => {
  const s = setup();
  let tree = await ready(s);
  assert.equal(button(tree, 'Xác nhận đã hoàn tiền').props.disabled, true);
  input(tree, 'Lý do hoàn tiền').props.onChange({
    target: { value: 'Khách đổi ý' },
  });
  input(tree, 'Phương thức trả tiền').props.onChange({
    target: { value: 'TRANSFER' },
  });
  tree = s.render();
  nodes(tree)
    .find((n) => n.type === 'input' && n.props.type === 'checkbox')
    .props.onChange({ target: { checked: true } });
  tree = s.render();
  assert.equal(button(tree, 'Xác nhận đã hoàn tiền').props.disabled, true);
  input(tree, 'Mã giao dịch chuyển khoản').props.onChange({
    target: { value: 'BANK-001' },
  });
  tree = s.render();
  const click = button(tree, 'Xác nhận đã hoàn tiền').props.onClick;
  click();
  click();
  tree = s.render();
  tree.props.onClose();
  assert.equal(s.closed(), 0);
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0].body, {
    reason: 'Khách đổi ý',
    method: 'TRANSFER',
    reference: 'BANK-001',
    expectedAmount: 100,
    confirmedExternal: true,
  });
  s.writes[0].resolve({});
  await s.h.flush(0);
  assert.equal(s.completed(), 1);
});

test('failed settlement keeps the modal open and requires a fresh eligibility check', async () => {
  const s = setup();
  let tree = await ready(s);
  input(tree, 'Lý do hoàn tiền').props.onChange({ target: { value: 'Test' } });
  nodes(tree)
    .find((n) => n.type === 'input' && n.props.type === 'checkbox')
    .props.onChange({ target: { checked: true } });
  tree = s.render();
  button(tree, 'Xác nhận đã hoàn tiền').props.onClick();
  s.writes[0].reject(Error('Gói vừa được sử dụng.'));
  await s.h.flush(0);
  tree = s.render();
  assert.match(text(tree), /Gói vừa được sử dụng/);
  assert.equal(s.completed(), 0);
  assert.equal(button(tree, 'Xác nhận đã hoàn tiền'), undefined);
  assert.ok(button(tree, 'Kiểm tra lại'));
});
