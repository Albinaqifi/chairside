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
