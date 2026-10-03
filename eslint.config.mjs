import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import moduleBoundaries from './eslint-rules/module-boundaries.mjs';

// Architecture rules (CLAUDE.md, "Module rules"). Tested in eslint-rules/architecture.test.ts.

const clockMessage =
  'Business logic never reads the system clock. Take "now" as a parameter or a Clock (src/lib/clock.ts).';

const frameworkMessage =
  'Modules contain no Next.js or React code, so the worker and tests can use them. Keep it in src/app.';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // (b) Modules are imported only through their index.ts.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { chairside: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'chairside/module-boundaries': 'error' },
  },
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: {
      // (a) No reading the clock inside modules.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: clockMessage,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
        {
          selector: "CallExpression[callee.object.name='DateTime'][callee.property.name='now']",
          message: clockMessage,
        },
        {
          selector:
            "CallExpression[callee.object.name='DateTime'][callee.property.name=/^(local|utc)$/][arguments.length=0]",
          message: clockMessage,
        },
        {
          selector: "MemberExpression[object.name='Temporal'][property.name='Now']",
          message: clockMessage,
        },
        // The same reads, written other ways. Each selector matches only forms the ones above miss.
        {
          // Date() without `new` returns the current time as text, whatever its arguments.
          selector: "CallExpression:matches([callee.name='Date'], [callee.property.name='Date'])",
          message: clockMessage,
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.value='now']",
          message: clockMessage,
        },
        {
          // globalThis.Date.now(), globalThis.Date['now']()
          selector:
            "CallExpression[callee.object.property.name='Date']:matches([callee.property.name='now'], [callee.property.value='now'])",
          message: clockMessage,
        },
        {
          selector: "NewExpression[callee.property.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
        {
          // Luxon reads the clock when given only options: DateTime.local({ zone }).
          selector:
            "CallExpression[callee.object.name='DateTime'][callee.property.name=/^(local|utc)$/][arguments.length=1][arguments.0.type='ObjectExpression']",
          message: clockMessage,
        },
        // (c) Framework code that no-restricted-imports cannot see.
        {
          // JSX compiles to an import of react/jsx-runtime that is not written in the file.
          selector: 'JSXElement, JSXFragment',
          message: frameworkMessage,
        },
        {
          selector:
            'ImportExpression[source.value=/^(next|react|react-dom|server-only|client-only)(\\/.*)?$|^@next\\//]',
          message: frameworkMessage,
        },
      ],
      // (c) No Next.js or React inside modules.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                '@next/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'server-only',
                'client-only',
              ],
              message: frameworkMessage,
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'coverage/**']),
]);
