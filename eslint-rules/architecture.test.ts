import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the project's real ESLint config on small snippets, so the architecture rules cannot be
// switched off or broken without a test failing. The file path decides which rules apply.

const CLOCK = 'no-restricted-syntax';
const FRAMEWORK = 'no-restricted-imports';
const BOUNDARY = 'chairside/module-boundaries';
// (c) for what no-restricted-imports cannot see (JSX, dynamic import) is a syntax rule too.
const FRAMEWORK_SYNTAX = 'no-restricted-syntax';
const SERVER_ACTIONS = 'chairside/server-actions';
const DATABASE = 'chairside/database-access';
const FLOATING = '@typescript-eslint/no-floating-promises';
const MISUSED = '@typescript-eslint/no-misused-promises';
const THROWN = '@typescript-eslint/only-throw-error';
const ARCHITECTURE_RULES = [
  CLOCK,
  FRAMEWORK,
  BOUNDARY,
  SERVER_ACTIONS,
  DATABASE,
  FLOATING,
  MISUSED,
  THROWN,
];

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Case {
  name: string;
  file: string;
  code: string;
  expected: string[];
}

const IN_MODULE = 'src/modules/scheduling/slots.ts';
const DECLARE = 'declare const DateTime: any; declare const Temporal: any;';
/** A framework import, a deep import and a clock read, in that order. */
const ALL_THREE =
  "import x from 'react'; import { y } from '@/modules/tenancy/schema'; export const a = [x, y, Date.now()];";

/** A file of the project as it is on disk: real code that must pass. */
const asItIs = (file: string) => ({ file, code: readFileSync(path.join(ROOT, file), 'utf8') });

const STAFF_ACTIONS = 'src/app/(staff)/patients/actions.ts';
const AUTH_ACTIONS = 'src/app/(auth)/login/actions.ts';
const STAFF_PAGE = 'src/app/(staff)/patients/page.tsx';
const USE_SERVER = "'use server';";
const WRAPPERS = "import { refuse, staffAction, staffRead, userAction } from '@/app/_lib/actions';";
/** What a wrapper is called with does not matter to the rule. */
const ARGS = 'declare const spec: never; declare const handler: never;';
/** A table of its own, so a snippet's queries have Drizzle's real types. */
const TABLE =
  "import { pgTable, uuid } from 'drizzle-orm/pg-core'; const marks = pgTable('marks', { id: uuid('id') });";
const TX = "import type { TenantTransaction } from '@/db/tenant';";

const cases: Case[] = [
  // (a) No reading the clock inside src/modules.
  {
    name: 'a: Date.now() in a module',
    file: IN_MODULE,
    code: 'export const a = Date.now();',
    expected: [CLOCK],
  },
  {
    name: 'a: new Date() in a module',
    file: IN_MODULE,
    code: 'export const a = new Date();',
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.now() in a module',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.now();`,
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.local() in a module',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.local();`,
    expected: [CLOCK],
  },
  {
    name: 'a: Temporal.Now in a module',
    file: IN_MODULE,
    code: `${DECLARE} export const a = Temporal.Now.instant();`,
    expected: [CLOCK],
  },
  {
    name: 'a: a date from a value is fine',
    file: IN_MODULE,
    code: "export const a = new Date('2026-03-10T09:00:00Z');",
    expected: [],
  },
  {
    name: 'a: DateTime.local(...) with a value is fine',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.local(2026, 3, 10);`,
    expected: [],
  },
  {
    name: 'a: the clock may be read outside modules',
    file: 'src/lib/clock.ts',
    code: 'export const a = Date.now();',
    expected: [],
  },
  {
    name: 'a: Date() called without new in a module',
    file: IN_MODULE,
    code: 'export const a = Date();',
    expected: [CLOCK],
  },
  {
    name: "a: Date['now']() in a module",
    file: IN_MODULE,
    code: "export const a = Date['now']();",
    expected: [CLOCK],
  },
  {
    name: 'a: globalThis.Date.now() in a module',
    file: IN_MODULE,
    code: 'export const a = globalThis.Date.now();',
    expected: [CLOCK],
  },
  {
    name: 'a: new globalThis.Date() in a module',
    file: IN_MODULE,
    code: 'export const a = new globalThis.Date();',
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.local({ zone }) in a module',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.local({ zone: 'Europe/Skopje' });`,
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.utc({ locale }) in a module',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.utc({ locale: 'en' });`,
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.utc(...) with values and options is fine',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.utc(2026, 3, 10, { locale: 'en' });`,
    expected: [],
  },
  {
    name: 'a: new globalThis.Date(value) is fine',
    file: IN_MODULE,
    code: "export const a = new globalThis.Date('2026-03-10T09:00:00Z');",
    expected: [],
  },
  {
    name: 'a: Date[`now`]() in a module',
    file: IN_MODULE,
    code: 'export const a = Date[`now`]();',
    expected: [CLOCK],
  },
  {
    name: "a: globalThis['Date'].now() in a module",
    file: IN_MODULE,
    code: "export const a = globalThis['Date'].now();",
    expected: [CLOCK],
  },
  {
    name: "a: new globalThis['Date']() in a module",
    file: IN_MODULE,
    code: "export const a = new globalThis['Date']();",
    expected: [CLOCK],
  },
  {
    name: 'a: Reflect.construct(Date, []) in a module',
    file: IN_MODULE,
    code: 'export const a = Reflect.construct(Date, []);',
    expected: [CLOCK],
  },
  {
    name: 'a: new Date(...[]) in a module',
    file: IN_MODULE,
    code: 'export const a = new Date(...[]);',
    expected: [CLOCK],
  },
  {
    name: 'a: Luxon through a namespace import',
    file: IN_MODULE,
    code: "import * as luxon from 'luxon'; export const a = luxon.DateTime.now();",
    expected: [CLOCK],
  },
  {
    name: 'a: Luxon DateTime imported under another name',
    file: IN_MODULE,
    code: "import { DateTime as DT } from 'luxon'; export const a = DT.now();",
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.local(options) with a variable',
    file: IN_MODULE,
    code: `${DECLARE} declare const options: object; export const a = DateTime.local(options);`,
    expected: [CLOCK],
  },
  {
    name: 'a: globalThis.Temporal.Now in a module',
    file: IN_MODULE,
    code: 'export const a = globalThis.Temporal.Now.instant();',
    expected: [CLOCK],
  },
  {
    name: 'a: DateTime.local(year) with a number is fine',
    file: IN_MODULE,
    code: `${DECLARE} export const a = DateTime.local(2026);`,
    expected: [],
  },
  {
    name: 'a: Luxon DateTime imported under its own name is fine',
    file: IN_MODULE,
    code: "import { DateTime } from 'luxon'; export const a = DateTime.fromISO('2026-03-10T09:00:00Z');",
    expected: [],
  },

  // (b) Modules are imported only through index.ts.
  {
    name: 'b: deep import by alias',
    file: 'src/modules/audit/record.ts',
    code: "import { x } from '@/modules/tenancy/schema'; export { x };",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep import by relative path',
    file: 'src/modules/audit/record.ts',
    code: "import { x } from '../tenancy/schema'; export { x };",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep import into a subfolder',
    file: 'src/modules/audit/record.ts',
    code: "import { x } from '../tenancy/settings/read'; export { x };",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep import from src/app',
    file: 'src/app/page.tsx',
    code: "import { x } from '@/modules/patients/search'; export { x };",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep re-export',
    file: 'src/db/anything.ts',
    code: "export * from '@/modules/patients/search';",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep dynamic import',
    file: 'src/app/page.tsx',
    code: "export const load = () => import('@/modules/patients/search');",
    expected: [BOUNDARY],
  },
  {
    name: "b: another module's index is fine",
    file: 'src/modules/audit/record.ts',
    code: "import { x } from '@/modules/tenancy'; export { x };",
    expected: [],
  },
  {
    name: 'b: index by name is fine',
    file: 'src/modules/audit/record.ts',
    code: "import { x } from '@/modules/tenancy/index'; export { x };",
    expected: [],
  },
  {
    name: "b: a module's own files are fine",
    file: 'src/modules/audit/record.ts',
    code: "import { x } from './schema'; export { x };",
    expected: [],
  },
  {
    name: 'b: schema.ts may import another schema.ts',
    file: 'src/modules/audit/schema.ts',
    code: "import { clinics } from '@/modules/tenancy/schema'; export { clinics };",
    expected: [],
  },
  {
    name: 'b: schema.ts may not import other files',
    file: 'src/modules/audit/schema.ts',
    code: "import { x } from '@/modules/tenancy/settings'; export { x };",
    expected: [BOUNDARY],
  },
  {
    name: 'b: deep dynamic import written as a template literal',
    file: 'src/modules/audit/record.ts',
    code: 'export const load = () => import(`@/modules/patients/search`);',
    expected: [BOUNDARY],
  },
  {
    name: "b: deep import('…') used as a type",
    file: 'src/modules/audit/record.ts',
    code: "export type Result = import('@/modules/patients/search').Result;",
    expected: [BOUNDARY],
  },

  // (c) No Next.js or React inside src/modules.
  ...[
    'next/headers',
    'next',
    'react',
    'react-dom/server',
    'server-only',
    'next-intl',
    '@react-email/components',
  ].map((source) => ({
    name: `c: '${source}' in a module`,
    file: IN_MODULE,
    code: `import x from '${source}'; export { x };`,
    expected: [FRAMEWORK],
  })),
  {
    name: 'c: Next.js is fine in src/app',
    file: 'src/app/page.tsx',
    code: "import { cookies } from 'next/headers'; export { cookies };",
    expected: [],
  },
  {
    name: 'c: JSX in a module .tsx file (an implicit react/jsx-runtime import)',
    file: 'src/modules/scheduling/slot-label.tsx',
    code: 'export const a = <span>slot</span>;',
    expected: [FRAMEWORK_SYNTAX],
  },
  {
    name: 'c: a JSX fragment in a module .tsx file',
    file: 'src/modules/scheduling/slot-label.tsx',
    code: 'export const a = <></>;',
    expected: [FRAMEWORK_SYNTAX],
  },
  {
    name: "c: import('react') in a module",
    file: IN_MODULE,
    code: "export const load = () => import('react');",
    expected: [FRAMEWORK_SYNTAX],
  },
  {
    name: "c: import('next/headers') in a module",
    file: IN_MODULE,
    code: "export const load = () => import('next/headers');",
    expected: [FRAMEWORK_SYNTAX],
  },
  {
    name: 'c: JSX is fine in src/app',
    file: 'src/app/slot-label.tsx',
    code: 'export const a = <span>slot</span>;',
    expected: [],
  },
  {
    name: 'c: a dynamic import of another package is fine in a module',
    file: IN_MODULE,
    code: "export const load = () => import('zod');",
    expected: [],
  },
  {
    name: 'c: import(`react`) written as a template literal',
    file: IN_MODULE,
    code: 'export const load = () => import(`react`);',
    expected: [FRAMEWORK_SYNTAX],
  },
  {
    name: "c: import('react') used as a type",
    file: IN_MODULE,
    code: "export type Node = import('react').ReactNode;",
    expected: [FRAMEWORK_SYNTAX],
  },

  // All three rules, in every kind of script file a module folder can hold.
  ...['js', 'mjs', 'mts', 'cts'].map((extension) => ({
    name: `a, b, c: a .${extension} file in a module`,
    file: `src/modules/scheduling/slots.${extension}`,
    code: ALL_THREE,
    expected: [FRAMEWORK, BOUNDARY, CLOCK],
  })),
  {
    name: 'a, b, c: a .jsx file in a module',
    file: 'src/modules/scheduling/slot-label.jsx',
    code: `${ALL_THREE} export const b = <span>slot</span>;`,
    expected: [FRAMEWORK, BOUNDARY, CLOCK, FRAMEWORK_SYNTAX],
  },
  {
    name: 'a, b, c: a .cjs file in a module, importing with require()',
    file: 'src/modules/scheduling/slots.cjs',
    code: "const x = require('react'); const { y } = require('@/modules/tenancy/schema'); module.exports = [x, y, Date.now()];",
    expected: [FRAMEWORK_SYNTAX, BOUNDARY, CLOCK],
  },
  {
    name: 'b, c: import x = require(…) in a .cts file in a module',
    file: 'src/modules/scheduling/slots.cts',
    code: "import x = require('react'); import y = require('@/modules/tenancy/schema'); export = [x, y];",
    expected: [FRAMEWORK, BOUNDARY],
  },

  // (d) Every server action is made by an action wrapper (D-071, D-073).
  {
    name: "d: a bare async function exported from a 'use server' file in (staff)",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export async function renamePatient() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a bare async function exported from a 'use server' file in (auth)",
    file: AUTH_ACTIONS,
    code: `${USE_SERVER} export async function signIn() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a bare action exported as an arrow function',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export const renamePatient = async () => {};`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: an inline 'use server' function in a page",
    file: STAFF_PAGE,
    code: "export default function Page() { async function save() { 'use server'; } return <form action={save} />; }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: an inline 'use server' arrow function",
    file: STAFF_PAGE,
    code: "export const save = async () => { 'use server'; };",
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: an inline 'use server' function in a module",
    file: IN_MODULE,
    code: "export async function save() { 'use server'; }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a 'use server' file in a module",
    file: 'src/modules/scheduling/actions.ts',
    code: `${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a 'use server' file in src/lib",
    file: 'src/lib/actions.ts',
    code: `${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: an unlisted route handler under src/app/api/',
    file: 'src/app/api/export/route.ts',
    code: "export async function GET() { return new Response('ok'); }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: an unlisted route handler in a route group',
    file: 'src/app/(staff)/export/route.ts',
    code: "export async function GET() { return new Response('ok'); }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: the auth library's route handler is on the list",
    ...asItIs('src/app/api/auth/[...all]/route.ts'),
    expected: [],
  },
  {
    name: "d: the clinic picker's action, as it is, passes",
    ...asItIs('src/app/(auth)/choose-clinic/actions.ts'),
    expected: [],
  },
  {
    name: "d: the wrappers' own file, as it is, passes",
    ...asItIs('src/app/_lib/actions.ts'),
    expected: [],
  },
  {
    name: 'd: export const x = staffAction(…) passes',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const renamePatient = staffAction(spec, handler);`,
    expected: [],
  },
  {
    name: 'd: export const x = staffRead(…) passes',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const readPatient = staffRead(spec, handler);`,
    expected: [],
  },
  {
    name: 'd: export const x = userAction(…) passes',
    file: AUTH_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const signIn = userAction(spec, handler);`,
    expected: [],
  },
  {
    name: 'd: the wrapper imported by a relative path passes',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} import { staffAction } from '../../_lib/actions'; ${ARGS} export const renamePatient = staffAction(spec, handler);`,
    expected: [],
  },
  {
    name: 'd: type-only exports pass',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export type Input = { name: string }; export interface Output { id: string } export type { Refusal } from '@/app/_lib/actions';`,
    expected: [],
  },
  {
    name: 'd: export const x = staffRead(…).forPage',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const readPatient = staffRead(spec, handler).forPage;`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: the .forPage of a read made earlier in the file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} const read = staffRead(spec, handler); export const readPatient = read.forPage;`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: the .forPage of an imported read',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} import { readPatient } from './reads'; export const viewPatient = readPatient.forPage;`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a read's .forPage taken out and re-exported",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} const { forPage } = staffRead(spec, handler); export { forPage };`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a re-export, export { x }, even of a wrapper-made action',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} const renamePatient = staffAction(spec, handler); export { renamePatient };`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a re-export from another file, export { x } from',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export { renamePatient } from './other-actions';`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: export * from another file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export * from './other-actions';`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: export default, even of a wrapper-made action',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export default staffAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a call to a local function named staffAction',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} function staffAction(...args: unknown[]) { return async () => args; } export const renamePatient = staffAction({});`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a function named staffAction imported from another file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} import { staffAction } from '@/lib/actions'; ${ARGS} export const renamePatient = staffAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a wrapper imported under another name',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} import { staffAction as makeAction } from '@/app/_lib/actions'; ${ARGS} export const renamePatient = makeAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: export let, which the file could replace later',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export let renamePatient = staffAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a wrapper's action passed through another function",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} declare function logged<T>(action: T): T; export const renamePatient = logged(staffAction(spec, handler));`,
    expected: [SERVER_ACTIONS],
  },

  // (e) Only the files that open transactions reach the database (D-062, D-071).
  {
    name: "e: '@/db/client' in a page",
    file: STAFF_PAGE,
    code: "import { getDb } from '@/db/client'; export const db = getDb;",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' in an action file",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} import { getDb } from '@/db/client'; ${WRAPPERS} ${ARGS} export const listPatients = staffRead(spec, async () => getDb());`,
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' in a module other than auth",
    file: IN_MODULE,
    code: "import { getDb } from '@/db/client'; export const db = getDb;",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' by a relative path",
    file: IN_MODULE,
    code: "import { getDb } from '../../db/client'; export const db = getDb;",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' with a dynamic import",
    file: IN_MODULE,
    code: "export const load = () => import('@/db/client');",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' through require()",
    file: 'src/modules/scheduling/slots.cjs',
    code: "const { getDb } = require('@/db/client'); module.exports = getDb;",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/client' in src/modules/auth is fine",
    file: 'src/modules/auth/sessions.ts',
    code: "import { getDb } from '@/db/client'; export const db = getDb;",
    expected: [],
  },
  {
    name: "e: '@/db/client' in src/db is fine",
    file: 'src/db/anything.ts',
    code: "import { getDb } from './client'; export const db = getDb;",
    expected: [],
  },
  {
    name: 'e: withTenant in a module',
    file: IN_MODULE,
    code: "import { withTenant } from '@/db/tenant'; export const open = withTenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant in a page',
    file: STAFF_PAGE,
    code: "import { withTenant } from '@/db/tenant'; export const open = withTenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant under another name',
    file: IN_MODULE,
    code: "import { withTenant as open } from '@/db/tenant'; export { open };",
    expected: [DATABASE],
  },
  {
    name: 'e: the tenant file as a namespace, which holds withTenant',
    file: IN_MODULE,
    code: "import * as tenant from '@/db/tenant'; export const open = tenant.withTenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant re-exported',
    file: IN_MODULE,
    code: "export { withTenant } from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: 'e: export * of the tenant file',
    file: IN_MODULE,
    code: "export * from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: 'e: the tenant file with a dynamic import',
    file: IN_MODULE,
    code: "export const load = () => import('@/db/tenant');",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant in src/modules/auth is fine (the login audit)',
    file: 'src/modules/auth/sessions.ts',
    code: "import { withTenant } from '@/db/tenant'; export const open = withTenant;",
    expected: [],
  },
  {
    name: 'e: a type-only import of TenantTransaction in a module passes',
    file: IN_MODULE,
    code: `${TX} export type Tx = TenantTransaction;`,
    expected: [],
  },
  {
    name: 'e: an inline type import of TenantTransaction passes',
    file: IN_MODULE,
    code: "import { type TenantTransaction } from '@/db/tenant'; export type Tx = TenantTransaction;",
    expected: [],
  },
  {
    name: 'e: tests are exempt',
    file: 'src/modules/scheduling/slots.test.ts',
    code: "import { getDb } from '@/db/client'; import { withTenant } from '@/db/tenant'; export const a = [getDb, withTenant];",
    expected: [],
  },

  // (f) Every promise is awaited and only errors are thrown (R-32, D-073). Type-aware.
  {
    name: 'f: items.forEach(async (i) => tx.insert(…))',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function markAll(tx: TenantTransaction, ids: string[]) { ids.forEach(async (id) => tx.insert(marks).values({ id })); }`,
    expected: [MISUSED],
  },
  {
    name: 'f: an un-awaited tx.insert(…) inside withTenant',
    file: 'src/db/jobs.ts',
    code: `${TABLE} import { withTenant } from '@/db/tenant'; export async function mark(clinicId: string, id: string) { await withTenant(clinicId, async (tx) => { tx.insert(marks).values({ id }); }); }`,
    expected: [FLOATING],
  },
  {
    name: 'f: an un-awaited tx.insert(…) in a module function',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }); }`,
    expected: [FLOATING],
  },
  {
    name: 'f: an un-awaited tx.execute(…)',
    file: IN_MODULE,
    code: `import { sql } from 'drizzle-orm'; ${TX} export async function touch(tx: TenantTransaction) { tx.execute(sql\`select 1\`); }`,
    expected: [FLOATING],
  },
  {
    name: 'f: an awaited query passes',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { await tx.insert(marks).values({ id }); }`,
    expected: [],
  },
  {
    name: 'f: an async click handler where nothing waits for it',
    file: 'src/app/(staff)/save-button.tsx',
    code: 'export function SaveButton({ save }: { save: () => Promise<void> }) { return <button onClick={save}>Save</button>; }',
    expected: [MISUSED],
  },
  {
    name: 'f: throw { cause: e }',
    file: IN_MODULE,
    code: 'export async function load(read: () => Promise<void>) { try { await read(); } catch (e) { throw { cause: e }; } }',
    expected: [THROWN],
  },
  {
    name: "f: throw refuse('not_found')",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const removePatient = staffAction(spec, async () => { throw refuse('not_found'); });`,
    expected: [THROWN],
  },
  {
    name: 'f: throw new Error(…) passes',
    file: IN_MODULE,
    code: "export function check(ok: boolean) { if (!ok) throw new Error('not ok'); }",
    expected: [],
  },
  {
    name: 'f: rethrowing a caught error passes',
    file: IN_MODULE,
    code: 'export async function load(read: () => Promise<void>) { try { await read(); } catch (error) { throw error; } }',
    expected: [],
  },
  {
    name: 'f: throwing what withoutQueryValues() returns (unknown) passes',
    file: IN_MODULE,
    code: "import { withoutQueryValues } from '@/lib/query-errors'; export async function load(read: () => Promise<void>) { try { await read(); } catch (error) { throw withoutQueryValues(error); } }",
    expected: [],
  },
];

let reported: string[][] = [];

beforeAll(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const helper = fileURLToPath(new URL('./lint-snippets.mjs', import.meta.url));
  const run = promisify(execFile)(process.execPath, [helper], { cwd: root });
  run.child.stdin?.end(JSON.stringify(cases.map(({ code, file }) => ({ code, file }))));
  reported = JSON.parse((await run).stdout);
  // Starting ESLint takes about 2 s when warm, but close to a minute on a cold Windows file cache.
}, 180_000);

describe('architecture lint rules', () => {
  it.each(cases.map((c, index) => ({ ...c, index })))('$name', ({ index, expected }) => {
    const messages = reported[index] ?? [];
    // A snippet that cannot be parsed reports no rule, so it would pass a case that expects none.
    expect(messages.filter((message) => message.startsWith('parse error'))).toEqual([]);
    const architectureRules = messages.filter((rule) => ARCHITECTURE_RULES.includes(rule));
    expect(architectureRules).toEqual(expected);
  });
});
