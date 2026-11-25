/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { text } = require('./helpers/component-harness.cjs');
test('public Gym catalog never advertises retired PT from cached descriptions or entitlements', () => {
  const data = [
    {
      id: 'gym',
      name: 'Gym Basic',
      price: 590000,
      durationDays: 30,
      description: 'Gym with 4 buổi PT 1-1',
      entitlements: [
        {
          service: 'GYM_ACCESS',
          serviceName: 'Full Gym',
          limitType: 'UNLIMITED',
        },
        {
          service: 'CLASS',
          serviceName: 'Yoga',
          limitType: 'COUNT',
          limitValue: 8,
        },
        {
          service: 'PT',
          serviceName: 'PT 1-1',
          limitType: 'COUNT',
          limitValue: 4,
        },
      ],
    },
  ];
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(
      path.join(
        __dirname,
        '../src/features/membership-plans/public-plans-section.tsx',
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react/jsx-runtime')
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === '@tanstack/react-query')
        return { useQuery: () => ({ data, isLoading: false, isError: false }) };
      if (name === 'next/link') return { default: 'a' };
      if (name === '@/components/shared/data-state')
        return { DataState: 'DataState' };
      if (name === '@/services/api-client')
        return {
          apiClient: () => {
            throw Error('Unexpected request');
          },
        };
      throw Error('Unexpected import ' + name);
    },
  });
  const rendered = text(exports.PublicPlansSection());
  assert.match(rendered, /Gym Basic/);
  assert.match(rendered, /Full Gym/);
  assert.match(rendered, /Yoga/);
  assert.match(rendered, /8 buổi/);
  assert.doesNotMatch(rendered, /PT|1-1/);
});
