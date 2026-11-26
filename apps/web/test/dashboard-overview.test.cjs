/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, nodes, text } = require('./helpers/component-harness.cjs');
const page = 'src/app/dashboard/page.tsx';
const members = Array.from({ length: 6 }, (_, i) => ({
  id: 'member-' + i,
  memberCode: 'MEM-NEW' + i,
  fullName: 'New Member ' + i,
  isActive: true,
  createdAt: '2026-11-' + (26 - i) + 'T01:00:00Z',
  phone: null,
}));
const subscriptions = [
  {
    id: 'current',
    memberId: 'member-0',
    effectiveStatus: 'ACTIVE',
    endDate: '2026-12-26',
    plan: { name: 'Current Gym' },
  },
  {
    id: 'next',
    memberId: 'member-0',
    effectiveStatus: 'UPCOMING',
    endDate: '2027-03-26',
    plan: { name: 'Next Gym' },
  },
];
function apiFixture(calls, employees = []) {
  return async (url) => {
    calls.push(url);
    if (url === '/reports/dashboard-summary')
      return {
        financials: {
          totalRevenue: 0,
          cashAmount: 0,
          transferAmount: 0,
          cardAmount: 0,
        },
        members: {
          totalActiveMembers: 0,
          expiringWithin7DaysCount: 0,
          newMembersCount: 0,
        },
        operations: { classesConductedCount: 0, totalCheckinsToday: 0 },
      };
    if (url.startsWith('/reports/revenue')) return { items: [] };
    if (url === '/reports/class-utilization')
      return { items: [], averageUtilizationRate: 0 };
    if (url === '/reports/trainer-performance')
      return {
        items: [
          {
            trainerId: 'old',
            trainerName: 'Historical Instructor',
            completedSessionsCount: 1,
            totalTrainingHours: 1,
          },
        ],
      };
    if (url.startsWith('/employees?')) return { data: employees };
    if (url.startsWith('/members/directory?'))
      return { data: members, subscriptions };
    throw Error('Unexpected overview request ' + url);
  };
}
async function settle(h) {
  for (let i = 0; i < 3; i++) {
    h.render('default');
    await h.flush(0);
  }
  return h.render('default');
}
test('overview requests five latest member profiles, includes members without plans and never duplicates renewals', async () => {
  const calls = [],
    h = harness(page, apiFixture(calls));
  const tree = await settle(h);
  const request = calls.find((x) => x.startsWith('/members/directory?'));
  assert.ok(request);
  const query = new URL('http://test' + request).searchParams;
  assert.equal(query.get('limit'), '5');
  assert.equal(query.get('sortBy'), 'createdAt');
  assert.equal(query.get('sortOrder'), 'desc');
  assert.equal(query.get('includePhoto'), 'false');
  assert.equal(calls.length, 6);
  assert.ok(
    !calls.some(
      (x) => x.startsWith('/subscriptions') || x.startsWith('/checkins'),
    ),
  );
  const table = nodes(tree).find(
    (n) => n.type === 'table' && n.props['aria-label'] === 'Hội viên mới',
  );
  assert.ok(table);
  const content = text(table);
  assert.equal((content.match(/New Member 0/g) || []).length, 1);
  assert.match(content, /New Member 4/);
  assert.doesNotMatch(content, /New Member 5/);
  assert.match(content, /Current Gym/);
  assert.doesNotMatch(content, /Next Gym/);
  assert.match(content, /Chưa có gói/);
  assert.ok(
    nodes(tree).some(
      (n) =>
        n.type === 'a' &&
        n.props.href === '/dashboard/staff/members' &&
        text(n).includes('Xem tất cả'),
    ),
  );
  assert.equal(nodes(tree).filter((n) => n.type === 'input').length, 0);
  assert.doesNotMatch(text(tree), /Historical Instructor/);
});
test('overview redirects non-admin roles without loading administrative reports or member data', async () => {
  const calls = [],
    h = harness(page, apiFixture(calls), { roles: ['STAFF'] });
  await settle(h);
  assert.equal(calls.length, 0);
});
