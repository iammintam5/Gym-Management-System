/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

// Run the production provider with deterministic hooks and real QueryObservers.
// Child subscriptions start before parent passive effects, as they do in React.
function runtime() {
  let userId;
  let scope;
  let cursor;
  let sessionKey;
  let sessionState = [];
  const rootState = [];
  const effects = [];
  const effectDeps = [];
  let effectCursor;
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../src/providers/query-provider.tsx'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'react')
        return {
          useState(initial) {
            const index = cursor++;
            if (!(index in scope))
              scope[index] =
                typeof initial === 'function' ? initial() : initial;
            return [
              scope[index],
              (value) => {
                scope[index] = value;
              },
            ];
          },
          useEffect(fn, deps) {
            const index = effectCursor++;
            if (
              !effectDeps[index] ||
              deps.some((value, i) => value !== effectDeps[index][i])
            ) {
              effectDeps[index] = deps;
              effects.push(fn);
            }
          },
        };
      if (name.includes('auth-store'))
        return {
          useAuthStore: (selector) =>
            selector({ user: userId ? { id: userId } : null }),
        };
      if (name.includes('api-client')) return { clearApiClientCache() {} };
      return require(name);
    },
  });
  return {
    render(identity) {
      userId = identity;
      scope = rootState;
      cursor = 0;
      effectCursor = 0;
      let element = exports.QueryProvider({ children: null });
      if (!element.props.client) {
        if (sessionKey !== element.key) {
          sessionState = [];
          sessionKey = element.key;
        }
        scope = sessionState;
        cursor = 0;
        element = element.type(element.props);
      }
      const client = element.props.client;
      client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } });
      return client;
    },
    flushEffects() {
      for (const effect of effects.splice(0)) effect();
    },
  };
}

function observe(client, value) {
  const observer = new query.QueryObserver(client, {
    queryKey: ['camera-members'],
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(value), 10);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

test('opening camera does not cancel the initial roster request in parent effects', async () => {
  const app = runtime();
  const client = app.render('staff-a');
  const { observer, unsubscribe } = observe(client, ['member-a']);
  try {
    app.flushEffects();
    await wait();
    assert.equal(observer.getCurrentResult().status, 'success');
    assert.deepEqual(observer.getCurrentResult().data, ['member-a']);
    assert.equal(client.getQueryCache().getAll().length, 1);
    assert.equal(app.render('staff-a'), client);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test('auth hydration, account changes and logout use fresh clients and complete roster loading', async () => {
  const app = runtime();
  let previous;
  for (const identity of [
    undefined,
    'staff-a',
    'staff-b',
    undefined,
    'staff-a',
  ]) {
    const client = app.render(identity);
    assert.notEqual(client, previous);
    assert.equal(client.getQueryData(['camera-members']), undefined);
    const { observer, unsubscribe } = observe(client, [
      identity ?? 'anonymous',
    ]);
    try {
      app.flushEffects();
      await wait();
      assert.equal(observer.getCurrentResult().status, 'success');
      assert.deepEqual(observer.getCurrentResult().data, [
        identity ?? 'anonymous',
      ]);
    } finally {
      unsubscribe();
      client.clear();
    }
    previous = client;
  }
});
