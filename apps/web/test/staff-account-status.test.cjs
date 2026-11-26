/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, nodes, text } = require('./helpers/component-harness.cjs');
const page = 'src/app/dashboard/trainer/page.tsx';
const employee = (id, role) => ({
  id,
  userId: 'user-' + id,
  employeeCode: 'EMP-' + id,
  fullName: 'QA ' + id,
  email: id + '@example.invalid',
  phone: null,
  hiredAt: '2026-01-01',
  roles: [role],
  isActive: true,
  specialties: ['Yoga'],
  specialization: 'Yoga',
  canTeachClasses: role === 'TRAINER',
  canCoachPt: false,
});
function setup() {
  const writes = [],
    toasts = [];
  const api = async (url, init) => {
    if (url.startsWith('/employees?'))
      return {
        data: [employee('trainer', 'TRAINER'), employee('staff', 'STAFF')],
      };
    if (url === '/reports/trainer-performance') return { items: [] };
    if (init?.method === 'PATCH')
      return new Promise((resolve, reject) =>
        writes.push({ url, body: JSON.parse(init.body), resolve, reject }),
      );
    throw Error('Unexpected request ' + url);
  };
  return {
    h: harness(page, api, { onToast: (...args) => toasts.push(args) }),
    writes,
    toasts,
  };
}
async function ready(h) {
  for (let i = 0; i < 3; i++) {
    h.render('default');
    await h.flush(0);
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
function dialog(tree) {
  const found = nodes(tree).find((n) => n.type === 'ConfirmDialog');
  assert.ok(found);
  return found.props;
}

test('locking requires a cancellable named dialog and synchronous duplicate-submit protection', async () => {
  const { h, writes } = setup();
  let tree = await ready(h);
  button(tree, 'Khóa').props.onClick();
  tree = h.render('default');
  assert.equal(writes.length, 0);
  assert.equal(dialog(tree).open, true);
  assert.match(dialog(tree).description, /QA trainer/);
  dialog(tree).onClose();
  tree = h.render('default');
  assert.equal(dialog(tree).open, false);
  assert.equal(writes.length, 0);
  button(tree, 'Khóa').props.onClick();
  tree = h.render('default');
  const confirm = dialog(tree).onConfirm;
  confirm();
  confirm();
  tree = h.render('default');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/users/user-trainer/status');
  assert.deepEqual(writes[0].body, { isActive: false });
  assert.equal(dialog(tree).isSubmitting, true);
  dialog(tree).onClose();
  assert.equal(dialog(h.render('default')).open, true);
  writes[0].resolve({});
  await h.flush(0);
  tree = h.render('default');
  assert.equal(dialog(tree).open, false);
  assert.ok(button(tree, 'Mở khóa'));
});

test('staff lock failure leaves the dialog retryable and unlock sends only one in-flight request', async () => {
  const { h, writes, toasts } = setup();
  let tree = await ready(h);
  button(tree, 'Lễ tân & Quản trị').props.onClick();
  tree = h.render('default');
  button(tree, 'Khóa').props.onClick();
  tree = h.render('default');
  dialog(tree).onConfirm();
  writes[0].reject(Error('Máy chủ tạm thời không phản hồi'));
  await h.flush(0);
  tree = h.render('default');
  assert.equal(dialog(tree).open, true);
  assert.equal(dialog(tree).isSubmitting, false);
  assert.equal(toasts.at(-1)[1], 'error');
  assert.ok(button(tree, 'Khóa'));
  dialog(tree).onConfirm();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].url, '/users/user-staff/status');
  writes[1].resolve({});
  await h.flush(0);
  tree = h.render('default');
  const unlock = button(tree, 'Mở khóa').props.onClick;
  unlock();
  unlock();
  tree = h.render('default');
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[2].body, { isActive: true });
  assert.equal(dialog(tree).open, false);
  writes[2].resolve({});
  await h.flush(0);
  tree = h.render('default');
  assert.ok(button(tree, 'Khóa'));
});
