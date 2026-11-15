/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadMemberPhotoFlow() {
  const sourcePath = path.join(
    __dirname,
    '../src/features/members/member-photo-flow.ts',
  );
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const moduleExports = {};
  const runner = vm.compileFunction(transpiled, ['exports', 'require'], {
    filename: sourcePath,
  });
  runner(moduleExports, require);
  return moduleExports;
}

const flowMod = loadMemberPhotoFlow();

const PHOTO_A = 'data:image/jpeg;base64,QUFBQQ==';
const PHOTO_B = 'data:image/jpeg;base64,QkJCQg==';

const PLAN_VIP = {
  id: 'plan-vip-1',
  name: 'VIP 6 Tháng',
};

function makeMemberDetail(id, code, fullName, email, idPhotoUrl = null) {
  return {
    id,
    userId: `user-${id}`,
    memberCode: code,
    fullName,
    email,
    phone: '0901234567',
    gender: 'MALE',
    dateOfBirth: null,
    idPhotoUrl,
    status: 'ACTIVE',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
}

function makeSubscriptionDetail(id, memberId, plan) {
  return {
    id,
    memberId,
    planId: plan.id,
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    startDate: '2026-11-11T00:00:00.000Z',
    endDate: '2027-05-11T00:00:00.000Z',
    previousSubscriptionId: null,
    plan: {
      id: plan.id,
      name: plan.name,
      price: 6000000,
      durationDays: 180,
    },
    quotas: [],
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
}

function createFakeCanvas(tag = 'captured') {
  const ops = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, '2d');
      return {
        fillStyle: '#000',
        fillRect(x, y, w, h) {
          ops.push({ type: 'fillRect', args: [x, y, w, h] });
        },
        translate(x, y) {
          ops.push({ type: 'translate', args: [x, y] });
        },
        scale(x, y) {
          ops.push({ type: 'scale', args: [x, y] });
        },
        drawImage(...args) {
          ops.push({ type: 'drawImage', args });
        },
      };
    },
    toDataURL(mime, quality) {
      ops.push({ type: 'toDataURL', args: [mime, quality] });
      return `data:image/jpeg;base64,${Buffer.from(`${tag}:${canvas.width}x${canvas.height}`).toString('base64')}`;
    },
  };
  return { canvas, ops };
}

test('registering a second member after completion creates a new member and never attaches to the previous member', async () => {
  let state = flowMod.createInitialOnboardingState(1, '2026-11-12');
  const setState = (updater) => {
    state = updater(state);
  };

  const createdMemberPayloads = [];
  const createdSubscriptionPayloads = [];

  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Nguyễn Văn Nhất',
    email: 'nhat@auragym.vn',
    phone: '0901111222',
    photoDataUrl: PHOTO_A,
  });
  state = flowMod.updateOnboardingPlanFields(state, {
    attachPlan: true,
    selectedPlanId: PLAN_VIP.id,
  });

  const firstRes = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: async (payload) => {
      createdMemberPayloads.push(payload);
      return makeMemberDetail(
        'mem-1',
        'MEM-00000001',
        payload.fullName,
        payload.email,
        payload.idPhotoUrl ?? null,
      );
    },
    createSubscription: async (payload) => {
      createdSubscriptionPayloads.push(payload);
      return makeSubscriptionDetail('sub-1', payload.memberId, PLAN_VIP);
    },
  });

  assert.equal(firstRes.status, 'completed');
  assert.equal(state.createdMemberCache, null);
  assert.equal(state.completedResult.member.id, 'mem-1');
  assert.equal(createdMemberPayloads.length, 1);
  assert.equal(createdSubscriptionPayloads.length, 1);
  assert.equal(createdSubscriptionPayloads[0].memberId, 'mem-1');

  // Staff clicks "Đăng ký hội viên tiếp theo" -> resets onboarding session cleanly
  state = flowMod.resetOnboardingState(state, '2026-11-12');
  assert.equal(state.createdMemberCache, null);
  assert.equal(state.completedResult, null);
  assert.equal(state.sessionId, 2);

  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Trần Thị Hai',
    email: 'hai@auragym.vn',
    phone: '0903333444',
    photoDataUrl: PHOTO_B,
  });
  state = flowMod.updateOnboardingPlanFields(state, {
    attachPlan: true,
    selectedPlanId: PLAN_VIP.id,
  });

  const secondRes = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: async (payload) => {
      createdMemberPayloads.push(payload);
      return makeMemberDetail(
        'mem-2',
        'MEM-00000002',
        payload.fullName,
        payload.email,
        payload.idPhotoUrl ?? null,
      );
    },
    createSubscription: async (payload) => {
      createdSubscriptionPayloads.push(payload);
      return makeSubscriptionDetail('sub-2', payload.memberId, PLAN_VIP);
    },
  });

  assert.equal(secondRes.status, 'completed');
  assert.equal(createdMemberPayloads.length, 2);
  assert.equal(createdMemberPayloads[1].email, 'hai@auragym.vn');
  assert.equal(createdSubscriptionPayloads.length, 2);
  assert.equal(createdSubscriptionPayloads[1].memberId, 'mem-2');
  assert.notEqual(createdSubscriptionPayloads[1].memberId, 'mem-1');
  assert.equal(state.createdMemberCache, null);
});

test('incomplete onboarding retry freezes persisted identity/photo, avoids duplicate POST /members, and allows explicit reset', async () => {
  let state = flowMod.createInitialOnboardingState(1, '2026-11-12');
  const setState = (updater) => {
    state = updater(state);
  };

  let createMemberCalls = 0;
  let validatePhotoCalls = 0;
  const subscriptionAttempts = [];

  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Lê Minh Khoa',
    email: 'khoa@auragym.vn',
    phone: '0912345678',
    photoDataUrl: PHOTO_A,
  });
  state = flowMod.updateOnboardingPlanFields(state, {
    attachPlan: true,
    selectedPlanId: PLAN_VIP.id,
    paymentMethod: 'TRANSFER',
  });

  const failedSubAttempt = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => {
      validatePhotoCalls += 1;
      return { valid: true, faceCount: 1 };
    },
    createMember: async (payload) => {
      createMemberCalls += 1;
      return makeMemberDetail(
        'mem-retry-1',
        'MEM-RETRY001',
        payload.fullName,
        payload.email,
        payload.idPhotoUrl ?? null,
      );
    },
    createSubscription: async (payload) => {
      subscriptionAttempts.push(payload);
      throw new Error('Thiết bị POS tạm mất kết nối');
    },
  });

  assert.equal(failedSubAttempt.status, 'subscription_failed');
  assert.equal(createMemberCalls, 1);
  assert.equal(validatePhotoCalls, 1);
  assert.equal(state.createdMemberCache.id, 'mem-retry-1');
  assert.equal(state.activeStep, 3);
  assert.equal(state.fieldErrors.general, 'Thiết bị POS tạm mất kết nối');
  assert.equal(flowMod.isOnboardingIdentityLocked(state), true);

  // Persisted Step 1 & Step 2 fields are frozen so edits cannot be silently discarded on retry
  const attemptedIdentityMutation = flowMod.updateOnboardingIdentityFields(
    state,
    {
      fullName: 'Người Hoàn Toàn Mới',
      email: 'newperson@auragym.vn',
      photoDataUrl: PHOTO_B,
    },
  );
  assert.equal(attemptedIdentityMutation.fields.fullName, 'Lê Minh Khoa');
  assert.equal(attemptedIdentityMutation.fields.email, 'khoa@auragym.vn');
  assert.equal(attemptedIdentityMutation.fields.photoDataUrl, PHOTO_A);

  // Step 3 plan/payment fields remain editable for retry
  state = flowMod.updateOnboardingPlanFields(state, {
    paymentMethod: 'CASH',
    posNote: 'Đổi sang thu tiền mặt tại quầy',
  });
  assert.equal(state.fields.paymentMethod, 'CASH');

  const retrySuccess = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => {
      validatePhotoCalls += 1;
      return { valid: true, faceCount: 1 };
    },
    createMember: async () => {
      createMemberCalls += 1;
      throw new Error('Must not create duplicate member');
    },
    createSubscription: async (payload) => {
      subscriptionAttempts.push(payload);
      return makeSubscriptionDetail('sub-retry-ok', payload.memberId, PLAN_VIP);
    },
  });

  assert.equal(retrySuccess.status, 'completed');
  assert.equal(
    subscriptionAttempts[0].idempotencyKey,
    subscriptionAttempts[1].idempotencyKey,
  );
  assert.equal(createMemberCalls, 1);
  assert.equal(validatePhotoCalls, 1);
  assert.equal(subscriptionAttempts.length, 2);
  assert.equal(subscriptionAttempts[1].memberId, 'mem-retry-1');
  assert.equal(subscriptionAttempts[1].paymentMethod, 'CASH');
  assert.equal(state.createdMemberCache, null);
});

test('explicit reset from incomplete member unlocks new-person registration and in-flight submit blocks premature reset', async () => {
  let state = flowMod.createInitialOnboardingState(5, '2026-11-12');
  const setState = (updater) => {
    state = updater(state);
  };

  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Phạm Quốc Bảo',
    email: 'bao@auragym.vn',
  });

  let releaseCreateMember;
  const submissionPromise = flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: () =>
      new Promise((resolve) => {
        releaseCreateMember = () =>
          resolve(
            makeMemberDetail(
              'mem-inflight',
              'MEM-INFLIGHT',
              'Phạm Quốc Bảo',
              'bao@auragym.vn',
            ),
          );
      }),
    createSubscription: async () => {
      throw new Error('Lỗi tạo gói');
    },
  });

  assert.equal(state.isSubmitting, true);
  assert.equal(flowMod.canCloseOrResetOnboarding(state), false);

  // Attempting to close/reset while request is in flight is safely ignored
  const blockedReset = flowMod.resetOnboardingState(state, '2026-11-12');
  assert.equal(blockedReset, state);
  assert.equal(blockedReset.sessionId, 5);

  // Duplicate submit while in flight is ignored
  const duplicateSubmit = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState,
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: async () => {
      throw new Error('Should not run');
    },
    createSubscription: async () => {
      throw new Error('Should not run');
    },
  });
  assert.equal(duplicateSubmit.status, 'ignored_in_flight');

  releaseCreateMember();
  const outcome = await submissionPromise;
  assert.equal(outcome.status, 'subscription_failed');
  assert.equal(state.isSubmitting, false);
  assert.equal(state.createdMemberCache.id, 'mem-inflight');
  assert.equal(flowMod.canCloseOrResetOnboarding(state), true);

  // Explicit "Tạo hồ sơ người mới" or modal close/reopen clears createdMemberCache
  state = flowMod.resetOnboardingState(state, '2026-11-12');
  assert.equal(state.sessionId, 6);
  assert.equal(state.createdMemberCache, null);
  assert.equal(flowMod.isOnboardingIdentityLocked(state), false);
});

test('keyed photo validation resets stale green badges immediately and reuses in-flight/cached inference', async () => {
  const settledValidA = { src: PHOTO_A, valid: true, faceCount: 1 };

  assert.equal(
    flowMod.resolvePhotoValidationStatus(PHOTO_A, settledValidA),
    'valid',
  );
  // Different image or new crop/zoom output resets immediately to 'checking', never stale 'valid'
  assert.equal(
    flowMod.resolvePhotoValidationStatus(PHOTO_B, settledValidA),
    'checking',
  );
  // Removing photo clears immediately to 'idle'
  assert.equal(flowMod.resolvePhotoValidationStatus('', settledValidA), 'idle');
  // Legacy external URL on another member shows 'legacy', never previous member's 'valid'
  assert.equal(
    flowMod.resolvePhotoValidationStatus(
      'https://images.unsplash.com/photo-legacy.jpg',
      settledValidA,
    ),
    'legacy',
  );

  // Single-flight deduplication + abort isolation + cache reuse
  let inferenceCalls = 0;
  let capturedSignal = null;
  let resolveInference;
  const validator = flowMod.createPhotoValidationCache((src, signal) => {
    inferenceCalls += 1;
    capturedSignal = signal;
    return new Promise((resolve, reject) => {
      resolveInference = resolve;
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  });

  const previewAbort = new AbortController();
  const previewCheck = validator.validate(PHOTO_A, previewAbort.signal);
  const submitCheck = validator.validate(PHOTO_A);

  assert.equal(inferenceCalls, 1);

  // Preview cleans up (e.g. step transition) while submit is still awaiting same photo
  previewAbort.abort();
  await assert.rejects(previewCheck, { name: 'AbortError' });
  assert.equal(capturedSignal.aborted, false);

  resolveInference({ faceCount: 1, descriptor: new Float32Array([0.1, 0.2]) });
  const submitOutcome = await submitCheck;
  assert.deepEqual(submitOutcome, { valid: true, faceCount: 1 });
  assert.equal(inferenceCalls, 1);

  // Subsequent validate(PHOTO_A) reuses settled cache with zero additional inference
  const cachedOutcome = await validator.validate(PHOTO_A);
  assert.deepEqual(cachedOutcome, { valid: true, faceCount: 1 });
  assert.equal(inferenceCalls, 1);

  // Obsolete async check when sole subscriber aborts cancels underlying signal
  let bSignal = null;
  const abortableValidator = flowMod.createPhotoValidationCache(
    (_src, signal) => {
      bSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  );
  const obsoleteController = new AbortController();
  const obsoletePromise = abortableValidator.validate(
    PHOTO_B,
    obsoleteController.signal,
  );
  obsoleteController.abort();
  await assert.rejects(obsoletePromise, { name: 'AbortError' });
  assert.equal(bSignal.aborted, true);
  assert.equal(abortableValidator.peek(PHOTO_B), undefined);
});

test('staff member edit keeps modal and entered values on PATCH failure, preserves unchanged legacy URL, and closes only on success', async () => {
  const legacyMember = {
    memberId: 'mem-seed-1',
    code: 'MEM-SEED0001',
    name: 'Hoàng Thu Trang',
    rawPhone: '0909888777',
    avatarUrl: 'https://images.unsplash.com/photo-seed-portrait.jpg',
  };

  let draft = flowMod.createStaffEditDraft(legacyMember);
  const setDraft = (updater) => {
    draft = updater(draft);
  };

  // Staff edits name & phone without touching the legacy saved URL
  draft = {
    ...draft,
    fullName: 'Hoàng Thu Trang (VIP)',
    phone: '0909111222',
  };

  let patchAttempts = 0;
  let lastPatchPayload = null;

  const failedSave = await flowMod.runStaffMemberEditSave({
    draft,
    setDraft,
    validatePhoto: async () => {
      throw new Error('Should not validate unchanged legacy URL');
    },
    updateMember: async (_id, payload) => {
      patchAttempts += 1;
      lastPatchPayload = payload;
      throw new Error('Máy chủ bận, vui lòng thử lại.');
    },
  });

  // Modal remains open with entered values and inline error
  assert.equal(failedSave.status, 'save_failed');
  assert.notEqual(draft, null);
  assert.equal(draft.isSubmitting, false);
  assert.equal(draft.fullName, 'Hoàng Thu Trang (VIP)');
  assert.equal(draft.phone, '0909111222');
  assert.equal(
    draft.photoInput,
    'https://images.unsplash.com/photo-seed-portrait.jpg',
  );
  assert.equal(draft.submitError, 'Máy chủ bận, vui lòng thử lại.');
  assert.equal(lastPatchPayload.idPhotoUrl, undefined);

  // Retry succeeds -> legacy URL still preserved (idPhotoUrl: undefined) and modal closes
  const succeededSave = await flowMod.runStaffMemberEditSave({
    draft,
    setDraft,
    validatePhoto: async () => {
      throw new Error('Should not validate unchanged legacy URL');
    },
    updateMember: async (_id, payload) => {
      patchAttempts += 1;
      lastPatchPayload = payload;
      return {};
    },
  });

  assert.equal(succeededSave.status, 'saved');
  assert.equal(patchAttempts, 2);
  assert.equal(lastPatchPayload.fullName, 'Hoàng Thu Trang (VIP)');
  assert.equal(lastPatchPayload.phone, '0909111222');
  assert.equal(lastPatchPayload.idPhotoUrl, undefined);
  assert.equal(draft, null);

  // Replacing photo with newly captured data URI validates once and sends data URI;
  // if PATCH fails, the new captured photo stays in draft so staff does not have to retake it
  draft = {
    ...flowMod.createStaffEditDraft(legacyMember),
    photoInput: PHOTO_B,
  };
  const failedWithNewPhoto = await flowMod.runStaffMemberEditSave({
    draft,
    setDraft,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    updateMember: async () => {
      throw new Error('Lỗi mạng tạm thời');
    },
  });
  assert.equal(failedWithNewPhoto.status, 'save_failed');
  assert.notEqual(draft, null);
  assert.equal(draft.photoInput, PHOTO_B);
  assert.equal(draft.submitError, 'Lỗi mạng tạm thời');
});

test('webcam capture enforces loaded video frames and saves unmirrored pixels while keeping crop/zoom math', () => {
  // Unloaded or zero-dimension video frames are rejected (never fabricates 720x960 or 640x480)
  assert.equal(flowMod.isVideoFrameReady(null), false);
  assert.equal(
    flowMod.captureUnmirroredVideoFrame({
      readyState: 1,
      videoWidth: 720,
      videoHeight: 960,
    }),
    null,
  );
  assert.equal(
    flowMod.captureUnmirroredVideoFrame({
      readyState: 4,
      videoWidth: 0,
      videoHeight: 0,
    }),
    null,
  );
  assert.equal(
    flowMod.captureUnmirroredPortrait3x4({
      readyState: 4,
      videoWidth: 0,
      videoHeight: 0,
    }),
    null,
  );
  assert.equal(
    flowMod.captureUnmirroredPortrait3x4({
      readyState: 4,
      videoWidth: 1280,
      videoHeight: 720,
      ended: true,
    }),
    null,
  );

  // Onboarding capture: true unmirrored video dimensions (no scale(-1, 1))
  const readyVideo = {
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    ended: false,
  };
  const onboardingCapture = createFakeCanvas('onboarding');
  const rawFrameUri = flowMod.captureUnmirroredVideoFrame(
    readyVideo,
    () => onboardingCapture.canvas,
  );
  assert.ok(rawFrameUri.startsWith('data:image/jpeg;base64,'));
  assert.equal(onboardingCapture.canvas.width, 1280);
  assert.equal(onboardingCapture.canvas.height, 720);
  assert.equal(
    onboardingCapture.ops.some((op) => op.type === 'scale'),
    false,
  );
  assert.equal(
    onboardingCapture.ops.some((op) => op.type === 'translate'),
    false,
  );
  const rawDraw = onboardingCapture.ops.find((op) => op.type === 'drawImage');
  assert.deepEqual(rawDraw.args.slice(1), [0, 0, 1280, 720]);

  // Staff edit capture: center-cropped 3:4 into 360x480, unmirrored (no scale(-1, 1))
  const staffEditCapture = createFakeCanvas('staff-edit');
  const portraitUri = flowMod.captureUnmirroredPortrait3x4(
    readyVideo,
    () => staffEditCapture.canvas,
  );
  assert.ok(portraitUri.startsWith('data:image/jpeg;base64,'));
  assert.equal(staffEditCapture.canvas.width, 360);
  assert.equal(staffEditCapture.canvas.height, 480);
  assert.equal(
    staffEditCapture.ops.some((op) => op.type === 'scale'),
    false,
  );
  const portraitDraw = staffEditCapture.ops.find(
    (op) => op.type === 'drawImage',
  );
  assert.deepEqual(
    portraitDraw.args.slice(1),
    [370, 0, 540, 720, 0, 0, 360, 480],
  );

  // Onboarding crop/zoom/pan produces 360x480 portrait with zoom=2 applied cleanly
  const cropCanvas = createFakeCanvas('cropped');
  const zoomedUri = flowMod.renderCroppedPortraitDataUrl(
    { width: 1200, height: 1600 },
    2,
    0,
    0,
    () => cropCanvas.canvas,
  );
  assert.ok(zoomedUri.startsWith('data:image/jpeg;base64,'));
  assert.equal(
    cropCanvas.ops.some((op) => op.type === 'scale'),
    false,
  );
  const cropDraw = cropCanvas.ops.find((op) => op.type === 'drawImage');
  assert.deepEqual(
    cropDraw.args.slice(1),
    [300, 400, 600, 800, 0, 0, 360, 480],
  );
});

test('transient inference errors do not poison photo cache, explicit photo clear sends null, and session changes drop stale results', async () => {
  // 1. Transient inference failure is not cached; retry succeeds
  let attempt = 0;
  const validator = flowMod.createPhotoValidationCache(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('Model tải chưa xong');
    }
    return { faceCount: 1, descriptor: new Float32Array([0.4, 0.5]) };
  });

  await assert.rejects(validator.validate(PHOTO_A), /Model tải chưa xong/);
  assert.equal(validator.peek(PHOTO_A), undefined);
  const retried = await validator.validate(PHOTO_A);
  assert.deepEqual(retried, { valid: true, faceCount: 1 });
  assert.equal(attempt, 2);

  // 2. Staff edit explicit photo removal sends idPhotoUrl: null and rejects pasted external URLs
  let savedPayload = null;
  let clearDraft = {
    ...flowMod.createStaffEditDraft({
      memberId: 'mem-clear-1',
      code: 'MEM-CLR00001',
      name: 'Vũ Minh Tuấn',
      rawPhone: '0988777666',
      avatarUrl: PHOTO_A,
    }),
    photoInput: '',
  };
  const clearResult = await flowMod.runStaffMemberEditSave({
    draft: clearDraft,
    setDraft: (updater) => {
      clearDraft = updater(clearDraft);
    },
    validatePhoto: async () => {
      throw new Error('Empty photo must not run face check');
    },
    updateMember: async (_id, payload) => {
      savedPayload = payload;
      return {};
    },
  });
  assert.equal(clearResult.status, 'saved');
  assert.equal(savedPayload.idPhotoUrl, null);
  assert.equal(clearDraft, null);

  let invalidUrlDraft = {
    ...flowMod.createStaffEditDraft({
      memberId: 'mem-url-1',
      code: 'MEM-URL00001',
      name: 'Vũ Minh Tuấn',
      rawPhone: '0988777666',
      avatarUrl: null,
    }),
    photoInput: 'https://example.com/external.jpg',
  };
  const invalidUrlRes = await flowMod.runStaffMemberEditSave({
    draft: invalidUrlDraft,
    setDraft: (updater) => {
      invalidUrlDraft = updater(invalidUrlDraft);
    },
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    updateMember: async () => ({}),
  });
  assert.equal(invalidUrlRes.status, 'validation_failed');
  assert.notEqual(invalidUrlDraft, null);
  assert.ok(invalidUrlDraft.submitError.includes('Webcam'));

  // 3. Session ownership drops late completion when active session moved on
  let activeSessionId = 10;
  let state = flowMod.createInitialOnboardingState(10, '2026-11-12');
  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Đặng Quốc Khánh',
    email: 'khanh@auragym.vn',
  });
  let finishCreate;
  const pending = flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => activeSessionId,
    setState: (updater) => {
      state = updater(state);
    },
    selectedPlan: PLAN_VIP,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: () =>
      new Promise((resolve) => {
        finishCreate = () =>
          resolve(
            makeMemberDetail(
              'mem-stale',
              'MEM-STALE001',
              'Đặng Quốc Khánh',
              'khanh@auragym.vn',
            ),
          );
      }),
    createSubscription: async () => {
      throw new Error('Must not attach subscription to abandoned session');
    },
  });

  // Simulate session ownership transfer (e.g. remount)
  activeSessionId = 11;
  state = flowMod.createInitialOnboardingState(11, '2026-11-12');
  finishCreate();
  const abandoned = await pending;
  assert.equal(abandoned.status, 'abandoned_session');
  assert.equal(state.sessionId, 11);
  assert.equal(state.createdMemberCache, null);
});

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

function createTrackedAbortController() {
  const controller = new AbortController();
  const signal = controller.signal;
  const activeListeners = new Set();
  const rawAdd = signal.addEventListener.bind(signal);
  const rawRemove = signal.removeEventListener.bind(signal);

  signal.addEventListener = (type, listener, options) => {
    if (type === 'abort') {
      activeListeners.add(listener);
    }
    return rawAdd(type, listener, options);
  };
  signal.removeEventListener = (type, listener, options) => {
    if (type === 'abort') {
      activeListeners.delete(listener);
    }
    return rawRemove(type, listener, options);
  };

  return {
    controller,
    signal,
    abortListenerCount: () => activeListeners.size,
  };
}

test('photo validation cache: late reject from aborted job A does not evict replacement job B or trigger duplicate job C', async () => {
  const jobs = [];
  const validator = flowMod.createPhotoValidationCache((_src, signal) => {
    return new Promise((resolve, reject) => {
      jobs.push({ signal, resolve, reject });
    });
  });

  // 1. Subscriber 1 starts job A with signal A, then aborts signal A
  const ctrlA = new AbortController();
  const sub1 = validator.validate(PHOTO_A, ctrlA.signal);
  assert.equal(jobs.length, 1);

  ctrlA.abort();
  await assert.rejects(sub1, { name: 'AbortError' });
  assert.equal(jobs[0].signal.aborted, true);

  // 2. Subscriber 2 validates the same photo before job A settles -> starts replacement job B
  const sub2 = validator.validate(PHOTO_A);
  assert.equal(jobs.length, 2);

  // 3. Retired job A rejects asynchronously later -> must NOT delete job B from inflight
  jobs[0].reject(new DOMException('Aborted', 'AbortError'));
  await flushMicrotasks();

  // 4. Subscriber 3 validates the same photo -> must join job B (inferenceCalls stays 2, not 3)
  const sub3 = validator.validate(PHOTO_A);
  assert.equal(jobs.length, 2);

  jobs[1].resolve({ faceCount: 1, descriptor: new Float32Array([0.7, 0.8]) });
  const [res2, res3] = await Promise.all([sub2, sub3]);
  assert.deepEqual(res2, { valid: true, faceCount: 1 });
  assert.deepEqual(res3, { valid: true, faceCount: 1 });
  assert.deepEqual(validator.peek(PHOTO_A), { valid: true, faceCount: 1 });
});

test('photo validation cache: late resolve after abort or clear never refills cache or clobbers replacement jobs', async () => {
  const jobs = [];
  const validator = flowMod.createPhotoValidationCache((_src, signal) => {
    return new Promise((resolve, reject) => {
      jobs.push({ signal, resolve, reject });
    });
  });

  // Case 1: Late resolve after sole-subscriber abort (with no replacement yet) must not populate cache
  const ctrl1 = new AbortController();
  const p1 = validator.validate(PHOTO_A, ctrl1.signal);
  ctrl1.abort();
  await assert.rejects(p1, { name: 'AbortError' });

  jobs[0].resolve({ faceCount: 1, descriptor: new Float32Array([0.1, 0.2]) });
  await flushMicrotasks();
  assert.equal(validator.peek(PHOTO_A), undefined);

  // Case 2: Late resolve after abort when replacement job B is already running
  const ctrl2 = new AbortController();
  const p2 = validator.validate(PHOTO_A, ctrl2.signal);
  assert.equal(jobs.length, 2);
  ctrl2.abort();
  await assert.rejects(p2, { name: 'AbortError' });

  const replacementWaiter = validator.validate(PHOTO_A);
  assert.equal(jobs.length, 3);

  // Retired job[1] resolves late with valid=true, while replacement job[2] will resolve valid=false
  jobs[1].resolve({ faceCount: 1, descriptor: new Float32Array([0.9]) });
  await flushMicrotasks();
  assert.equal(validator.peek(PHOTO_A), undefined);

  // Another caller still joins replacement job[2], not cached stale job[1] and not a new job[3]
  const joinedReplacement = validator.validate(PHOTO_A);
  assert.equal(jobs.length, 3);

  jobs[2].resolve({ faceCount: 2, descriptor: null });
  const [repOut1, repOut2] = await Promise.all([
    replacementWaiter,
    joinedReplacement,
  ]);
  assert.deepEqual(repOut1, { valid: false, faceCount: 2 });
  assert.deepEqual(repOut2, { valid: false, faceCount: 2 });
  assert.deepEqual(validator.peek(PHOTO_A), { valid: false, faceCount: 2 });

  // Case 3: Late resolve after clear() must not refill settledCache or evict post-clear job
  const preClearWaiter = validator.validate(PHOTO_B);
  assert.equal(jobs.length, 4);

  validator.clear();
  await assert.rejects(preClearWaiter, { name: 'AbortError' });
  assert.equal(validator.peek(PHOTO_A), undefined);

  const postClearWaiter = validator.validate(PHOTO_B);
  assert.equal(jobs.length, 5);

  // Pre-clear job[3] resolves late -> must neither refill cache nor evict post-clear job[4]
  jobs[3].resolve({ faceCount: 1, descriptor: new Float32Array([0.3]) });
  await flushMicrotasks();
  assert.equal(validator.peek(PHOTO_B), undefined);

  const postClearJoiner = validator.validate(PHOTO_B);
  assert.equal(jobs.length, 5);

  jobs[4].resolve({ faceCount: 1, descriptor: new Float32Array([0.5]) });
  assert.deepEqual(await postClearWaiter, { valid: true, faceCount: 1 });
  assert.deepEqual(await postClearJoiner, { valid: true, faceCount: 1 });
});

test('photo validation cache: clear settles all waiting subscribers, one abort keeps co-subscribers alive, and listeners detach on settlement', async () => {
  const jobs = [];
  const validator = flowMod.createPhotoValidationCache((_src, signal) => {
    return new Promise((resolve, reject) => {
      jobs.push({ signal, resolve, reject });
    });
  });

  // 1. One subscriber aborting does not cancel remaining subscriber; remaining listener detaches on resolve
  const trackedAborting = createTrackedAbortController();
  const trackedSurviving = createTrackedAbortController();

  const waiterAborting = validator.validate(PHOTO_A, trackedAborting.signal);
  const waiterSurviving = validator.validate(PHOTO_A, trackedSurviving.signal);
  assert.equal(jobs.length, 1);
  assert.equal(trackedAborting.abortListenerCount(), 1);
  assert.equal(trackedSurviving.abortListenerCount(), 1);

  trackedAborting.controller.abort();
  await assert.rejects(waiterAborting, { name: 'AbortError' });
  assert.equal(jobs[0].signal.aborted, false);
  assert.equal(trackedSurviving.abortListenerCount(), 1);

  jobs[0].resolve({ faceCount: 1, descriptor: new Float32Array([0.2, 0.3]) });
  assert.deepEqual(await waiterSurviving, { valid: true, faceCount: 1 });
  assert.equal(trackedSurviving.abortListenerCount(), 0);

  // 2. Listener detaches on normal job rejection as well
  validator.clear();
  const trackedRejectSub = createTrackedAbortController();
  const rejectWaiter = validator.validate(PHOTO_A, trackedRejectSub.signal);
  assert.equal(trackedRejectSub.abortListenerCount(), 1);

  jobs[1].reject(new Error('Inference failure'));
  await assert.rejects(rejectWaiter, /Inference failure/);
  assert.equal(trackedRejectSub.abortListenerCount(), 0);

  // 3. clear() settles waiting subscribers (with or without caller signal) with AbortError and detaches listeners
  const trackedClearSub = createTrackedAbortController();
  const signaledWaiter = validator.validate(PHOTO_A, trackedClearSub.signal);
  const unsignaledWaiter = validator.validate(PHOTO_B);
  assert.equal(trackedClearSub.abortListenerCount(), 1);

  validator.clear();
  await assert.rejects(signaledWaiter, { name: 'AbortError' });
  await assert.rejects(unsignaledWaiter, { name: 'AbortError' });
  assert.equal(trackedClearSub.abortListenerCount(), 0);
  assert.equal(jobs[2].signal.aborted, true);
  assert.equal(jobs[3].signal.aborted, true);
});

test('duplicate face response keeps onboarding data and matching profile links until the photo changes', async () => {
  let state = flowMod.createInitialOnboardingState(1, '2026-11-12');
  state = flowMod.updateOnboardingIdentityFields(state, {
    fullName: 'Test Member',
    email: 'test@example.invalid',
    phone: '0901234567',
    photoDataUrl: PHOTO_A,
  });
  state = flowMod.updateOnboardingPlanFields(state, { attachPlan: false });
  const conflicts = [
    { memberId: 'other', memberCode: 'MEM-OTHER', fullName: 'Other Member' },
  ];
  const error = Object.assign(new Error('Ảnh nghi trùng khuôn mặt'), {
    details: { code: 'DUPLICATE_MEMBER_FACE', conflicts },
  });
  const result = await flowMod.runOnboardingSubmission({
    snapshot: state,
    getCurrentSessionId: () => state.sessionId,
    setState: (update) => {
      state = update(state);
    },
    selectedPlan: null,
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    createMember: async () => {
      throw error;
    },
    createSubscription: async () => {
      throw new Error('Unexpected subscription');
    },
  });
  assert.equal(result.status, 'member_failed');
  assert.equal(state.fields.photoDataUrl, PHOTO_A);
  assert.equal(state.fields.fullName, 'Test Member');
  assert.equal(state.activeStep, 2);
  assert.deepEqual(state.fieldErrors.conflicts, conflicts);
  state.cameraNotice = 'Old warning';
  state = flowMod.updateOnboardingIdentityFields(state, {
    photoDataUrl: PHOTO_B,
  });
  assert.equal(state.fieldErrors.conflicts, undefined);
  assert.equal(state.fieldErrors.general, undefined);
  assert.equal(state.cameraNotice, null);
});

test('duplicate face response keeps staff edit open with original input and conflict details', async () => {
  let draft = flowMod.createStaffEditDraft({
    memberId: 'self',
    code: 'MEM-SELF',
    name: 'Self',
    rawPhone: '',
    avatarUrl: null,
  });
  draft.photoInput = PHOTO_A;
  const conflicts = [
    { memberId: 'other', memberCode: 'MEM-OTHER', fullName: 'Other Member' },
  ];
  const result = await flowMod.runStaffMemberEditSave({
    draft,
    setDraft: (update) => {
      draft = update(draft);
    },
    validatePhoto: async () => ({ valid: true, faceCount: 1 }),
    updateMember: async () => {
      throw Object.assign(new Error('Ảnh nghi trùng khuôn mặt'), {
        details: { conflicts },
      });
    },
  });
  assert.equal(result.status, 'save_failed');
  assert.equal(draft.photoInput, PHOTO_A);
  assert.equal(draft.isSubmitting, false);
  assert.deepEqual(draft.conflicts, conflicts);
});
