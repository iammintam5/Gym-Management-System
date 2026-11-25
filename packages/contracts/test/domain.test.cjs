const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  effectiveSubscriptionStatus,
  SubscriptionStatus: S,
  remainingQuota,
  UserRole,
  ServiceTypeCode,
  TrainerServiceFilter,
  normalizeUserRole,
  normalizeVerifiedUserRoles,
  normalizePersistedUserRoles,
  defaultEmployeeCapabilitiesForRole,
  normalizeSpecialties,
  seedSpecialtiesFromSpecialization,
  formatSpecialtiesSummary,
  GYM_DOMAIN_RULES,
} = require('../dist');
test('expiry is derived only for active subscriptions and only after endDate', () => {
  const end = new Date('2026-09-20T00:00:00Z');
  assert.equal(effectiveSubscriptionStatus(S.ACTIVE, end, end), S.ACTIVE);
  assert.equal(
    effectiveSubscriptionStatus(S.ACTIVE, end, new Date(end.getTime() + 1)),
    S.EXPIRED,
  );
  for (const state of [S.UPCOMING, S.SUSPENDED, S.CANCELLED]) {
    assert.equal(
      effectiveSubscriptionStatus(state, end, new Date('2027-01-01')),
      state,
    );
  }
});
test('remaining quota accounts for reservations and supports unlimited access', () => {
  assert.equal(remainingQuota({ allocated: 10, reserved: 2, used: 5 }), 3);
  assert.equal(
    remainingQuota({ allocated: null, reserved: 2, used: 50 }),
    null,
  );
});

test('UserRole uses canonical TRAINER while preserving ServiceTypeCode.PT and normalizing legacy PT roles', () => {
  assert.deepEqual(Object.values(UserRole), [
    'MEMBER',
    'TRAINER',
    'STAFF',
    'ADMIN',
  ]);
  assert.equal(UserRole.PT, undefined);
  assert.equal(ServiceTypeCode.PT, 'PT');

  assert.equal(normalizeUserRole('PT'), UserRole.TRAINER);
  assert.equal(normalizeUserRole('TRAINER'), UserRole.TRAINER);
  assert.equal(normalizeUserRole('ADMIN'), UserRole.ADMIN);
  assert.equal(normalizeUserRole('pt'), null);
  assert.equal(normalizeUserRole('UNKNOWN'), null);

  assert.deepEqual(normalizeVerifiedUserRoles(['PT']), [UserRole.TRAINER]);
  assert.deepEqual(normalizeVerifiedUserRoles(['PT', 'TRAINER']), [
    UserRole.TRAINER,
  ]);
  assert.deepEqual(normalizeVerifiedUserRoles(['PT', 'STAFF']), [
    UserRole.TRAINER,
    UserRole.STAFF,
  ]);
  assert.equal(normalizeVerifiedUserRoles(['UNKNOWN']), null);
  assert.equal(normalizeVerifiedUserRoles(['PT', 'HACKER']), null);
  assert.equal(normalizeVerifiedUserRoles('PT'), null);

  assert.deepEqual(normalizePersistedUserRoles(['PT', 'UNKNOWN', 'STAFF']), [
    UserRole.TRAINER,
    UserRole.STAFF,
  ]);
  assert.deepEqual(normalizePersistedUserRoles(null), []);
});

test('Batch 2B employee capability defaults and specialty compatibility helpers', () => {
  assert.deepEqual(defaultEmployeeCapabilitiesForRole(UserRole.TRAINER), {
    canTeachClasses: true,
    canCoachPt: true,
  });
  for (const role of [UserRole.STAFF, UserRole.ADMIN, UserRole.MEMBER]) {
    assert.deepEqual(defaultEmployeeCapabilitiesForRole(role), {
      canTeachClasses: false,
      canCoachPt: false,
    });
  }
  assert.deepEqual(
    defaultEmployeeCapabilitiesForRole([UserRole.STAFF, UserRole.TRAINER]),
    { canTeachClasses: true, canCoachPt: true },
  );
  assert.deepEqual(defaultEmployeeCapabilitiesForRole([UserRole.STAFF]), {
    canTeachClasses: false,
    canCoachPt: false,
  });
  assert.deepEqual(defaultEmployeeCapabilitiesForRole([]), {
    canTeachClasses: false,
    canCoachPt: false,
  });

  assert.deepEqual(
    normalizeSpecialties([
      '  Boxing  ',
      'boxing',
      'Power   Yoga',
      '   ',
      'HIIT',
      'power yoga',
    ]),
    ['Boxing', 'Power Yoga', 'HIIT'],
  );
  assert.deepEqual(normalizeSpecialties(null), []);
  assert.deepEqual(normalizeSpecialties(undefined), []);

  assert.deepEqual(
    seedSpecialtiesFromSpecialization('  Boxing & Conditioning  '),
    ['Boxing & Conditioning'],
  );
  assert.deepEqual(
    seedSpecialtiesFromSpecialization('Yoga, Pilates & Mobility'),
    ['Yoga, Pilates & Mobility'],
  );
  assert.deepEqual(seedSpecialtiesFromSpecialization('   '), []);
  assert.deepEqual(seedSpecialtiesFromSpecialization(null), []);
  assert.deepEqual(seedSpecialtiesFromSpecialization(undefined), []);

  assert.equal(
    formatSpecialtiesSummary([' Boxing ', 'HIIT', 'boxing']),
    'Boxing, HIIT',
  );
  assert.equal(formatSpecialtiesSummary(['  ']), null);
  assert.equal(formatSpecialtiesSummary(null), null);

  assert.deepEqual(TrainerServiceFilter, {
    CLASS: 'CLASS',
    PT: 'PT',
  });
  assert.equal(GYM_DOMAIN_RULES.EMPLOYEE.MAX_SPECIALTIES, 12);
  assert.equal(GYM_DOMAIN_RULES.EMPLOYEE.SPECIALTY_MAX_LENGTH, 100);
  assert.equal(GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH, 255);
});

test('long specialty lists keep every item and produce a valid legacy summary', () => {
  const specialties = Array.from(
    { length: 12 },
    (_, index) => String(index).padStart(2, '0') + 'a'.repeat(98),
  );
  const summary = formatSpecialtiesSummary(specialties);
  assert.equal(
    Array.from(summary).length,
    GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH,
  );
  assert.ok(summary.endsWith('…'));
  assert.equal(normalizeSpecialties(specialties).length, 12);
  assert.equal(specialties[11].length, 100);
  const unicodeSummary = formatSpecialtiesSummary(
    Array.from({ length: 4 }, (_, index) => String(index) + '🏋'.repeat(99)),
  );
  assert.equal(
    Array.from(unicodeSummary).length,
    GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH,
  );
  assert.ok(!/[\uD800-\uDBFF]$/.test(unicodeSummary.slice(0, -1)));
});
