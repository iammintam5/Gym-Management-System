/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contracts = require('@gym/contracts');
const { randomUUID } = require('node:crypto');

function load(file, imports, testWindow) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    module: { exports },
    require: imports,
    AbortController,
    URLSearchParams,
    Error,
    Date,
    Intl,
    crypto: { randomUUID },
    window: testWindow,
  });
  return exports;
}

function harness(file, apiClient) {
  apiClient.get ??= apiClient;
  const states = [],
    refs = [],
    effectDeps = [],
    timers = new Map();
  let stateCursor = 0,
    refCursor = 0,
    effectCursor = 0,
    timerId = 0;
  const effects = [];
  const react = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn, deps) {
      const index = effectCursor++;
      if (
        !effectDeps[index] ||
        deps.some((value, key) => value !== effectDeps[index][key])
      ) {
        effectDeps[index] = deps;
        effects.push(fn);
      }
    },
  };
  const window = {
    setTimeout(fn) {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    confirm: () => true,
  };
  const requestKeys = load(
    'src/lib/staff-request-key.ts',
    () => {
      throw Error('Unexpected import');
    },
    window,
  );
  const loadedModule = load(
    file,
    (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime')
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
          Fragment: 'Fragment',
        };
      if (name === '@gym/contracts') return contracts;
      if (name === '@/stores/auth-store')
        return {
          useAuthStore: (selector) => selector({ user: { roles: ['ADMIN'] } }),
        };
      if (name === '@/services/api-client')
        return { apiClient, ApiClientError: Error };
      if (name === '@/features/pt-bookings/staff-pt-booking')
        return { StaffPtBookingButton: 'StaffPtBookingButton' };
      if (name === '@/lib/staff-date') return { staffDate: () => '2099-01-01' };
      if (name === '@/lib/staff-request-key') return requestKeys;
      if (name === '@/lib/formatters')
        return {
          formatVnd: (value) => value + 'đ',
          formatDurationVi: (days) => days + ' ngày',
        };
      if (name === '@/lib/utils') return { formatReceiptNumber: (id) => id };
      if (name === 'lucide-react')
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/components/ui/modal-frame')
        return { ModalFrame: 'ModalFrame' };
      if (name === '@/components/shared/domain-status-badge')
        return {
          FreezeStatusBadge: 'FreezeStatusBadge',
          PaymentStatusBadge: 'PaymentStatusBadge',
        };
      if (name === '@/components/shared/data-state')
        return {
          DataState: 'DataState',
          assertDataLoaded: (results) => {
            for (const result of results)
              if (result.status === 'rejected') throw result.reason;
          },
        };
      if (name === '@/components/ui/staff-form-modal')
        return { StaffFormModal: 'StaffFormModal' };
      if (name === '@/components/shared/table-pagination')
        return { TablePagination: 'TablePagination' };
      throw Error('Unexpected import ' + name);
    },
    window,
  );
  return {
    render(component, props) {
      stateCursor = refCursor = effectCursor = 0;
      return loadedModule[component](props);
    },
    async flush() {
      for (const effect of effects.splice(0)) effect();
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer();
      }
      for (let index = 0; index < 10; index++)
        await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.footer)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}

module.exports = { harness, nodes, text };
