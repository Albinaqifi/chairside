import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import databaseAccess from './eslint-rules/database-access.mjs';
import formsPost from './eslint-rules/forms-post.mjs';
import moduleBoundaries from './eslint-rules/module-boundaries.mjs';
import serverActions from './eslint-rules/server-actions.mjs';

// Architecture rules (CLAUDE.md, "Module rules"). Tested in eslint-rules/architecture.test.ts.

const clockMessage =
  'Business logic never reads the system clock. Take "now" as a parameter or a Clock (src/lib/clock.ts).';

const frameworkMessage =
  'Modules contain no Next.js or React code, so the worker and tests can use them. Keep it in src/app.';

// Every kind of script file, so no rule depends on the extension a file happens to use.
const SCRIPT_EXTENSIONS = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const SCRIPT_FILES = `*.${SCRIPT_EXTENSIONS}`;

/**
 * The files type-aware linting covers: the TypeScript files in src that tsconfig.json includes
 * (it lists .ts, .tsx and .mts). eslint-rules/lint-snippets.mjs gives its snippets the same.
 */
export const TYPED_FILES = 'src/**/*.{ts,tsx,mts}';

// Our own rules, in one plugin.
const chairside = {
  rules: {
    'module-boundaries': moduleBoundaries,
    'server-actions': serverActions,
    'database-access': databaseAccess,
    'forms-post': formsPost,
  },
};

// Next.js, React and packages built on them, for selectors: a package name or one of its paths.
const FRAMEWORK_SOURCE =
  '/^(next|next-intl|react|react-dom|server-only|client-only)(\\/.*)?$|^@(next|react-email)\\//';

// The Date global, also reached through globalThis or window: Date, globalThis.Date, globalThis['Date'].
const date = (path) =>
  `:matches([${path}name='Date'], [${path}property.name='Date'], [${path}property.value='Date'])`;

// A method call by the method's name, also written p['catch'](…) or p[`catch`](…).
const method = (name) =>
  `:matches([callee.property.name='${name}'], [callee.property.value='${name}'], [callee.property.quasis.0.value.cooked='${name}'])`;

// (f) A statement that only hangs .catch(…), a two-argument .then(…) or .finally(…) on a promise,
// also through p?.catch(…). no-floating-promises counts such a promise as handled (a .finally(…)
// as handled when the promise it hangs on is, so ….catch(…).finally(…) too), yet nothing waits for
// it (R-32, D-077). A .finally(…) statement on a promise nobody handles gets both reports. Used
// twice below: in the modules' list, and for the other TypeScript files.
const unawaitedCall = `CallExpression:matches(${method('catch')}, ${method('then')}[arguments.length>=2], ${method('finally')})`;
const unawaitedPromise = {
  selector: `ExpressionStatement > ${unawaitedCall}, ExpressionStatement > ChainExpression > ${unawaitedCall}`,
  message:
    'Nothing waits for a promise that only has .catch(…), .then(ok, fail) or .finally(…) hung on ' +
    "it: a query can then run after its transaction has ended, even in another clinic's (R-32). " +
    'Await it or return it (D-077).',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [`src/**/${SCRIPT_FILES}`],
    plugins: { chairside },
    rules: {
      // (b) Modules are imported only through their index.ts.
      'chairside/module-boundaries': 'error',
    },
  },
  {
    // (d) Every server action is made by an action wrapper; no other route in without a reason
    // (D-071, D-073). Every script file in the repository, so that a 'use server' file outside
    // src/ is reported too, and so is any file in src/pages/ (D-077).
    files: [`**/${SCRIPT_FILES}`],
    plugins: { chairside },
    rules: { 'chairside/server-actions': 'error' },
  },
  {
    // (h) No lint comment switches a guard off in src/: ESLint ignores every eslint-disable and
    // /* eslint … */ comment there and reports it as a warning, which --max-warnings=0 fails (D-077).
    files: [`src/**/${SCRIPT_FILES}`],
    linterOptions: { noInlineConfig: true },
  },
  {
    // (e) Only the files that open transactions reach the database (D-062, D-071). Tests are
    // exempt: they set up and inspect rows directly.
    files: [`src/**/${SCRIPT_FILES}`],
    ignores: [`src/**/*.test.${SCRIPT_EXTENSIONS}`],
    plugins: { chairside },
    rules: { 'chairside/database-access': 'error' },
  },
  {
    // (f) Every promise is awaited and only errors are thrown (R-32, D-071, D-073). These rules ask
    // TypeScript what each expression is, so they need the project (tsconfig.json).
    files: [TYPED_FILES],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // checkThenables: a Drizzle query is a thenable, not a Promise. Without it, an un-awaited
      // tx.insert(…) would pass, and could run after its transaction has ended (R-32).
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
      '@typescript-eslint/no-misused-promises': 'error',
      // A thrown value that is not an Error hides a failed query from withoutQueryValues()
      // (src/lib/query-errors.ts); a refusal is returned, never thrown.
      '@typescript-eslint/only-throw-error': 'error',
      // The same for a rejection: Promise.reject(…) and a new Promise's reject(…) take Errors. A
      // caught error (unknown) passes, as only-throw-error lets it be thrown again (D-077).
      '@typescript-eslint/prefer-promise-reject-errors': [
        'error',
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
    },
  },
  {
    // (f) The TypeScript files outside the modules; the modules' list below holds the same check.
    // A second no-restricted-syntax block that matched a module file would replace that whole
    // list, so this one leaves the modules out. A client .tsx file may keep .then(ok, fail).
    files: ['src/**/*.{ts,mts}'],
    ignores: ['src/modules/**'],
    rules: { 'no-restricted-syntax': ['error', unawaitedPromise] },
  },
  {
    // (g) A form never puts its fields in the URL: its action is a function, or it posts to a URL
    // (D-076); so does a button's or input's formAction, no spread onto one may carry formAction or
    // formMethod, and next/form is not imported (D-081). Telling a function from a URL in
    // action={…} needs the types, so the same files as (f).
    files: [TYPED_FILES],
    plugins: { chairside },
    rules: { 'chairside/forms-post': 'error' },
  },
  {
    files: [`src/modules/**/${SCRIPT_FILES}`],
    rules: {
      // Each selector below matches its own forms, so no form is reported twice.
      'no-restricted-syntax': [
        'error',
        // (a) No reading the clock inside modules.
        {
          // Date.now(), Date['now'](), Date[`now`](), globalThis.Date.now() ...
          selector: `CallExpression${date('callee.object.')}:matches([callee.property.name='now'], [callee.property.value='now'], [callee.property.quasis.0.value.cooked='now'])`,
          message: clockMessage,
        },
        {
          // new Date(), new globalThis.Date(), and new Date(...args), which may be empty.
          selector: `NewExpression${date('callee.')}:matches([arguments.length=0], [arguments.0.type='SpreadElement'])`,
          message: clockMessage,
        },
        {
          // Date() without `new` returns the current time as text, whatever its arguments.
          selector: `CallExpression${date('callee.')}`,
          message: clockMessage,
        },
        {
          selector: `CallExpression[callee.object.name='Reflect'][callee.property.name='construct']${date('arguments.0.')}`,
          message: clockMessage,
        },
        {
          // Luxon: DateTime.now(), also through a namespace (luxon.DateTime.now()).
          selector:
            "CallExpression:matches([callee.object.name='DateTime'], [callee.object.property.name='DateTime'])[callee.property.name='now']",
          message: clockMessage,
        },
        {
          // Luxon reads the clock when DateTime.local() or .utc() get no date: no arguments, or
          // one that is not a number, such as options ({ zone }) or a variable holding them.
          selector:
            "CallExpression:matches([callee.object.name='DateTime'], [callee.object.property.name='DateTime'])[callee.property.name=/^(local|utc)$/]:matches([arguments.length=0], [arguments.length=1]:not([arguments.0.type='Literal']))",
          message: clockMessage,
        },
        {
          selector:
            "ImportDeclaration[source.value='luxon'] > ImportSpecifier[imported.name='DateTime'][local.name!='DateTime']",
          message:
            'Import DateTime from luxon under its own name, so the clock rule can see DateTime.now() and similar calls.',
        },
        {
          selector:
            "MemberExpression:matches([object.name='Temporal'], [object.property.name='Temporal'], [object.property.value='Temporal']):matches([property.name='Now'], [property.value='Now'])",
          message: clockMessage,
        },
        // (c) Framework code that no-restricted-imports cannot see.
        {
          // JSX compiles to an import of react/jsx-runtime that is not written in the file.
          selector: 'JSXElement, JSXFragment',
          message: frameworkMessage,
        },
        {
          // import('react'), import(`react`)
          selector: `ImportExpression:matches([source.value=${FRAMEWORK_SOURCE}], [source.quasis.0.value.cooked=${FRAMEWORK_SOURCE}])`,
          message: frameworkMessage,
        },
        {
          // CommonJS: require('react')
          selector: `CallExpression[callee.name='require']:matches([arguments.0.value=${FRAMEWORK_SOURCE}], [arguments.0.quasis.0.value.cooked=${FRAMEWORK_SOURCE}])`,
          message: frameworkMessage,
        },
        {
          // TypeScript: import('react') used as a type. (no-restricted-imports sees import x = require.)
          selector: `TSImportType[source.value=${FRAMEWORK_SOURCE}]`,
          message: frameworkMessage,
        },
        // (f) A promise nobody waits for, as in the block for the other TypeScript files above.
        unawaitedPromise,
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
                'next-intl',
                'next-intl/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                '@react-email/*',
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
