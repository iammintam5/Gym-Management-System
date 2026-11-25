/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contracts = require('@gym/contracts');
const zustand = require('zustand');
const zustandMiddleware = require('zustand/middleware');

function transpileWebFile(relativePath, jsx = false) {
  const filename = path.join(__dirname, '..', relativePath);
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  }).outputText;
}

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

test('proxy.ts normalizes legacy PT cookies to TRAINER, keeps URLs stable, and clears invalid-only role cookies', () => {
  const exports = {};
  const code = transpileWebFile('src/proxy.ts');
  const NextResponse = {
    redirect(url) {
      const deleted = [];
      return {
        type: 'redirect',
        location: url.toString(),
        cookies: {
          deleted,
          delete(name) {
            deleted.push(name);
          },
        },
      };
    },
    next() {
      return { type: 'next', cookies: { deleted: [] } };
    },
  };

  vm.runInNewContext(code, {
    exports,
    Buffer,
    URL,
    require(name) {
      if (name === 'next/server') return { NextResponse };
      if (name === '@gym/contracts') return contracts;
      if (name === './lib/auth-tokens')
        return { ACCESS_TOKEN_KEY: 'accessToken' };
      throw new Error(`Unexpected require in proxy.ts: ${name}`);
    },
  });

  const makeReq = (pathname, token) => ({
    url: `http://localhost:3000${pathname}`,
    nextUrl: new URL(`http://localhost:3000${pathname}`),
    cookies: {
      get(name) {
        return name === 'accessToken' && token ? { value: token } : undefined;
      },
    },
  });

  for (const role of ['PT', 'TRAINER']) {
    const token = makeJwt({ sub: 'u-trainer', roles: [role], type: 'access' });
    assert.deepEqual(
      exports.proxy(makeReq('/login', token)).location,
      'http://localhost:3000/dashboard/schedule',
    );
    assert.equal(exports.proxy(makeReq('/dashboard/pt', token)).type, 'next');
    assert.equal(
      exports.proxy(makeReq('/dashboard/schedule', token)).type,
      'next',
    );
    assert.equal(
      exports.proxy(makeReq('/dashboard/trainer', token)).location,
      'http://localhost:3000/dashboard/schedule',
    );
    assert.equal(
      exports.proxy(makeReq('/camera', token)).location,
      'http://localhost:3000/dashboard/schedule',
    );
  }

  const adminToken = makeJwt({ sub: 'u-admin', roles: ['ADMIN'], type: 'access' });
  assert.equal(
    exports.proxy(makeReq('/dashboard/trainer', adminToken)).type,
    'next',
  );

  const invalidToken = makeJwt({
    sub: 'u-bad',
    roles: ['UNKNOWN'],
    type: 'access',
  });
  const dashboardBad = exports.proxy(makeReq('/dashboard/pt', invalidToken));
  assert.equal(dashboardBad.type, 'redirect');
  assert.equal(dashboardBad.location, 'http://localhost:3000/login');
  assert.deepEqual(dashboardBad.cookies.deleted, ['accessToken']);
  assert.equal(exports.proxy(makeReq('/login', invalidToken)).type, 'next');
});

test('auth-store.ts normalizes legacy persisted PT roles to TRAINER and clears invalid persisted roles', async () => {
  const loadStoreWithInitialStorage = (initialValue) => {
    const map = new Map();
    if (initialValue !== undefined) {
      map.set('auth-storage', JSON.stringify(initialValue));
    }
    const localStorage = {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, val) => {
        map.set(key, String(val));
      },
      removeItem: (key) => {
        map.delete(key);
      },
    };
    const exports = {};
    const code = transpileWebFile('src/stores/auth-store.ts');
    const win = { localStorage };
    vm.runInNewContext(code, {
      exports,
      window: win,
      localStorage,
      require(name) {
        if (name === 'zustand') return zustand;
        if (name === 'zustand/middleware') return zustandMiddleware;
        if (name === '@gym/contracts') return contracts;
        throw new Error(`Unexpected require in auth-store.ts: ${name}`);
      },
    });
    return { exports, map };
  };

  const legacyHydrated = loadStoreWithInitialStorage({
    state: {
      user: {
        id: 'trainer-1',
        email: 'pt@gym.com',
        isActive: true,
        roles: ['PT'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      isAuthenticated: true,
    },
    version: 0,
  });

  await Promise.resolve();
  assert.deepEqual(
    legacyHydrated.exports.useAuthStore.getState().user.roles,
    ['TRAINER'],
  );
  assert.equal(
    legacyHydrated.exports.useAuthStore.getState().isAuthenticated,
    true,
  );
  const rewritten = JSON.parse(legacyHydrated.map.get('auth-storage'));
  assert.deepEqual(rewritten.state.user.roles, ['TRAINER']);

  for (const badRoles of [['UNKNOWN'], []]) {
    const corrupted = loadStoreWithInitialStorage({
      state: {
        user: {
          id: 'bad-1',
          email: 'bad@gym.com',
          isActive: true,
          roles: badRoles,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        isAuthenticated: true,
      },
      version: 0,
    });
    await Promise.resolve();
    assert.equal(corrupted.exports.useAuthStore.getState().user, null);
    assert.equal(
      corrupted.exports.useAuthStore.getState().isAuthenticated,
      false,
    );
    const cleared = JSON.parse(corrupted.map.get('auth-storage'));
    assert.equal(cleared.state.user, null);
    assert.equal(cleared.state.isAuthenticated, false);
  }
});

test('login-form.tsx resolveRoleDashboardPath maps TRAINER and legacy PT to /dashboard/schedule', () => {
  const exports = {};
  const code = transpileWebFile('src/features/auth/login-form.tsx', true);
  vm.runInNewContext(code, {
    exports,
    process: { env: { NODE_ENV: 'test' } },
    require(name) {
      if (name === 'react') return { useState: (v) => [v, () => {}] };
      if (name === 'react/jsx-runtime') {
        const el = (type, props) => ({ type, props });
        return { jsx: el, jsxs: el, Fragment: 'Fragment' };
      }
      if (name === '@gym/contracts') return contracts;
      if (name === 'zod')
        return {
          z: {
            object: () => ({}),
            email: () => ({ max: () => ({}) }),
            string: () => ({ min: () => ({ max: () => ({}) }) }),
          },
        };
      if (name === 'react-hook-form') return { useForm: () => ({}) };
      if (name === '@hookform/resolvers/zod') return { zodResolver: () => ({}) };
      if (name === 'next/navigation') return { useRouter: () => ({}) };
      if (name === '@/services/api-client')
        return { ApiError: Error, apiClient: () => {} };
      if (name === '@/stores/auth-store')
        return { useAuthStore: (sel) => sel({ setUser: () => {} }) };
      if (name === '@/lib/auth-tokens')
        return {
          setToken: () => {},
          ACCESS_TOKEN_KEY: 'accessToken',
          REFRESH_TOKEN_KEY: 'refreshToken',
        };
      if (name === '@/components/ui/button') return { Button: 'button' };
      if (name === 'lucide-react')
        return { Loader2: 'Loader2', Eye: 'Eye', EyeOff: 'EyeOff' };
      throw new Error(`Unexpected require in login-form.tsx: ${name}`);
    },
  });

  assert.equal(
    exports.resolveRoleDashboardPath([contracts.UserRole.TRAINER]),
    '/dashboard/schedule',
  );
  assert.equal(
    exports.resolveRoleDashboardPath(['PT']),
    '/dashboard/schedule',
  );
  assert.equal(
    exports.resolveRoleDashboardPath([contracts.UserRole.STAFF]),
    '/dashboard/staff',
  );
  assert.equal(
    exports.resolveRoleDashboardPath([contracts.UserRole.ADMIN]),
    '/dashboard',
  );
  assert.equal(
    exports.resolveRoleDashboardPath([contracts.UserRole.MEMBER]),
    '/dashboard/member',
  );
});

test('dashboard-shell.tsx renames Admin personnel nav to Nhân sự while preserving /dashboard/trainer and TRAINER navigation', () => {
  const renderForRoles = (roles) => {
    const exports = {};
    const code = transpileWebFile(
      'src/components/layout/dashboard-shell.tsx',
      true,
    );
    const iconProxy = new Proxy(
      {},
      {
        get: (_, prop) => String(prop),
      },
    );
    vm.runInNewContext(code, {
      exports,
      require(name) {
        if (name === 'react')
          return {
            useState: (v) => [v, () => {}],
            useEffect: () => {},
            useRef: (v) => ({ current: v }),
          };
        if (name === 'react/jsx-runtime') {
          const el = (type, props) => ({ type, props });
          return { jsx: el, jsxs: el, Fragment: 'Fragment' };
        }
        if (name === 'next/link') return { __esModule: true, default: 'Link' };
        if (name === 'next/navigation')
          return {
            usePathname: () => '/dashboard/trainer',
            useRouter: () => ({ replace: () => {} }),
          };
        if (name === 'lucide-react') return iconProxy;
        if (name === '@gym/contracts') return contracts;
        if (name === '@/stores/auth-store')
          return {
            useAuthStore: () => ({
              user: { id: 'user-1', email: 'u@gym.com', roles },
              setUser: () => {},
              logout: () => {},
            }),
          };
        if (name === '@/lib/auth-tokens') return { clearTokens: () => {} };
        if (name === '@/services/api-client')
          return { ApiError: Error, apiClient: async () => ({}) };
        if (name === '@/lib/utils')
          return { cn: (...parts) => parts.filter(Boolean).join(' ') };
        if (name === '@/components/ui/modal-frame')
          return { ModalFrame: 'ModalFrame' };
        throw new Error(`Unexpected require in dashboard-shell.tsx: ${name}`);
      },
    });

    const tree = exports.DashboardShell({ children: null });
    const links = [];
    const extractText = (node) => {
      if (node == null || typeof node === 'boolean') return '';
      if (typeof node === 'string' || typeof node === 'number')
        return String(node);
      if (Array.isArray(node)) return node.map(extractText).join('');
      return extractText(node.props?.children);
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (node.type === 'Link' && node.props?.href) {
        links.push({
          href: node.props.href,
          label: extractText(node.props.children),
        });
      }
      if (node.props?.children) walk(node.props.children);
    };
    walk(tree);
    return links;
  };

  const adminLinks = renderForRoles([contracts.UserRole.ADMIN]);
  const personnelNav = adminLinks.find((l) => l.href === '/dashboard/trainer');
  assert.ok(personnelNav, 'Admin sidebar must keep /dashboard/trainer link');
  assert.equal(personnelNav.label, 'Nhân sự');

  const trainerLinks = renderForRoles([contracts.UserRole.TRAINER]);
  assert.ok(!trainerLinks.some((l) => l.href === '/dashboard/pt'));
  assert.ok(trainerLinks.some((l) => l.href === '/dashboard/schedule'));
  assert.ok(!trainerLinks.some((l) => l.href === '/dashboard/trainer'));

  const legacyPtLinks = renderForRoles(['PT']);
  assert.ok(!legacyPtLinks.some((l) => l.href === '/dashboard/pt'));
  assert.ok(legacyPtLinks.some((l) => l.href === '/dashboard/schedule'));
});
