/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contracts = require('@gym/contracts');

function loadWebModule(relativePath, bindings = {}, jsx = false) {
  const filename = path.join(__dirname, '..', relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  }).outputText;
  const exports = {};
  const mod = { exports };
  vm.runInNewContext(code, {
    exports,
    module: mod,
    Buffer,
    URL,
    ...bindings,
    require(name) {
      if (name === '@gym/contracts') return contracts;
      if (bindings.__require) return bindings.__require(name);
      throw new Error(`Unexpected require in ${relativePath}: ${name}`);
    },
  });
  return mod.exports;
}

function toHost(value) {
  if (Array.isArray(value)) return Array.from(value, toHost);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toHost(v);
    }
    return out;
  }
  return value;
}

test('employee-form.ts enforces role creation defaults, real edit hydration, and payload building', () => {
  const rawForm = loadWebModule('src/features/trainers/employee-form.ts');
  const form = Object.fromEntries(
    Object.entries(rawForm).map(([k, fn]) => [
      k,
      typeof fn === 'function' ? (...args) => toHost(fn(...args)) : fn,
    ]),
  );

  const trainerInitial = form.createInitialEmployeeFormState(
    'trainers',
    '2026-11-16',
  );
  assert.equal(trainerInitial.role, contracts.UserRole.TRAINER);
  assert.equal(trainerInitial.canTeachClasses, true);
  assert.equal(trainerInitial.canCoachPt, false);
  assert.deepEqual(trainerInitial.specialties, []);

  const staffInitial = form.createInitialEmployeeFormState(
    'staff',
    '2026-11-16',
  );
  assert.equal(staffInitial.role, contracts.UserRole.STAFF);
  assert.equal(staffInitial.canTeachClasses, false);
  assert.equal(staffInitial.canCoachPt, false);
  assert.deepEqual(staffInitial.specialties, []);

  // Switching role STAFF -> TRAINER enables default trainer capabilities; TRAINER -> STAFF clears them
  const promoted = form.applyEmployeeFormRoleChange(
    staffInitial,
    contracts.UserRole.TRAINER,
  );
  assert.equal(promoted.canTeachClasses, true);
  assert.equal(promoted.canCoachPt, false);

  const demoted = form.applyEmployeeFormRoleChange(
    promoted,
    contracts.UserRole.STAFF,
  );
  assert.equal(demoted.canTeachClasses, false);
  assert.equal(demoted.canCoachPt, false);

  // Hydrating existing detail preserves blank specialization/specialties without inventing placeholders
  const blankTrainerState = form.employeeDetailToFormState({
    id: 'emp-1',
    userId: 'usr-1',
    employeeCode: 'EMP-00000001',
    fullName: 'Coach Blank',
    phone: null,
    specialization: null,
    specialties: [],
    canTeachClasses: true,
    canCoachPt: false,
    hiredAt: '2025-02-01',
    email: 'blank@gym.local',
    isActive: true,
    roles: [contracts.UserRole.TRAINER],
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
  });
  assert.deepEqual(blankTrainerState.specialties, []);
  assert.equal(blankTrainerState.canTeachClasses, true);
  assert.equal(blankTrainerState.canCoachPt, false);

  // Create payload commits pending comma-separated specialty draft and builds summary
  const createTrainerPayload = form.buildCreateEmployeePayload({
    ...trainerInitial,
    fullName: '  Coach Bao  ',
    email: '  bao@gym.local ',
    specialties: ['Boxing'],
    specialtyDraft: 'HIIT, boxing, Strength',
    canTeachClasses: true,
    canCoachPt: false,
  });
  assert.deepEqual(createTrainerPayload, {
    fullName: 'Coach Bao',
    email: 'bao@gym.local',
    role: contracts.UserRole.TRAINER,
    password: undefined,
    phone: undefined,
    hiredAt: '2026-11-16',
    specialties: ['Boxing', 'HIIT', 'Strength'],
    specialization: 'Boxing, HIIT, Strength',
    canTeachClasses: true,
    canCoachPt: false,
  });

  // Create staff payload omits trainer capabilities and specialties
  const createStaffPayload = form.buildCreateEmployeePayload({
    ...staffInitial,
    fullName: 'Le Tan A',
    email: 'staff.a@gym.local',
    staffNote: 'Ca sáng',
  });
  assert.equal('canTeachClasses' in createStaffPayload, false);
  assert.equal('canCoachPt' in createStaffPayload, false);
  assert.equal('specialties' in createStaffPayload, false);
  assert.equal(createStaffPayload.specialization, 'Ca sáng');

  // Update submission emits rolePatch when role changed and strips capabilities when changed to STAFF
  const editSubmission = form.buildUpdateEmployeeSubmission({
    ...blankTrainerState,
    role: contracts.UserRole.STAFF,
    staffNote: 'Chuyển bộ phận lễ tân',
  });
  assert.deepEqual(editSubmission.rolePatch, [contracts.UserRole.STAFF]);
  assert.equal('canTeachClasses' in editSubmission.profilePatch, false);
  assert.equal('canCoachPt' in editSubmission.profilePatch, false);
  assert.equal(
    editSubmission.profilePatch.specialization,
    'Chuyển bộ phận lễ tân',
  );

  // Service badges
  assert.deepEqual(
    form.formatTrainerServicesBadges({
      canTeachClasses: true,
      canCoachPt: false,
    }),
    [{ label: 'Lớp nhóm', tone: 'orange' }],
  );
  assert.deepEqual(
    form.formatTrainerServicesBadges({
      canTeachClasses: false,
      canCoachPt: false,
    }),
    [{ label: 'Tạm ngưng nhận lịch', tone: 'muted' }],
  );
});

test('dashboard-shell.tsx shows read-only service scope to TRAINER and omits capability flags on self PATCH', async () => {
  const apiCalls = [];
  const stateValues = [
    false, // mobileMenuOpen
    false, // notifOpen
    [], // notifications
    true, // accountModalOpen
    'profile', // accountTab
    'Coach Bao', // profileFullName
    '0903334455', // profilePhone
    '', // profileDob
    'Boxing & Conditioning', // profileSpecialization
    true, // profileCanTeachClasses
    false, // profileCanCoachPt
    '', // currentPassword
    '', // newPassword
    '', // confirmPassword
    '', // profileSavedMsg
    '', // profileErrorMsg
    false, // savingAccount
  ];
  let stateCursor = 0;

  const iconProxy = new Proxy({}, { get: (_, prop) => String(prop) });
  const el = (type, props) => ({ type, props });

  const shell = loadWebModule(
    'src/components/layout/dashboard-shell.tsx',
    {
      setTimeout: () => 0,
      __require(name) {
        if (name === 'react') {
          return {
            useState: (initial) => {
              const val =
                stateCursor < stateValues.length
                  ? stateValues[stateCursor]
                  : initial;
              stateCursor += 1;
              return [val, () => {}];
            },
            useEffect: () => {},
            useRef: (v) => ({ current: v }),
          };
        }
        if (name === 'react/jsx-runtime') {
          return { jsx: el, jsxs: el, Fragment: 'Fragment' };
        }
        if (name === 'next/link') return { __esModule: true, default: 'Link' };
        if (name === 'next/navigation') {
          return {
            usePathname: () => '/dashboard/schedule',
            useRouter: () => ({ replace: () => {} }),
          };
        }
        if (name === 'lucide-react') return iconProxy;
        if (name === '@/stores/auth-store') {
          return {
            useAuthStore: () => ({
              user: {
                id: 'trainer-u1',
                email: 'pt@gym.com',
                roles: [contracts.UserRole.TRAINER],
                fullName: 'Coach Bao',
              },
              setUser: () => {},
              logout: () => {},
            }),
          };
        }
        if (name === '@/lib/auth-tokens') return { clearTokens: () => {} };
        if (name === '@/services/api-client') {
          return {
            ApiError: Error,
            apiClient: async (url, init) => {
              apiCalls.push({ url, init });
              return {};
            },
          };
        }
        if (name === '@/lib/utils') {
          return { cn: (...parts) => parts.filter(Boolean).join(' ') };
        }
        if (name === '@/components/ui/modal-frame') {
          return { ModalFrame: 'ModalFrame' };
        }
        throw new Error(`Unexpected require: ${name}`);
      },
    },
    true,
  );

  const tree = shell.DashboardShell({ children: null });

  const texts = [];
  const inputs = [];
  const buttons = [];
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
    if (typeof node === 'object') {
      if (node.type === 'input') inputs.push(node.props || {});
      if (node.type === 'button') buttons.push(node.props || {});
      if (node.props?.children !== undefined) walk(node.props.children);
    }
  };
  walk(tree);

  const combinedText = texts.join(' ');
  assert.ok(combinedText.includes('Dịch vụ phụ trách:'));
  assert.ok(combinedText.includes('Lớp nhóm'));
  assert.ok(
    combinedText.includes('Phạm vi phụ trách dịch vụ do Quản trị viên cấp.'),
  );
  // No editable checkbox for service capabilities in self-profile modal
  assert.equal(
    inputs.some((p) => p.type === 'checkbox'),
    false,
  );

  const saveBtn = buttons.find((b) =>
    String(b.children || '').includes('Lưu thay đổi'),
  );
  assert.ok(saveBtn && typeof saveBtn.onClick === 'function');
  await saveBtn.onClick();

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].url, '/employees/me');
  assert.equal(apiCalls[0].init.method, 'PATCH');
  const sentBody = JSON.parse(apiCalls[0].init.body);
  assert.deepEqual(sentBody, {
    fullName: 'Coach Bao',
    phone: '0903334455',
    specialization: 'Boxing & Conditioning',
  });
  assert.equal('canTeachClasses' in sentBody, false);
  assert.equal('canCoachPt' in sentBody, false);
});

test('create and edit payloads accept the supported maximum specialty list', () => {
  const form = loadWebModule('src/features/trainers/employee-form.ts');
  const specialties = Array.from(
    { length: 12 },
    (_, index) => String(index).padStart(2, '0') + 'a'.repeat(98),
  );
  const state = {
    ...form.createInitialEmployeeFormState('trainers'),
    fullName: 'Coach Long',
    email: 'long@example.invalid',
    specialties,
  };
  const create = form.buildCreateEmployeePayload(state);
  const update = form.buildUpdateEmployeeSubmission(state).profilePatch;
  for (const payload of [create, update]) {
    assert.deepEqual(toHost(payload.specialties), specialties);
    assert.ok(
      Array.from(payload.specialization).length <=
        contracts.GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH,
    );
  }
});
