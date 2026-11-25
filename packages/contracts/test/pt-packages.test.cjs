const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PT_PACKAGE_PLANS,
  PT_PACKAGE_SAMPLE_CODES,
  GYM_DOMAIN_RULES,
  PtPurchaseOrigin,
  PtPurchaseStatus,
  PaymentStatus,
  SubscriptionStatus,
  FreezeStatus,
  ServiceTypeCode,
  buildOrphanPtReservedReconcileKey,
  isStandalonePtPurchaseOpen,
  deriveStandalonePtPurchaseStatus,
  classifyLegacyPtQuotaAtCutover,
  effectivePtPurchaseStatus,
  evaluateGymCoverageForSlot,
  selectPtCreditSourceForSlot,
  filterUnmirroredSubscriptionQuotas,
  summarizeSpendablePtCredits,
} = require('../dist');

test('Default standalone PT catalog specs and domain rules match approved sample plans', () => {
  assert.deepEqual(PT_PACKAGE_SAMPLE_CODES, ['PT1', 'PT5', 'PT10', 'PT20']);
  assert.deepEqual(
    DEFAULT_PT_PACKAGE_PLANS.map((plan) => ({
      code: plan.code,
      sessionCount: plan.sessionCount,
      sessionMinutes: plan.sessionMinutes,
      price: plan.price,
    })),
    [
      { code: 'PT1', sessionCount: 1, sessionMinutes: 60, price: 500_000 },
      { code: 'PT5', sessionCount: 5, sessionMinutes: 60, price: 2_250_000 },
      { code: 'PT10', sessionCount: 10, sessionMinutes: 60, price: 4_000_000 },
      { code: 'PT20', sessionCount: 20, sessionMinutes: 60, price: 7_000_000 },
    ],
  );
  assert.equal(GYM_DOMAIN_RULES.PT_PACKAGES.DEFAULT_SESSION_MINUTES, 60);
  assert.equal(GYM_DOMAIN_RULES.PT_PACKAGES.MAX_OPEN_STANDALONE_PURCHASES, 1);
  assert.equal(
    buildOrphanPtReservedReconcileKey('50000009-0000-4000-8000-000000000009'),
    'reconcile:orphan-pt-reserved:50000009-0000-4000-8000-000000000009',
  );
});

test('Standalone lifecycle keeps PENDING_PAYMENT and reserved>0 open until settled', () => {
  assert.equal(isStandalonePtPurchaseOpen(PtPurchaseStatus.PENDING_PAYMENT), true);
  assert.equal(isStandalonePtPurchaseOpen(PtPurchaseStatus.ACTIVE), true);
  assert.equal(isStandalonePtPurchaseOpen(PtPurchaseStatus.EXHAUSTED), false);

  assert.equal(
    deriveStandalonePtPurchaseStatus({
      paymentStatus: PaymentStatus.PENDING,
      allocated: 5,
      reserved: 0,
      used: 0,
    }),
    PtPurchaseStatus.PENDING_PAYMENT,
  );
  assert.equal(
    deriveStandalonePtPurchaseStatus({
      paymentStatus: PaymentStatus.PAID,
      allocated: 5,
      reserved: 1,
      used: 4,
    }),
    PtPurchaseStatus.ACTIVE,
  );
  assert.equal(
    deriveStandalonePtPurchaseStatus({
      paymentStatus: PaymentStatus.PAID,
      allocated: 5,
      reserved: 0,
      used: 5,
    }),
    PtPurchaseStatus.EXHAUSTED,
  );
  assert.throws(
    () =>
      deriveStandalonePtPurchaseStatus({
        paymentStatus: PaymentStatus.REFUNDED,
        allocated: 5,
        reserved: 1,
        used: 0,
      }),
    /reserved > 0/,
  );
  assert.throws(
    () =>
      deriveStandalonePtPurchaseStatus({
        paymentStatus: PaymentStatus.REFUNDED,
        allocated: 5,
        reserved: 0,
        used: 1,
      }),
    /used > 0/,
  );
});

test('Policy 1: Legacy classification and survival across later Gym expiry vs historical pre-cutover', () => {
  const cutoverAt = '2026-11-16T12:00:00.000Z';

  // Live finite quota at cutover survives later Gym expiry
  const finiteLive = classifyLegacyPtQuotaAtCutover({
    cutoverAt,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    paymentStatus: PaymentStatus.PAID,
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2026-11-20T00:00:00.000Z',
    allocated: 8,
    reserved: 1,
    used: 7,
  });
  assert.equal(finiteLive.cutoverEligible, true);
  assert.equal(finiteLive.status, PtPurchaseStatus.ACTIVE);
  assert.equal(
    effectivePtPurchaseStatus(
      {
        origin: PtPurchaseOrigin.LEGACY_BUNDLED,
        storedStatus: finiteLive.status,
        paymentStatus: PaymentStatus.PAID,
        allocated: 8,
        reserved: 1,
        used: 7,
        cutoverEligible: true,
      },
      {
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        endDate: '2026-11-20T00:00:00.000Z',
      },
      new Date('2026-12-10T00:00:00.000Z'),
    ),
    PtPurchaseStatus.ACTIVE,
  );

  // Unlimited legacy stays unlimited only during original valid term (including freeze extension)
  const unlimitedLive = classifyLegacyPtQuotaAtCutover({
    cutoverAt,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    paymentStatus: PaymentStatus.PAID,
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    allocated: null,
    reserved: 0,
    used: 2,
  });
  assert.equal(unlimitedLive.unlimited, true);
  assert.equal(unlimitedLive.status, PtPurchaseStatus.ACTIVE);
  assert.equal(
    effectivePtPurchaseStatus(
      {
        origin: PtPurchaseOrigin.LEGACY_BUNDLED,
        storedStatus: PtPurchaseStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        allocated: null,
        reserved: 0,
        used: 2,
        cutoverEligible: true,
      },
      {
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        endDate: '2026-11-30T00:00:00.000Z',
      },
      new Date('2026-12-01T00:00:00.000Z'),
    ),
    PtPurchaseStatus.EXPIRED,
  );

  // Expired, cancelled, refunded before cutover, and zero-allocation stay historical
  assert.deepEqual(
    classifyLegacyPtQuotaAtCutover({
      cutoverAt,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-11-10T00:00:00.000Z',
      allocated: 8,
      reserved: 0,
      used: 2,
    }),
    {
      cutoverAt,
      cutoverEligible: false,
      status: PtPurchaseStatus.EXPIRED,
      historicalReason: 'EXPIRED_BEFORE_CUTOVER',
      unlimited: false,
    },
  );
  assert.equal(
    classifyLegacyPtQuotaAtCutover({
      cutoverAt,
      subscriptionStatus: SubscriptionStatus.CANCELLED,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z',
      allocated: 8,
      reserved: 0,
      used: 0,
    }).status,
    PtPurchaseStatus.CANCELLED,
  );
  assert.equal(
    classifyLegacyPtQuotaAtCutover({
      cutoverAt,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.REFUNDED,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z',
      allocated: 8,
      reserved: 0,
      used: 0,
    }).status,
    PtPurchaseStatus.REFUNDED,
  );
  assert.equal(
    classifyLegacyPtQuotaAtCutover({
      cutoverAt,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z',
      allocated: 0,
      reserved: 0,
      used: 0,
    }).cutoverEligible,
    false,
  );
});

test('Policy 3 & Policy 4: Gym coverage (paid upcoming + freezes) and deterministic PT credit selection', () => {
  const memberId = 'member-1';
  const refNow = '2026-11-16T08:00:00.000Z';

  // Paid UPCOMING subscription covers whole future appointment interval; overlapping freeze blocks coverage
  const gymSubs = [
    {
      id: 'sub-active',
      memberId,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z',
      freezes: [
        {
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-28T00:00:00.000Z',
          status: FreezeStatus.APPROVED,
          restoredAt: null,
        },
      ],
    },
    {
      id: 'sub-upcoming-paid',
      memberId,
      status: SubscriptionStatus.UPCOMING,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
    },
    {
      id: 'sub-upcoming-unpaid',
      memberId,
      status: SubscriptionStatus.UPCOMING,
      paymentStatus: PaymentStatus.PENDING,
      startDate: '2027-01-01T00:00:00.000Z',
      endDate: '2027-02-01T00:00:00.000Z',
    },
  ];

  // Blocked by freeze window on active subscription
  assert.deepEqual(
    evaluateGymCoverageForSlot(
      gymSubs,
      '2026-11-22T09:00:00.000Z',
      '2026-11-22T10:00:00.000Z',
      { referenceNow: refNow },
    ),
    {
      covered: false,
      coveringSubscriptionId: null,
      coveringSubscriptionStatus: null,
      reason: 'FROZEN_DURING_INTERVAL',
    },
  );

  // Boundary straddle between active end and upcoming start does not cover whole interval
  assert.equal(
    evaluateGymCoverageForSlot(
      gymSubs,
      '2026-11-30T23:30:00.000Z',
      '2026-12-01T00:30:00.000Z',
      { referenceNow: refNow },
    ).covered,
    false,
  );

  // Paid upcoming Gym subscription covers interval completely
  assert.deepEqual(
    evaluateGymCoverageForSlot(
      gymSubs,
      '2026-12-10T09:00:00.000Z',
      '2026-12-10T10:00:00.000Z',
      { referenceNow: refNow },
    ),
    {
      covered: true,
      coveringSubscriptionId: 'sub-upcoming-paid',
      coveringSubscriptionStatus: SubscriptionStatus.UPCOMING,
      reason: null,
    },
  );

  // Unpaid upcoming Gym subscription never covers
  assert.equal(
    evaluateGymCoverageForSlot(
      gymSubs,
      '2027-01-10T09:00:00.000Z',
      '2027-01-10T10:00:00.000Z',
      { referenceNow: refNow },
    ).covered,
    false,
  );

  // Deterministic PT credit source selection:
  // 1) Legacy unlimited (real deadline) first inside its term
  // 2) Legacy finite before standalone
  // 3) Upcoming legacy cannot be used before its original startDate
  const candidates = [
    {
      id: 'pt-standalone',
      memberId,
      origin: PtPurchaseOrigin.STANDALONE,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 10,
      reserved: 0,
      used: 0,
      cutoverEligible: null,
      createdAt: '2026-11-16T01:00:00.000Z',
    },
    {
      id: 'pt-legacy-upcoming',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 5,
      reserved: 0,
      used: 0,
      cutoverEligible: true,
      createdAt: '2026-11-15T00:00:00.000Z',
      sourceSubscription: {
        id: 'sub-upcoming-paid',
        memberId,
        status: SubscriptionStatus.UPCOMING,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
      },
    },
    {
      id: 'pt-legacy-finite-expired-gym',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 4,
      reserved: 0,
      used: 1,
      cutoverEligible: true,
      createdAt: '2026-11-02T00:00:00.000Z',
      sourceSubscription: {
        id: 'sub-expired-later',
        memberId,
        status: SubscriptionStatus.EXPIRED,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-11-15T00:00:00.000Z',
      },
    },
    {
      id: 'pt-legacy-unlimited',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: null,
      reserved: 0,
      used: 3,
      cutoverEligible: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      sourceSubscription: {
        id: 'sub-active',
        memberId,
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-01T00:00:00.000Z',
      },
    },
  ];

  // During November active period: unlimited legacy (real deadline) wins; upcoming legacy is excluded!
  const novSelection = selectPtCreditSourceForSlot(
    candidates,
    '2026-11-18T09:00:00.000Z',
    '2026-11-18T10:00:00.000Z',
    { referenceNow: refNow },
  );
  assert.equal(novSelection.selectedPurchaseId, 'pt-legacy-unlimited');
  assert.deepEqual(novSelection.eligiblePurchaseIds, [
    'pt-legacy-unlimited',
    'pt-legacy-finite-expired-gym',
    'pt-standalone',
  ]);

  // During December upcoming period (after unlimited expired): surviving finite legacy wins over upcoming finite legacy, both beat standalone
  const decSelection = selectPtCreditSourceForSlot(
    candidates,
    '2026-12-10T09:00:00.000Z',
    '2026-12-10T10:00:00.000Z',
    { referenceNow: '2026-12-05T08:00:00.000Z' },
  );
  assert.equal(decSelection.selectedPurchaseId, 'pt-legacy-finite-expired-gym');
  assert.deepEqual(decSelection.eligiblePurchaseIds, [
    'pt-legacy-finite-expired-gym',
    'pt-legacy-upcoming',
    'pt-standalone',
  ]);
});

test('Mirrored legacy quota and purchase are never double-counted as two spendable balances', () => {
  const quotas = [
    {
      id: 'q-pt-mirrored',
      subscriptionId: 'sub-1',
      service: ServiceTypeCode.PT,
      allocated: 8,
      reserved: 1,
      used: 2,
    },
    {
      id: 'q-class',
      subscriptionId: 'sub-1',
      service: ServiceTypeCode.CLASS,
      allocated: 12,
      reserved: 0,
      used: 1,
    },
  ];
  const purchases = [
    {
      id: 'p-legacy-1',
      memberId: 'member-1',
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-pt-mirrored',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 8,
      reserved: 1,
      used: 2,
      cutoverEligible: true,
      sourceSubscription: {
        id: 'sub-1',
        memberId: 'member-1',
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-01T00:00:00.000Z',
      },
    },
    {
      id: 'p-standalone-1',
      memberId: 'member-1',
      origin: PtPurchaseOrigin.STANDALONE,
      legacyQuotaId: null,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 5,
      reserved: 0,
      used: 1,
      cutoverEligible: null,
    },
  ];

  const unmirrored = filterUnmirroredSubscriptionQuotas(quotas, purchases);
  assert.deepEqual(
    unmirrored.map((q) => q.id),
    ['q-class'],
  );

  const summary = summarizeSpendablePtCredits(quotas, purchases, {
    now: '2026-11-16T08:00:00.000Z',
  });
  assert.equal(summary.scope, 'PT_CREDIT_BALANCE_ONLY');
  assert.equal(summary.requiresSeparateGymCoverage, true);
  assert.equal(summary.finiteRemaining, 9); // (8-1-2) + (5-0-1) = 5 + 4 = 9 (NOT 14!)
  assert.equal(summary.finiteReserved, 1);
  assert.equal(summary.finiteUsed, 3);
  assert.deepEqual(summary.eligiblePurchaseIds, [
    'p-legacy-1',
    'p-standalone-1',
  ]);
  assert.deepEqual(summary.unmirroredLegacyQuotaIds, []);
});

test('Finding #1: effectivePtPurchaseStatus & selection/summary stay consistent with live source payment status', () => {
  const memberId = 'member-pay';
  const now = new Date('2026-11-16T10:00:00.000Z');
  const slotStart = '2026-11-20T09:00:00.000Z';
  const slotEnd = '2026-11-20T10:00:00.000Z';

  // Eligible LEGACY_BUNDLED stored PENDING_PAYMENT becomes ACTIVE once source subscription is confirmed PAID
  const stalePendingPurchase = {
    id: 'pt-stale-pending',
    memberId,
    origin: PtPurchaseOrigin.LEGACY_BUNDLED,
    legacyQuotaId: 'q-stale-pending',
    storedStatus: PtPurchaseStatus.PENDING_PAYMENT,
    paymentStatus: PaymentStatus.PENDING,
    allocated: 6,
    reserved: 0,
    used: 0,
    cutoverEligible: true,
    createdAt: '2026-11-15T00:00:00.000Z',
    sourceSubscription: {
      id: 'sub-paid-now',
      memberId,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z',
      agreedPrice: 1490000,
      confirmedPaidAmount: 1490000,
    },
  };
  assert.equal(
    effectivePtPurchaseStatus(
      stalePendingPurchase,
      stalePendingPurchase.sourceSubscription,
      now,
    ),
    PtPurchaseStatus.ACTIVE,
  );
  assert.equal(
    selectPtCreditSourceForSlot([stalePendingPurchase], slotStart, slotEnd, {
      referenceNow: now,
    }).selectedPurchaseId,
    'pt-stale-pending',
  );
  assert.deepEqual(
    summarizeSpendablePtCredits([], [stalePendingPurchase], { now })
      .eligiblePurchaseIds,
    ['pt-stale-pending'],
  );

  // Eligible LEGACY_BUNDLED stored PENDING_PAYMENT with all finite sessions used settles to EXHAUSTED once PAID
  assert.equal(
    effectivePtPurchaseStatus(
      {
        ...stalePendingPurchase,
        allocated: 4,
        reserved: 0,
        used: 4,
      },
      stalePendingPurchase.sourceSubscription,
      now,
    ),
    PtPurchaseStatus.EXHAUSTED,
  );

  // Stale ACTIVE/PAID snapshot cannot bypass source PENDING, underpaid PAID, REFUNDED, or CANCELLED
  const staleActivePurchase = {
    ...stalePendingPurchase,
    id: 'pt-stale-active',
    storedStatus: PtPurchaseStatus.ACTIVE,
    paymentStatus: PaymentStatus.PAID,
  };
  for (const blockedSource of [
    {
      ...stalePendingPurchase.sourceSubscription,
      paymentStatus: PaymentStatus.PENDING,
      confirmedPaidAmount: 0,
    },
    {
      ...stalePendingPurchase.sourceSubscription,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 1490000,
      confirmedPaidAmount: 500000,
    },
    {
      ...stalePendingPurchase.sourceSubscription,
      paymentStatus: PaymentStatus.REFUNDED,
    },
    {
      ...stalePendingPurchase.sourceSubscription,
      status: SubscriptionStatus.CANCELLED,
      paymentStatus: PaymentStatus.CANCELLED,
    },
  ]) {
    const candidate = { ...staleActivePurchase, sourceSubscription: blockedSource };
    assert.notEqual(
      effectivePtPurchaseStatus(candidate, blockedSource, now),
      PtPurchaseStatus.ACTIVE,
    );
    assert.equal(
      selectPtCreditSourceForSlot([candidate], slotStart, slotEnd, {
        referenceNow: now,
      }).selectedPurchaseId,
      null,
    );
    assert.deepEqual(
      summarizeSpendablePtCredits([], [candidate], { now }).eligiblePurchaseIds,
      [],
    );
  }

  // Irreversible pre-cutover historical record never becomes ACTIVE even if source subscription looks PAID
  const preCutoverExpired = {
    ...stalePendingPurchase,
    id: 'pt-hist-expired',
    storedStatus: PtPurchaseStatus.EXPIRED,
    paymentStatus: PaymentStatus.PAID,
    cutoverEligible: false,
  };
  assert.equal(
    effectivePtPurchaseStatus(
      preCutoverExpired,
      stalePendingPurchase.sourceSubscription,
      now,
    ),
    PtPurchaseStatus.EXPIRED,
  );
  assert.equal(
    selectPtCreditSourceForSlot([preCutoverExpired], slotStart, slotEnd, {
      referenceNow: now,
    }).selectedPurchaseId,
    null,
  );
});

test('Finding #2: freeze intervals handle scheduled future, multiple windows, SUSPENDED, and paid UPCOMING', () => {
  const memberId = 'member-freeze';
  const refNow = '2026-11-05T08:00:00.000Z';

  // SUSPENDED subscription with two scheduled future freeze windows + paid UPCOMING coverage
  const subs = [
    {
      id: 'sub-suspended-with-windows',
      memberId,
      status: SubscriptionStatus.SUSPENDED,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-30T00:00:00.000Z',
      freezes: [
        {
          id: 'freeze-1',
          startsAt: '2026-11-10T00:00:00.000Z',
          endsAt: '2026-11-18T00:00:00.000Z',
          status: FreezeStatus.APPROVED,
          restoredAt: null,
        },
        {
          id: 'freeze-2',
          startsAt: '2026-12-01T00:00:00.000Z',
          endsAt: '2026-12-10T00:00:00.000Z',
          status: FreezeStatus.APPROVED,
          restoredAt: null,
        },
      ],
    },
    {
      id: 'sub-upcoming-paid-frozen',
      memberId,
      status: SubscriptionStatus.UPCOMING,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2027-01-01T00:00:00.000Z',
      endDate: '2027-02-01T00:00:00.000Z',
      freezes: [
        {
          id: 'freeze-up',
          startsAt: '2027-01-10T00:00:00.000Z',
          endsAt: '2027-01-17T00:00:00.000Z',
          status: FreezeStatus.APPROVED,
          restoredAt: null,
        },
      ],
    },
  ];

  // Before freeze 1
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2026-11-08T09:00:00.000Z',
      '2026-11-08T10:00:00.000Z',
      { referenceNow: refNow },
    ).coveringSubscriptionId,
    'sub-suspended-with-windows',
  );
  // Overlapping freeze 1
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2026-11-12T09:00:00.000Z',
      '2026-11-12T10:00:00.000Z',
      { referenceNow: refNow },
    ).reason,
    'FROZEN_DURING_INTERVAL',
  );
  // Between freeze 1 and freeze 2
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2026-11-22T09:00:00.000Z',
      '2026-11-22T10:00:00.000Z',
      { referenceNow: refNow },
    ).coveringSubscriptionId,
    'sub-suspended-with-windows',
  );
  // Overlapping freeze 2
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2026-12-05T09:00:00.000Z',
      '2026-12-05T10:00:00.000Z',
      { referenceNow: refNow },
    ).reason,
    'FROZEN_DURING_INTERVAL',
  );
  // After freeze 2
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2026-12-15T09:00:00.000Z',
      '2026-12-15T10:00:00.000Z',
      { referenceNow: refNow },
    ).coveringSubscriptionId,
    'sub-suspended-with-windows',
  );

  // Paid UPCOMING covers before/after its own scheduled freeze, blocks during it
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2027-01-05T09:00:00.000Z',
      '2027-01-05T10:00:00.000Z',
      { referenceNow: refNow },
    ).coveringSubscriptionId,
    'sub-upcoming-paid-frozen',
  );
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2027-01-12T09:00:00.000Z',
      '2027-01-12T10:00:00.000Z',
      { referenceNow: refNow },
    ).reason,
    'FROZEN_DURING_INTERVAL',
  );
  assert.equal(
    evaluateGymCoverageForSlot(
      subs,
      '2027-01-20T09:00:00.000Z',
      '2027-01-20T10:00:00.000Z',
      { referenceNow: refNow },
    ).coveringSubscriptionId,
    'sub-upcoming-paid-frozen',
  );

  // SUSPENDED with NO explanatory active freeze windows stays conservatively blocked
  assert.deepEqual(
    evaluateGymCoverageForSlot(
      [
        {
          id: 'sub-suspended-no-freeze',
          memberId,
          status: SubscriptionStatus.SUSPENDED,
          paymentStatus: PaymentStatus.PAID,
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2026-12-30T00:00:00.000Z',
          freezes: [],
        },
      ],
      '2026-11-08T09:00:00.000Z',
      '2026-11-08T10:00:00.000Z',
      { referenceNow: refNow },
    ),
    {
      covered: false,
      coveringSubscriptionId: null,
      coveringSubscriptionStatus: null,
      reason: 'SUSPENDED_WITHOUT_RESTORE_WINDOW',
    },
  );
});

test('Finding #3: summarizeSpendablePtCredits enforces current spendable semantics, deduplication & independent Gym coverage', () => {
  const memberId = 'member-summary';
  const now = '2026-11-16T08:00:00.000Z';

  const quotas = [
    {
      id: 'q-upcoming',
      subscriptionId: 'sub-upcoming',
      service: ServiceTypeCode.PT,
      allocated: 6,
      reserved: 0,
      used: 0,
    },
    {
      id: 'q-frozen',
      subscriptionId: 'sub-frozen',
      service: ServiceTypeCode.PT,
      allocated: 8,
      reserved: 0,
      used: 1,
    },
    {
      id: 'q-expired-finite',
      subscriptionId: 'sub-expired-finite',
      service: ServiceTypeCode.PT,
      allocated: 5,
      reserved: 0,
      used: 2,
    },
    {
      id: 'q-expired-unlimited',
      subscriptionId: 'sub-expired-unlimited',
      service: ServiceTypeCode.PT,
      allocated: null,
      reserved: 0,
      used: 4,
    },
    {
      id: 'q-missing-source',
      subscriptionId: 'sub-missing-source',
      service: ServiceTypeCode.PT,
      allocated: 4,
      reserved: 0,
      used: 0,
    },
    {
      id: 'q-unmirrored-pending',
      subscriptionId: 'sub-unmirrored-pending',
      service: ServiceTypeCode.PT,
      allocated: 3,
      reserved: 0,
      used: 0,
    },
  ];

  const purchases = [
    // Upcoming paid legacy: excluded from current spendable balance before startDate
    {
      id: 'p-upcoming',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-upcoming',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 6,
      reserved: 0,
      used: 0,
      cutoverEligible: true,
      sourceSubscription: {
        id: 'sub-upcoming',
        memberId,
        status: SubscriptionStatus.UPCOMING,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
      },
    },
    // Currently frozen legacy: excluded while frozen at `now`
    {
      id: 'p-frozen',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-frozen',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 8,
      reserved: 0,
      used: 1,
      cutoverEligible: true,
      sourceSubscription: {
        id: 'sub-frozen',
        memberId,
        status: SubscriptionStatus.SUSPENDED,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-15T00:00:00.000Z',
        freezes: [
          {
            startsAt: '2026-11-10T00:00:00.000Z',
            endsAt: '2026-11-24T00:00:00.000Z',
            status: FreezeStatus.APPROVED,
            restoredAt: null,
          },
        ],
      },
    },
    // Grandfathered finite legacy whose Gym subscription expired after cutover: credit survives (3 remaining)
    {
      id: 'p-expired-finite',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-expired-finite',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 5,
      reserved: 0,
      used: 2,
      cutoverEligible: true,
      sourceSubscription: {
        id: 'sub-expired-finite',
        memberId,
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-11-10T00:00:00.000Z',
      },
    },
    // Unlimited legacy whose Gym subscription expired: no longer spendable
    {
      id: 'p-expired-unlimited',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-expired-unlimited',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: null,
      reserved: 0,
      used: 4,
      cutoverEligible: true,
      sourceSubscription: {
        id: 'sub-expired-unlimited',
        memberId,
        status: SubscriptionStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-11-10T00:00:00.000Z',
      },
    },
    // Missing source subscription: never counted
    {
      id: 'p-missing-source',
      memberId,
      origin: PtPurchaseOrigin.LEGACY_BUNDLED,
      legacyQuotaId: 'q-missing-source',
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 4,
      reserved: 0,
      used: 0,
      cutoverEligible: true,
      sourceSubscription: null,
    },
    // Standalone PT: credit balance stays spendable (10 remaining) independent of Gym coverage
    {
      id: 'p-standalone',
      memberId,
      origin: PtPurchaseOrigin.STANDALONE,
      legacyQuotaId: null,
      storedStatus: PtPurchaseStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      allocated: 10,
      reserved: 0,
      used: 0,
      cutoverEligible: null,
    },
  ];

  // Even with NO Gym coverage at `now`, spendable credit summary keeps surviving finite legacy + standalone, excludes upcoming/frozen/expired-unlimited/missing-source, and never double-counts mirrored quotas
  const gymCoverageNow = evaluateGymCoverageForSlot(
    [
      purchases[0].sourceSubscription,
      purchases[1].sourceSubscription,
      purchases[2].sourceSubscription,
      purchases[3].sourceSubscription,
    ],
    '2026-11-16T08:00:00.000Z',
    '2026-11-16T09:00:00.000Z',
    { referenceNow: now },
  );
  assert.equal(gymCoverageNow.covered, false);

  const summaryNow = summarizeSpendablePtCredits(quotas, purchases, { now });
  assert.equal(summaryNow.scope, 'PT_CREDIT_BALANCE_ONLY');
  assert.equal(summaryNow.requiresSeparateGymCoverage, true);
  assert.equal(summaryNow.hasUnlimited, false);
  assert.equal(summaryNow.finiteRemaining, 13); // 3 (p-expired-finite) + 10 (p-standalone)
  assert.equal(summaryNow.finiteUsed, 2);
  assert.deepEqual(summaryNow.eligiblePurchaseIds, [
    'p-expired-finite',
    'p-standalone',
  ]);
  // Mirrored quotas excluded even if their purchase is currently frozen/upcoming/expired; unmirrored pending is listed but NOT added without activeUnmirroredSubscriptionIds
  assert.deepEqual(summaryNow.unmirroredLegacyQuotaIds, [
    'q-unmirrored-pending',
  ]);

  // Once December arrives (after freeze ended and upcoming started), both p-upcoming and p-frozen become spendable too
  const summaryDec = summarizeSpendablePtCredits(quotas, purchases, {
    now: '2026-12-05T08:00:00.000Z',
  });
  assert.deepEqual(summaryDec.eligiblePurchaseIds, [
    'p-upcoming',
    'p-frozen',
    'p-expired-finite',
    'p-standalone',
  ]);
  assert.equal(summaryDec.finiteRemaining, 26); // 6 + 7 + 3 + 10
});

test('Batch 3C: unlimited legacy PT honors freeze-extended sourceSubscription.endDate and expires thereafter', () => {
  const memberId = 'member-unlim-freeze';
  const unlimitedCandidate = {
    id: 'p-unlim-extended',
    memberId,
    origin: PtPurchaseOrigin.LEGACY_BUNDLED,
    legacyQuotaId: 'q-unlim-extended',
    storedStatus: PtPurchaseStatus.ACTIVE,
    paymentStatus: PaymentStatus.PAID,
    allocated: null,
    reserved: 0,
    used: 5,
    cutoverEligible: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    sourceSubscription: {
      id: 'sub-unlim-extended',
      memberId,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      startDate: '2026-11-01T00:00:00.000Z',
      // Original endDate was 2026-11-30, extended by 7-day restored freeze to 2026-12-07
      endDate: '2026-12-07T00:00:00.000Z',
      freezes: [
        {
          id: 'frz-completed',
          startsAt: '2026-11-10T00:00:00.000Z',
          endsAt: '2026-11-17T00:00:00.000Z',
          status: FreezeStatus.COMPLETED,
          restoredAt: '2026-11-17T00:00:00.000Z',
        },
      ],
    },
  };

  // Spendable inside the freeze-extended window (2026-12-04)
  const insideExtended = selectPtCreditSourceForSlot(
    [unlimitedCandidate],
    '2026-12-04T09:00:00.000Z',
    '2026-12-04T10:00:00.000Z',
    { referenceNow: '2026-12-02T08:00:00.000Z' },
  );
  assert.equal(insideExtended.selectedPurchaseId, 'p-unlim-extended');

  const summaryInside = summarizeSpendablePtCredits(
    [],
    [unlimitedCandidate],
    { now: '2026-12-04T09:00:00.000Z' },
  );
  assert.equal(summaryInside.hasUnlimited, true);

  // Expired after the freeze-extended endDate (2026-12-08)
  const afterExtended = selectPtCreditSourceForSlot(
    [unlimitedCandidate],
    '2026-12-08T09:00:00.000Z',
    '2026-12-08T10:00:00.000Z',
    { referenceNow: '2026-12-02T08:00:00.000Z' },
  );
  assert.equal(afterExtended.selectedPurchaseId, null);
});

test('PT balance retains the final held session while booking selection rejects an exhausted available balance', () => {
  const purchase = {
    id: 'last-held', memberId: 'member', origin: PtPurchaseOrigin.STANDALONE,
    storedStatus: PtPurchaseStatus.ACTIVE, paymentStatus: PaymentStatus.PAID,
    allocated: 1, reserved: 1, used: 0, cutoverEligible: null,
    createdAt: '2026-11-01T00:00:00Z',
  };
  const summary = summarizeSpendablePtCredits([], [purchase]);
  assert.equal(summary.finiteRemaining, 0);
  assert.equal(summary.finiteReserved, 1);
  assert.deepEqual(summary.eligiblePurchaseIds, ['last-held']);
  assert.equal(selectPtCreditSourceForSlot([purchase], '2026-12-01T00:00:00Z', '2026-12-01T01:00:00Z').selectedPurchaseId, null);
  const legacy = summarizeSpendablePtCredits([{ id: 'quota', subscriptionId: 'gym', service: 'PT', allocated: 1, reserved: 1, used: 0 }], [], { activeUnmirroredSubscriptionIds: new Set(['gym']) });
  assert.equal(legacy.finiteReserved, 1);
  assert.equal(legacy.finiteRemaining, 0);
});
