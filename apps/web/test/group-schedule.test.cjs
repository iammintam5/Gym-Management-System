/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, nodes, text } = require('./helpers/component-harness.cjs');
const file = 'src/app/dashboard/member/schedule/page.tsx';
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const schedule = {
  id: 'class-1',
  className: 'Yoga',
  trainerName: 'HLV An',
  startsAt: future(5),
  endsAt: future(6),
  status: 'SCHEDULED',
  remainingSlots: 10,
  capacity: 20,
};
test('member group schedule reserves once, refreshes and never calls PT endpoints', async () => {
  const calls = [];
  let booking = null;
  let release;
  const api = async (url) => {
    calls.push(url);
    if (url.startsWith('/class-schedules?')) return { data: [schedule] };
    if (url.startsWith('/class-bookings/my?'))
      return { data: booking ? [booking] : [] };
    if (url.includes('/quotas'))
      return [{ service: 'CLASS', allocated: 8, remaining: 7 }];
    throw Error('Unexpected request ' + url);
  };
  let posts = 0;
  api.post = async (url, body) => {
    posts++;
    assert.equal(url, '/class-bookings');
    assert.equal(body.scheduleId, schedule.id);
    await new Promise((resolve) => {
      release = resolve;
    });
    booking = {
      ...schedule,
      id: 'booking-1',
      scheduleId: schedule.id,
      status: 'BOOKED',
    };
  };
  const h = harness(file, api);
  h.render('default');
  await h.flush();
  let tree = h.render('default');
  assert.match(text(tree), /Yoga/);
  assert.match(text(tree), /HLV An/);
  const button = nodes(tree).find(
    (n) => n.type === 'button' && text(n) === 'Đăng ký',
  );
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  button.props.onClick();
  assert.equal(posts, 1);
  release();
  await h.flush();
  tree = h.render('default');
  assert.match(text(tree), /Đã đăng ký/);
  assert.match(text(tree), /Hủy chỗ/);
  assert.ok(!calls.some((url) => /pt-|trainers/.test(url)));
});
test('group schedule prevents booking without class quota and shows the cancellation cutoff', async () => {
  const api = async (url) =>
    url.startsWith('/class-schedules?')
      ? { data: [schedule] }
      : url.startsWith('/class-bookings/my?')
        ? {
            data: [
              {
                ...schedule,
                id: 'soon',
                scheduleId: 'other',
                startsAt: future(1),
                status: 'BOOKED',
              },
            ],
          }
        : [];
  const h = harness(file, api);
  h.render('default');
  await h.flush();
  const tree = h.render('default');
  for (const label of ['Đăng ký', 'Hủy chỗ'])
    assert.equal(
      nodes(tree).find((n) => n.type === 'button' && text(n) === label).props
        .disabled,
      true,
    );
  assert.match(text(tree), /ít nhất 2 tiếng/);
});
