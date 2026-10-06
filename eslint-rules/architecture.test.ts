import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
const FORMS = 'chairside/forms-post';
const REJECTED = '@typescript-eslint/prefer-promise-reject-errors';
// (f) for a .catch(…), .then(ok, fail) or .finally(…) statement nobody awaits is a syntax rule too.
const UNAWAITED = 'no-restricted-syntax';
// What eslint-rules/lint-snippets.mjs calls a lint comment that noInlineConfig ignores in every
// script file.
const INLINE_CONFIG = 'inline config';
const ARCHITECTURE_RULES = [
  CLOCK,
  FRAMEWORK,
  BOUNDARY,
  SERVER_ACTIONS,
  DATABASE,
  FLOATING,
  MISUSED,
  THROWN,
  FORMS,
  REJECTED,
  INLINE_CONFIG,
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
/** A component file with a form in it. */
const STAFF_FORM = 'src/app/(staff)/patients/search-form.tsx';
/** Wraps JSX in a component, so a snippet is only the form. */
const form = (jsx: string, before = '') => `${before} export function Search() { return ${jsx}; }`;
/** New files in two of the places allowed to hold withTenant or the database client (D-077). */
const IN_AUTH = 'src/modules/auth/handles.ts';
const IN_DB = 'src/db/handles.ts';
/** A function action, so the form passes and only its button or input is checked. */
const SAVE = 'declare const save: (formData: FormData) => Promise<void>;';
const PROPS = "import type { ComponentProps } from 'react';";
/** E00-T04a's Button (D-084): a case's snippet takes the real file's place while it is linted. */
const UI_FILE = 'src/ui/button.tsx';
/** React's types the component snippets use. */
const REACT =
  "import type { ComponentProps, ComponentPropsWithoutRef, ForwardRefExoticComponent, HTMLAttributes, PropsWithChildren, ReactNode, RefAttributes } from 'react';";
/** A stand-in for Radix's Slot, which shadcn/ui's Button renders when asChild is set. */
const SLOT =
  'declare const Slot: (props: HTMLAttributes<HTMLElement> & { children?: ReactNode }) => ReactNode;';
/** Button props without the two (D-081), and with both typed away, as a generic constraint (D-084). */
const NO_SUBMIT = "Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>";
const NEVER_SUBMIT = `${NO_SUBMIT} & { formAction?: never; formMethod?: never }`;

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
  // Tester, E00-T08: shapes a change to the rule could stop seeing.
  {
    name: "d (tester): a bare action when 'use strict' comes before 'use server'",
    file: STAFF_ACTIONS,
    code: `'use strict'; ${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d (tester): an escaped 'use server' is the directive too (Next.js reads its value)",
    file: STAFF_ACTIONS,
    code: "'use\\x20server'; export async function save() {}",
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d (tester): a wrapper's result destructured in the export",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const [renamePatient] = staffAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd (tester): an exported class',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} export class Patients {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd (tester): an unlisted route handler written as route.tsx',
    file: 'src/app/(staff)/export/route.tsx',
    code: "export async function GET() { return new Response('ok'); }",
    expected: [SERVER_ACTIONS],
  },
  // E00-T10: routes only in src/app, and no 'use server' file anywhere else (D-077).
  {
    name: 'd: a Pages Router API route in src/pages/api',
    file: 'src/pages/api/x.ts',
    code: "import type { NextApiRequest, NextApiResponse } from 'next'; export default function handler(req: NextApiRequest, res: NextApiResponse) { res.status(200).json({ ok: true }); }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a Pages Router page in src/pages',
    file: 'src/pages/x.tsx',
    code: 'export default function Page() { return <p>x</p>; }',
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a file deeper in src/pages',
    file: 'src/pages/patients/[id].tsx',
    code: 'export default function Page() { return <p>x</p>; }',
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a 'use server' file outside src/",
    file: 'lib/actions.ts',
    code: `${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: a 'use server' .mjs file outside src/",
    file: 'scripts/actions.mjs',
    code: `${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: an inline 'use server' function outside src/",
    file: 'lib/save.ts',
    code: "export async function save() { 'use server'; }",
    expected: [SERVER_ACTIONS],
  },
  {
    name: 'd: a file outside src/ without a server action passes',
    file: 'lib/helpers.ts',
    code: 'export const twice = (n: number) => n * 2;',
    expected: [],
  },
  {
    name: 'd: a folder named pages inside src/app passes (an App Router path)',
    file: 'src/app/(staff)/pages/page.tsx',
    code: 'export default function Page() { return <p>pages</p>; }',
    expected: [],
  },
  // E00-T11: a 'use server' file ends in .ts, where the .catch(…) statement check reaches (D-084).
  {
    name: "d: a 'use server' file that ends in .tsx, though every export in it is a wrapped action",
    file: 'src/app/(staff)/patients/actions.tsx',
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const renamePatient = staffAction(spec, handler);`,
    expected: [SERVER_ACTIONS],
  },
  {
    name: "d: the same 'use server' file at actions.ts passes",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} export const renamePatient = staffAction(spec, handler);`,
    expected: [],
  },
  {
    name: "d: a 'use server' .tsx file with a bare action: one report for the file, one for the export",
    file: 'src/app/(staff)/patients/actions.tsx',
    code: `${USE_SERVER} export async function save() {}`,
    expected: [SERVER_ACTIONS, SERVER_ACTIONS],
  },
  {
    name: "d: a 'use server' .tsx file outside src/app gets the one report for a file there",
    file: 'src/lib/actions.tsx',
    code: `${USE_SERVER} export async function save() {}`,
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
    name: "e (tester): '@/db/client' imported for its side effects only, in a page",
    file: STAFF_PAGE,
    code: "import '@/db/client'; export default function Page() { return null; }",
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
  // E00-T10: the places allowed to hold a handle never pass it on (D-077).
  {
    name: 'e: withTenant re-exported from src/modules/auth',
    file: IN_AUTH,
    code: "export { withTenant } from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: 'e: getDb re-exported from src/modules/auth',
    file: IN_AUTH,
    code: "export { getDb } from '@/db/client';",
    expected: [DATABASE],
  },
  {
    name: 'e: export * of the tenant file in src/db',
    file: IN_DB,
    code: "export * from './tenant';",
    expected: [DATABASE],
  },
  {
    name: 'e: export * of the client file in src/db',
    file: IN_DB,
    code: "export * from './client';",
    expected: [DATABASE],
  },
  {
    name: 'e: export * as a namespace of the client file in src/db',
    file: IN_DB,
    code: "export * as db from './client';",
    expected: [DATABASE],
  },
  {
    name: 'e: an imported withTenant exported again under another name, in src/modules/auth',
    file: IN_AUTH,
    code: "import { withTenant } from '@/db/tenant'; export { withTenant as open };",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant imported under another name and exported, in src/db',
    file: IN_DB,
    code: "import { withTenant as open } from './tenant'; export { open };",
    expected: [DATABASE],
  },
  {
    name: 'e: the tenant file imported as a namespace and exported, in src/modules/auth',
    file: IN_AUTH,
    code: "import * as tenant from '@/db/tenant'; export { tenant };",
    expected: [DATABASE],
  },
  {
    name: 'e: an imported getDb exported, in src/db',
    file: IN_DB,
    code: "import { getDb } from './client'; export { getDb };",
    expected: [DATABASE],
  },
  {
    name: 'e: withTenant re-exported as the default, in src/modules/auth',
    file: IN_AUTH,
    code: "export { withTenant as default } from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: "e: withTenant re-exported from the wrappers' file",
    file: 'src/app/_lib/actions.ts',
    code: "export { withTenant } from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: "e: export * of the tenant file from the wrappers' file",
    file: 'src/app/_lib/actions.ts',
    code: "export * from '@/db/tenant';",
    expected: [DATABASE],
  },
  {
    name: 'e: connect re-exported in src/db',
    file: IN_DB,
    code: "export { connect } from './client';",
    expected: [DATABASE],
  },
  {
    name: 'e: anything else from the client file re-exported in src/db',
    file: IN_DB,
    code: "export { CONNECTION_TIMEOUT_MS } from './client';",
    expected: [DATABASE],
  },
  {
    name: 'e: export type { TenantTransaction } from the tenant file passes, in src/modules/auth',
    file: IN_AUTH,
    code: "export type { TenantTransaction } from '@/db/tenant';",
    expected: [],
  },
  {
    name: 'e: an inline type re-export of TenantTransaction passes, in src/db',
    file: IN_DB,
    code: "export { type TenantTransaction } from './tenant';",
    expected: [],
  },
  {
    name: 'e: a type-only import of TenantTransaction exported again passes, in src/modules/auth',
    file: IN_AUTH,
    code: `${TX} export type { TenantTransaction };`,
    expected: [],
  },
  {
    name: 'e: export type * of the client file passes, in src/db',
    file: IN_DB,
    code: "export type * from './client';",
    expected: [],
  },
  {
    name: 'e: a re-export of something else from the tenant file passes, in src/db',
    file: IN_DB,
    code: "export { LOCK_TIMEOUT_MS } from './tenant';",
    expected: [],
  },
  {
    name: "e: the auth module's index, as it is, passes",
    ...asItIs('src/modules/auth/index.ts'),
    expected: [],
  },
  {
    name: 'e: the login audit, as it is, passes',
    ...asItIs('src/modules/auth/login-audit.ts'),
    expected: [],
  },
  {
    name: 'e: the memberships file, as it is, passes',
    ...asItIs('src/modules/auth/memberships.ts'),
    expected: [],
  },
  {
    name: 'e: the auth library file, as it is, passes',
    ...asItIs('src/modules/auth/better-auth.ts'),
    expected: [],
  },
  ...['client', 'tenant', 'migrate', 'reset'].map((name) => ({
    name: `e: src/db/${name}.ts, as it is, passes`,
    ...asItIs(`src/db/${name}.ts`),
    expected: [],
  })),

  // E00-T10: database drivers, and the files that open connections of their own, only in src/db.
  ...[
    "import pg from 'pg'; export const pool = new pg.Pool();",
    "import PgBoss from 'pg-boss'; export { PgBoss };",
    "import { drizzle } from 'drizzle-orm/node-postgres'; export { drizzle };",
    "import { migrate } from 'drizzle-orm/node-postgres/migrator'; export { migrate };",
    "import { drizzle } from 'drizzle-orm/postgres-js'; export { drizzle };",
    "import { resetDatabase } from '@/db/reset'; export { resetDatabase };",
    "import { runMigrations } from '@/db/migrate'; export { runMigrations };",
  ].map((code) => ({
    name: `e: a driver in a module: ${code.split(';')[0]}`,
    file: IN_MODULE,
    code,
    expected: [DATABASE],
  })),
  {
    name: "e: 'pg' in a page",
    file: STAFF_PAGE,
    code: "import pg from 'pg'; export const pool = new pg.Pool();",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' in src/modules/auth",
    file: IN_AUTH,
    code: "import pg from 'pg'; export const pool = new pg.Pool();",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' in the wrappers' file",
    file: 'src/app/_lib/actions.ts',
    code: "import pg from 'pg'; export const pool = new pg.Pool();",
    expected: [DATABASE],
  },
  {
    name: "e: '@/db/reset' by a relative path in a module",
    file: IN_MODULE,
    code: "import { resetDatabase } from '../../db/reset.ts'; export { resetDatabase };",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' imported for its side effects only",
    file: IN_MODULE,
    code: "import 'pg'; export const a = 1;",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' with a dynamic import",
    file: IN_MODULE,
    code: "export const load = () => import('pg');",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' re-exported",
    file: IN_MODULE,
    code: "export * from 'pg';",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' through require()",
    file: 'src/modules/scheduling/slots.cjs',
    code: "const pg = require('pg'); module.exports = pg;",
    expected: [DATABASE],
  },
  {
    name: "e: a path of 'pg' itself",
    file: IN_MODULE,
    code: "import Client from 'pg/lib/client'; export { Client };",
    expected: [DATABASE],
  },
  {
    name: "e: a path inside 'drizzle-orm/pg-core' (only drizzle-orm/pg-core itself is allowed)",
    file: IN_MODULE,
    code: "import { PgSession } from 'drizzle-orm/pg-core/session'; export { PgSession };",
    expected: [DATABASE],
  },
  {
    name: "e: 'pg' in src/db passes",
    file: IN_DB,
    code: "import pg from 'pg'; export const pool = new pg.Pool();",
    expected: [],
  },
  {
    name: "e: a type-only import of 'pg' in a module passes",
    file: IN_MODULE,
    code: "import type { PoolClient } from 'pg'; export type Client = PoolClient;",
    expected: [],
  },
  {
    name: "e: an inline type import of 'pg' in a module passes",
    file: IN_MODULE,
    code: "import { type PoolClient } from 'pg'; export type Client = PoolClient;",
    expected: [],
  },
  {
    name: "e: a driver's import('…') used as a type in a module passes",
    file: IN_MODULE,
    code: "export type Db = import('drizzle-orm/node-postgres').NodePgDatabase;",
    expected: [],
  },
  {
    name: "e: 'drizzle-orm' and 'drizzle-orm/pg-core' in a module pass",
    file: IN_MODULE,
    code: "import { sql } from 'drizzle-orm'; import { pgTable } from 'drizzle-orm/pg-core'; export const a = [sql, pgTable];",
    expected: [],
  },
  // E00-T11: no handle passed on by export default (D-084).
  {
    name: 'e: export default withTenant, imported from @/db/tenant, in src/modules/auth',
    file: IN_AUTH,
    code: "import { withTenant } from '@/db/tenant'; export default withTenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: export default withTenant, imported from @/db/tenant, in src/db',
    file: IN_DB,
    code: "import { withTenant } from '@/db/tenant'; export default withTenant;",
    expected: [DATABASE],
  },
  {
    name: "e: export default withTenant, imported from @/db/tenant, in the wrappers' file",
    file: 'src/app/_lib/actions.ts',
    code: "import { withTenant } from '@/db/tenant'; export default withTenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: export default getDb, imported from the client file, in src/db',
    file: IN_DB,
    code: "import { getDb } from './client'; export default getDb;",
    expected: [DATABASE],
  },
  {
    name: 'e: export default of the tenant file imported as a namespace, in src/modules/auth',
    file: IN_AUTH,
    code: "import * as tenant from '@/db/tenant'; export default tenant;",
    expected: [DATABASE],
  },
  {
    name: 'e: export default of a function declared in the same file passes, in src/modules/auth',
    file: IN_AUTH,
    code: "import { withTenant } from '@/db/tenant'; export default async function countMarks(clinicId: string) { return withTenant(clinicId, async () => 0); }",
    expected: [],
  },
  {
    name: 'e: export default of a function named in the same file passes, in src/db',
    file: IN_DB,
    code: 'function twice(n: number) { return n * 2; } export default twice;',
    expected: [],
  },
  {
    name: 'e: export default of something else from the tenant file passes, in src/db',
    file: IN_DB,
    code: "import { LOCK_TIMEOUT_MS } from './tenant'; export default LOCK_TIMEOUT_MS;",
    expected: [],
  },
  // E00-T11: src/db/ passes no driver on: any file may import any file there (D-084).
  ...[
    "export { Pool } from 'pg';",
    "export * from 'pg';",
    "export * as pg from 'pg';",
    "export { drizzle } from 'drizzle-orm/node-postgres';",
    "export * from './reset';",
    "export { runMigrations } from '@/db/migrate';",
    "import { Pool } from 'pg'; export { Pool };",
    "import * as pg from 'pg'; export { pg };",
    "import pg from 'pg'; export default pg;",
  ].map((code) => ({
    name: `e: a driver passed on from a new file in src/db: ${code}`,
    file: IN_DB,
    code,
    expected: [DATABASE],
  })),
  {
    name: "e: export type { PoolConfig } from 'pg' passes, in src/db",
    file: IN_DB,
    code: "export type { PoolConfig } from 'pg';",
    expected: [],
  },
  {
    name: "e: an inline type re-export of 'pg' passes, in src/db",
    file: IN_DB,
    code: "export { type PoolConfig } from 'pg';",
    expected: [],
  },
  {
    name: "e: a Pool imported from 'pg' and used only inside the file passes, in src/db",
    file: IN_DB,
    code: "import { Pool } from 'pg'; const pool = new Pool(); export async function ping() { await pool.query('select 1'); }",
    expected: [],
  },
  {
    name: 'e: src/db/required-env.ts, as it is, passes',
    ...asItIs('src/db/required-env.ts'),
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
    name: 'f (tester): an un-awaited tx.update(…).set(…).where(…)',
    file: IN_MODULE,
    code: `${TABLE} ${TX} import { eq } from 'drizzle-orm'; export async function touch(tx: TenantTransaction, id: string) { tx.update(marks).set({ id }).where(eq(marks.id, id)); }`,
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
  // E00-T10: only errors are rejected, and nothing hangs a handler on a promise and walks away.
  {
    name: 'f: return Promise.reject({ cause: e })',
    file: IN_MODULE,
    code: 'export async function load(read: () => Promise<void>) { try { await read(); } catch (e) { return Promise.reject({ cause: e }); } }',
    expected: [REJECTED],
  },
  {
    name: 'f: reject({ code }) in a new Promise',
    file: IN_MODULE,
    code: "export function wait(ok: boolean) { return new Promise<void>((resolve, reject) => { if (ok) resolve(); else reject({ code: 'not_ok' }); }); }",
    expected: [REJECTED],
  },
  {
    name: 'f: rejecting with a caught error passes',
    file: IN_MODULE,
    code: 'export async function load(read: () => Promise<void>) { try { await read(); } catch (error) { return Promise.reject(error); } }',
    expected: [],
  },
  {
    name: 'f: rejecting with what withoutQueryValues() returns passes',
    file: IN_MODULE,
    code: "import { withoutQueryValues } from '@/lib/query-errors'; export async function load(read: () => Promise<void>) { try { await read(); } catch (error) { return Promise.reject(withoutQueryValues(error)); } }",
    expected: [],
  },
  {
    name: 'f: rejecting with a new Error passes',
    file: IN_MODULE,
    code: "export function wait(ok: boolean) { return new Promise<void>((resolve, reject) => { if (ok) resolve(); else reject(new Error('not ok')); }); }",
    expected: [],
  },
  {
    name: 'f: tx.insert(…).catch(() => {}) as a statement in a module',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }).catch(() => {}); }`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).then(ok, fail) as a statement in a module',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }).then(() => {}, () => {}); }`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).catch(() => {}) as a statement in an action file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { tx.insert(marks).values({ id: 'x' }).catch(() => {}); });`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).then(ok, fail) as a statement in an action file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { tx.insert(marks).values({ id: 'x' }).then(() => {}, () => {}); });`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: p?.catch(…) as a statement',
    file: IN_MODULE,
    code: 'export function forget(p: Promise<void> | undefined) { p?.catch(() => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: 'f: p.catch?.(…) as a statement',
    file: 'src/lib/forget.ts',
    code: 'export function forget(p: Promise<void>) { p.catch?.(() => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: "f: p['catch'](…) as a statement",
    file: 'src/lib/forget.ts',
    code: "export function forget(p: Promise<void>) { p['catch'](() => {}); }",
    expected: [UNAWAITED],
  },
  {
    name: 'f: a .then(ok, fail) statement in a .mts file',
    file: 'src/lib/forget.mts',
    code: 'export function forget(p: Promise<void>) { p.then(() => {}, () => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: 'f: the same .catch(…) awaited passes',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { await tx.insert(marks).values({ id }).catch(() => {}); }`,
    expected: [],
  },
  {
    name: 'f: the same .then(ok, fail) returned passes',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { return tx.insert(marks).values({ id: 'x' }).then(() => {}, () => {}); });`,
    expected: [],
  },
  {
    name: 'f: a .then(ok, fail) statement in a client .tsx component passes',
    file: 'src/app/(staff)/save-button.tsx',
    code: '\'use client\'; export function SaveButton({ save }: { save: () => Promise<void> }) { return <button type="button" onClick={() => { save().then(() => {}, () => {}); }}>Save</button>; }',
    expected: [],
  },
  {
    name: 'f: a one-argument .then(…) statement is still no-floating-promises alone',
    file: IN_MODULE,
    code: 'export function forget(p: Promise<void>) { p.then(() => {}); }',
    expected: [FLOATING],
  },
  {
    name: 'f: Date.now() in a module is still reported next to a .catch(…) statement',
    file: IN_MODULE,
    code: 'export const a = Date.now(); export function forget(p: Promise<void>) { p.catch(() => {}); }',
    expected: [CLOCK, UNAWAITED],
  },
  // no-floating-promises follows a .finally(…) back to the promise it hangs on, so a .finally(…)
  // after .catch(…) or .then(ok, fail) passes it: the statement is reported by its last call.
  {
    name: 'f: tx.insert(…).catch(…).finally(…) as a statement in a module',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }).catch(() => {}).finally(() => {}); }`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).then(ok, fail).finally(…) as a statement in a module',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }).then(() => {}, () => {}).finally(() => {}); }`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).catch(…).finally(…) as a statement in an action file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { tx.insert(marks).values({ id: 'x' }).catch(() => {}).finally(() => {}); });`,
    expected: [UNAWAITED],
  },
  {
    name: 'f: tx.insert(…).then(ok, fail).finally(…) as a statement in an action file',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { tx.insert(marks).values({ id: 'x' }).then(() => {}, () => {}).finally(() => {}); });`,
    expected: [UNAWAITED],
  },
  {
    name: "f: p.catch(…)['finally'](…) as a statement",
    file: 'src/lib/forget.ts',
    code: "export function forget(p: Promise<void>) { p.catch(() => {})['finally'](() => {}); }",
    expected: [UNAWAITED],
  },
  {
    name: 'f: p.catch(…)[`finally`](…) as a statement',
    file: 'src/lib/forget.ts',
    code: 'export function forget(p: Promise<void>) { p.catch(() => {})[`finally`](() => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: 'f: p?.catch(…).finally(…) as a statement',
    file: IN_MODULE,
    code: 'export function forget(p: Promise<void> | undefined) { p?.catch(() => {}).finally(() => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: 'f: p.catch(…).finally?.(…) as a statement',
    file: 'src/lib/forget.ts',
    code: 'export function forget(p: Promise<void>) { p.catch(() => {}).finally?.(() => {}); }',
    expected: [UNAWAITED],
  },
  {
    name: 'f: a .finally(…) statement on a promise nobody handles gets both reports',
    file: 'src/lib/forget.ts',
    code: 'export function forget(p: Promise<void>) { p.finally(() => {}); }',
    expected: [FLOATING, UNAWAITED],
  },
  {
    name: 'f: the same .catch(…).finally(…) awaited passes',
    file: IN_MODULE,
    code: `${TABLE} ${TX} export async function mark(tx: TenantTransaction, id: string) { await tx.insert(marks).values({ id }).catch(() => {}).finally(() => {}); }`,
    expected: [],
  },
  {
    name: 'f: the same .then(ok, fail).finally(…) returned passes',
    file: STAFF_ACTIONS,
    code: `${USE_SERVER} ${WRAPPERS} ${ARGS} ${TABLE} ${TX} export const mark = staffAction(spec, async ({ tx }: { tx: TenantTransaction }) => { return tx.insert(marks).values({ id: 'x' }).then(() => {}, () => {}).finally(() => {}); });`,
    expected: [],
  },

  // (g) A form never puts its fields in the URL (D-076). Type-aware.
  {
    name: 'g: a form with only onSubmit',
    file: STAFF_FORM,
    code: form(
      '<form onSubmit={find}><input name="q" /></form>',
      'declare const find: () => void;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: method="get"',
    file: STAFF_FORM,
    code: form('<form method="get" action="/patients"><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: an action URL without method="post"',
    file: STAFF_FORM,
    code: form('<form action="/patients"><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: an action URL in a string variable without method="post"',
    file: STAFF_FORM,
    code: form('<form action={url}><input name="q" /></form>', "const url = '/patients';"),
    expected: [FORMS],
  },
  {
    name: 'g: method="post" without an action',
    file: STAFF_FORM,
    code: form('<form method="post"><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: action=""',
    file: STAFF_FORM,
    code: form('<form method="post" action=""><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: an action typed as a string-or-function union',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={action}><input name="q" /></form>',
      'declare const action: string | ((formData: FormData) => void);',
    ),
    expected: [FORMS],
  },
  {
    name: "g: an action typed with React's own type for it, a union like the one above",
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={action}><input name="q" /></form>',
      "declare const action: import('react').ComponentProps<'form'>['action'];",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a button with formMethod="get"',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formMethod="get">Search</button></form>',
      'declare const save: (formData: FormData) => Promise<void>;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: the login form, as it is, passes',
    ...asItIs('src/app/(auth)/login/login-form.tsx'),
    expected: [],
  },
  {
    name: 'g: the clinic picker, as it is, passes',
    ...asItIs('src/app/(auth)/choose-clinic/page.tsx'),
    expected: [],
  },
  {
    name: 'g: a form whose action is a function passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><input name="q" /></form>',
      'declare const save: (formData: FormData) => Promise<void>;',
    ),
    expected: [],
  },
  {
    name: 'g: method="post" and an action URL in a string variable pass',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={url}><input name="q" /></form>',
      "const url = '/patients';",
    ),
    expected: [],
  },
  {
    name: 'g: method="POST" in capitals passes',
    file: STAFF_FORM,
    code: form('<form method="POST" action="/patients"><input name="q" /></form>'),
    expected: [],
  },
  {
    name: 'g: method as an expression',
    file: STAFF_FORM,
    code: form(
      '<form method={method} action="/patients"><input name="q" /></form>',
      "const method = 'post';",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: an action typed any',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={action}><input name="q" /></form>',
      'declare const action: any;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: an action typed unknown',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={action}><input name="q" /></form>',
      'declare const action: unknown;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: an action that may be undefined',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action={action}><input name="q" /></form>',
      'declare const action: string | undefined;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: an action of only spaces',
    file: STAFF_FORM,
    code: form('<form method="post" action=" "><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: an empty template literal as the action',
    file: STAFF_FORM,
    code: form('<form method="post" action={``}><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: a spread gives the form its props, and no action is written',
    file: STAFF_FORM,
    code: form(
      '<form {...props}><input name="q" /></form>',
      "declare const props: import('react').ComponentProps<'form'>;",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a spread after the action, which could replace it',
    file: STAFF_FORM,
    code: form(
      '<form action={save} {...props}><input name="q" /></form>',
      "declare const save: (formData: FormData) => Promise<void>; declare const props: import('react').ComponentProps<'form'>;",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a spread after method="post", which could replace it',
    file: STAFF_FORM,
    code: form(
      '<form action="/patients" method="post" {...props}><input name="q" /></form>',
      "declare const props: import('react').ComponentProps<'form'>;",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a spread before a function action passes',
    file: STAFF_FORM,
    code: form(
      '<form {...props} action={save}><input name="q" /></form>',
      "declare const save: (formData: FormData) => Promise<void>; declare const props: import('react').ComponentProps<'form'>;",
    ),
    expected: [],
  },
  {
    name: 'g: an input with formMethod="get"',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><input type="submit" formMethod="get" /></form>',
      'declare const save: (formData: FormData) => Promise<void>;',
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a button with formMethod as an expression',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formMethod={method}>Search</button></form>',
      "declare const save: (formData: FormData) => Promise<void>; const method = 'post';",
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a button with formMethod="post" passes',
    file: STAFF_FORM,
    code: form(
      '<form method="post" action="/patients"><button formMethod="post">Search</button></form>',
    ),
    expected: [],
  },
  {
    name: 'g: an action without a value, which React drops',
    file: STAFF_FORM,
    code: form('<form method="post" action><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: "g: method={'post'}, an expression",
    file: STAFF_FORM,
    code: form('<form method={\'post\'} action="/patients"><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: method=" post ", which HTML reads as get',
    file: STAFF_FORM,
    code: form('<form method=" post " action="/patients"><input name="q" /></form>'),
    expected: [FORMS],
  },
  {
    name: 'g: an action typed as a type parameter that may be a string or a function',
    file: STAFF_FORM,
    code: 'export function Search<A extends string | (() => void)>({ action }: { action: A }) { return <form method="post" action={action}><input name="q" /></form>; }',
    expected: [FORMS],
  },
  {
    name: 'g: an action typed as a type parameter that is a URL passes',
    file: STAFF_FORM,
    code: 'export function Search<A extends \'/patients\' | \'/staff\'>({ action }: { action: A }) { return <form method="post" action={action}><input name="q" /></form>; }',
    expected: [],
  },
  // E00-T10: a button's or input's own URL (D-081).
  {
    name: 'g: <button formAction="/patients"> in a form whose action is a function',
    file: STAFF_FORM,
    code: form('<form action={save}><button formAction="/patients">Search</button></form>', SAVE),
    expected: [FORMS],
  },
  {
    name: 'g: <input type="submit" formAction="/patients">',
    file: STAFF_FORM,
    code: form('<form action={save}><input type="submit" formAction="/patients" /></form>', SAVE),
    expected: [FORMS],
  },
  {
    name: 'g: a formAction URL in a string variable without formMethod',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={url}>Search</button></form>',
      `${SAVE} const url = '/patients';`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: formAction="" with formMethod="post"',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction="" formMethod="post">Search</button></form>',
      SAVE,
    ),
    expected: [FORMS],
  },
  {
    name: "g: a formAction typed ComponentProps<'button'>['formAction'] with formMethod=\"post\"",
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={go} formMethod="post">Search</button></form>',
      `${SAVE} ${PROPS} declare const go: ComponentProps<'button'>['formAction'];`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a formAction typed any with formMethod="post"',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={go} formMethod="post">Search</button></form>',
      `${SAVE} declare const go: any;`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: a formAction URL with formMethod as an expression: one report per attribute',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction="/patients" formMethod={method}>Search</button></form>',
      `${SAVE} const method = 'post';`,
    ),
    expected: [FORMS, FORMS],
  },
  {
    name: 'g: formaction written in lower case',
    file: STAFF_FORM,
    code: form('<form action={save}><button formaction="/patients">Search</button></form>', SAVE),
    expected: [FORMS],
  },
  {
    name: 'g: a formAction function passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={remove}>Remove</button></form>',
      `${SAVE} declare const remove: (formData: FormData) => Promise<void>;`,
    ),
    expected: [],
  },
  {
    name: 'g: a formAction function-or-undefined passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={remove}>Remove</button></form>',
      `${SAVE} declare const remove: ((formData: FormData) => Promise<void>) | undefined;`,
    ),
    expected: [],
  },
  {
    name: 'g: formAction={undefined} passes',
    file: STAFF_FORM,
    code: form('<form action={save}><button formAction={undefined}>Save</button></form>', SAVE),
    expected: [],
  },
  {
    name: 'g: a formAction without a value passes (the form is checked on its own)',
    file: STAFF_FORM,
    code: form('<form action={save}><button formAction>Save</button></form>', SAVE),
    expected: [],
  },
  {
    name: 'g: a formAction URL with formMethod="post" passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction="/patients" formMethod="post">Search</button></form>',
      SAVE,
    ),
    expected: [],
  },
  {
    name: 'g: a formAction URL with formMethod="POST" passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><input type="submit" formAction="/patients" formMethod="POST" /></form>',
      SAVE,
    ),
    expected: [],
  },
  {
    name: 'g: a formAction URL in a string variable with formMethod="post" passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction={url} formMethod="post">Search</button></form>',
      `${SAVE} const url = '/patients';`,
    ),
    expected: [],
  },
  // E00-T10: a spread onto a button or input that could carry formAction or formMethod (D-081).
  {
    name: "g: a spread onto <button> typed ComponentProps<'button'>",
    file: STAFF_FORM,
    code: `${PROPS} export function Button(props: ComponentProps<'button'>) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: "g: a spread onto <button> typed Omit<ComponentProps<'button'>, 'formAction'>",
    file: STAFF_FORM,
    code: `${PROPS} export function Button(props: Omit<ComponentProps<'button'>, 'formAction'>) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> typed any',
    file: STAFF_FORM,
    code: 'export function Button(props: any) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> typed unknown',
    file: STAFF_FORM,
    code: 'declare const props: unknown; export function Button() { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> typed Record<string, string>',
    file: STAFF_FORM,
    code: 'export function Button(props: Record<string, string>) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: "g: a spread onto <button> typed as a type parameter constrained by ComponentProps<'button'>",
    file: STAFF_FORM,
    code: `${PROPS} export function Button<P extends ComponentProps<'button'>>(props: P) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> typed as a type parameter without a constraint',
    file: STAFF_FORM,
    code: 'export function Button<P,>(props: P) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> typed as a type parameter constrained by object',
    file: STAFF_FORM,
    code: 'export function Button<P extends object>(props: P & { label: string }) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> whose type has formMethod only, before the other props',
    file: STAFF_FORM,
    code: 'declare const props: { formMethod?: string }; export function Button() { return <button {...props} type="submit" />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> whose type has formaction in lower case',
    file: STAFF_FORM,
    code: 'declare const props: { formaction: string }; export function Button() { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: "g: a spread onto <input> typed ComponentProps<'input'>",
    file: STAFF_FORM,
    code: `${PROPS} export function Field(props: ComponentProps<'input'>) { return <input {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: "g: a spread typed Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'> passes",
    file: STAFF_FORM,
    code: `${PROPS} export function Button(props: Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>) { return <button {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a button component of that type with a function formAction written after the spread passes',
    file: STAFF_FORM,
    code: `${PROPS} type ButtonProps = Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'> & { formAction?: (formData: FormData) => void | Promise<void> }; export function Button({ formAction, ...rest }: ButtonProps) { return <button {...rest} formAction={formAction} />; }`,
    expected: [],
  },
  {
    name: 'g: {...{ disabled: pending }} passes',
    file: STAFF_FORM,
    code: 'export function Button({ pending }: { pending: boolean }) { return <button {...{ disabled: pending }}>Save</button>; }',
    expected: [],
  },
  {
    name: "g: an input spread of a form library's name, onChange, onBlur and ref passes",
    file: STAFF_FORM,
    code: 'declare const field: { name: string; onChange: (event: unknown) => void; onBlur: (event: unknown) => void; ref: (element: HTMLInputElement | null) => void }; export function Field() { return <input {...field} />; }',
    expected: [],
  },
  // E00-T10: next/form, whose <Form> sends a URL action as a GET (D-081).
  {
    name: "g: import Form from 'next/form' in a page",
    file: STAFF_PAGE,
    code: 'import Form from \'next/form\'; export default function Page() { return <Form action="/patients"><input name="q" /></Form>; }',
    expected: [FORMS],
  },
  {
    name: "g: import Form from 'next/form' in a client component",
    file: STAFF_FORM,
    code: '\'use client\'; import Form from \'next/form\'; export function Search() { return <Form action="/patients"><input name="q" /></Form>; }',
    expected: [FORMS],
  },
  ...[
    "import { default as F } from 'next/form'; export { F };",
    "import Form, { type FormProps } from 'next/form'; export { Form }; export type P = FormProps;",
    "export { default } from 'next/form';",
    "export * from 'next/form';",
    "export const load = () => import('next/form');",
    'export const load = () => import(`next/form`);',
    "import Form from 'next/form.js'; export { Form };",
    "import Form from 'next/dist/client/form'; export { Form };",
    "import Form from 'next/dist/client/form.js'; export { Form };",
    // What next/form becomes in a build: dist/api/form re-exports dist/client/form, and App Router
    // code gets dist/client/app-dir/form. Both have types; the dist/esm/ copies do not.
    "import Form from 'next/dist/api/form'; export { Form };",
    "import Form from 'next/dist/api/form.js'; export { Form };",
    "import Form from 'next/dist/client/app-dir/form'; export { Form };",
    "import Form from 'next/dist/client/app-dir/form.js'; export { Form };",
    "import Form from 'next/dist/esm/client/app-dir/form'; export { Form };",
  ].map((code) => ({
    name: `g: next/form loaded: ${code}`,
    file: STAFF_FORM,
    code,
    expected: [FORMS],
  })),
  ...[
    "import type { FormProps } from 'next/form'; export type P = FormProps;",
    "import { type FormProps } from 'next/form'; export type P = FormProps;",
    "export type { FormProps } from 'next/form';",
    'import Link from \'next/link\'; export function Nav() { return <Link href="/patients">Patients</Link>; }',
    // The helpers both <Form> components share, not a component.
    "import { checkFormActionUrl } from 'next/dist/client/form-shared'; export const check = checkFormActionUrl;",
  ].map((code) => ({
    name: `g: passes: ${code.split(';')[0]}`,
    file: STAFF_FORM,
    code,
    expected: [],
  })),
  // E00-T10 test: shapes a later edit to the rule could let through while every case above passes.
  {
    // HTML reads formmethod=" post" as get, as it does method=" post ": no trimming.
    name: 'g: formMethod=" post" next to a formAction URL, which HTML reads as get',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><button formAction="/patients" formMethod=" post">Search</button></form>',
      SAVE,
    ),
    expected: [FORMS, FORMS],
  },
  {
    // An index signature whose key is a pattern holds formAction too, not only a string index.
    name: 'g: a spread typed with a template-literal index signature',
    file: STAFF_FORM,
    code: 'export function Button(props: Record<`form${string}`, string>) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    // The rule covers .ts files too: a .ts file that passed <Form> on would give every .tsx file a
    // way to it that names no next/form path.
    name: 'g: next/form re-exported from a .ts file',
    file: 'src/ui/form.ts',
    code: "export { default as Form } from 'next/form';",
    expected: [FORMS],
  },
  ...[
    // The two untyped copies under dist/esm/ that no case above names.
    "import Form from 'next/dist/esm/api/form'; export { Form };",
    "import Form from 'next/dist/esm/client/form.js'; export { Form };",
  ].map((code) => ({
    name: `g: next/form loaded: ${code}`,
    file: STAFF_FORM,
    code,
    expected: [FORMS],
  })),
  // E00-T11: a component is checked as a button is: it may hand its props to one (D-084).
  {
    name: "g: shadcn/ui's Button: <Comp {...props} /> with ComponentProps<'button'> & { asChild?: boolean }",
    file: UI_FILE,
    code: `${REACT} ${SLOT} export function Button({ asChild = false, ...props }: ComponentProps<'button'> & { asChild?: boolean }) { const Comp = asChild ? Slot : 'button'; return <Comp data-slot="button" {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: <Root {...props} /> with props typed ComponentProps<typeof Root>, Root taking button props',
    file: 'src/ui/checkbox.tsx',
    code: `${REACT} declare const Root: ForwardRefExoticComponent<ComponentPropsWithoutRef<'button'> & RefAttributes<HTMLButtonElement>>; export function Checkbox(props: ComponentProps<typeof Root>) { return <Root {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: <CheckboxPrimitive.Root {...props} />, a component written as a member expression',
    file: 'src/ui/checkbox.tsx',
    code: `${REACT} declare const CheckboxPrimitive: { Root: ForwardRefExoticComponent<ComponentPropsWithoutRef<'button'> & RefAttributes<HTMLButtonElement>> }; export function Checkbox(props: ComponentProps<typeof CheckboxPrimitive.Root>) { return <CheckboxPrimitive.Root {...props} />; }`,
    expected: [FORMS],
  },
  // E00-T11 tester: D-085's component is any name that does not start with a lower-case letter, and
  // any member expression, as React and TypeScript read them: not only a capitalised name.
  {
    name: 'g: <_Button type="submit" formAction="/patients">, a component whose name starts with _',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><_Button type="submit" formAction="/patients">Search</_Button></form>',
      `${SAVE} ${REACT} declare function _Button(props: ComponentProps<'button'>): ReactNode;`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: <motion.button formMethod="get">, a member expression in lower case',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><motion.button formMethod="get">Search</motion.button></form>',
      `${SAVE} ${REACT} declare const motion: { button: (props: ComponentProps<'button'>) => ReactNode };`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: <Button type="submit" formAction="/patients">, Button taking ComponentProps<\'button\'>',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><Button type="submit" formAction="/patients">Search</Button></form>',
      `${SAVE} ${REACT} declare function Button(props: ComponentProps<'button'>): ReactNode;`,
    ),
    expected: [FORMS],
  },
  {
    name: 'g: <Button formMethod="get">, Button taking ComponentProps<\'button\'>',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><Button formMethod="get">Search</Button></form>',
      `${SAVE} ${REACT} declare function Button(props: ComponentProps<'button'>): ReactNode;`,
    ),
    expected: [FORMS],
  },
  {
    name: "g: <Btn {...extra} />, Btn's props without the two, extra typed { type: 'submit'; formAction: string }",
    file: STAFF_FORM,
    code: form(
      '<form action={save}><Btn {...extra} /></form>',
      `${SAVE} ${REACT} declare function Btn(props: ${NO_SUBMIT}): ReactNode; declare const extra: { type: 'submit'; formAction: string };`,
    ),
    expected: [FORMS],
  },
  {
    // The E00-T10 tester's caller: an inferred type argument gets no excess-property check.
    name: 'g: <Button formAction="/patients"> on a generic Button whose constraint omits the two',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><Button type="submit" formAction="/patients">Search</Button></form>',
      `${SAVE} ${REACT} declare function Button<P extends ${NO_SUBMIT}>(props: P): ReactNode;`,
    ),
    expected: [FORMS],
  },
  {
    name: "g: shadcn/ui's Button with Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'> passes",
    file: UI_FILE,
    code: `${REACT} ${SLOT} export function Button({ asChild = false, ...props }: ${NO_SUBMIT} & { asChild?: boolean }) { const Comp = asChild ? Slot : 'button'; return <Comp data-slot="button" {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: <Button formAction={save}> with a function passes',
    file: STAFF_FORM,
    code: form(
      '<form action={save}><Button formAction={save}>Save</Button></form>',
      `${SAVE} ${REACT} declare function Button(props: ${NO_SUBMIT} & { formAction?: (formData: FormData) => void | Promise<void> }): ReactNode;`,
    ),
    expected: [],
  },
  {
    name: "g: <Input {...field} /> with a form library's name, onChange, onBlur and ref passes",
    file: STAFF_FORM,
    code: `${REACT} declare function Input(props: ComponentProps<'input'>): ReactNode; declare const field: { name: string; onChange: (event: unknown) => void; onBlur: (event: unknown) => void; ref: (element: HTMLInputElement | null) => void }; export function Field() { return <Input {...field} />; }`,
    expected: [],
  },
  {
    name: 'g: <Input {...{ disabled: pending }} /> passes',
    file: STAFF_FORM,
    code: `${REACT} declare function Input(props: ComponentProps<'input'>): ReactNode; export function Field({ pending }: { pending: boolean }) { return <Input {...{ disabled: pending }} />; }`,
    expected: [],
  },
  {
    name: 'g: <Link {...props} /> with ComponentProps<typeof Link> from next/link passes',
    file: 'src/ui/nav-link.tsx',
    code: `${REACT} import Link from 'next/link'; export function NavLink(props: ComponentProps<typeof Link>) { return <Link {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: <Box {...props} /> with PropsWithChildren<{ title: string }> passes',
    file: 'src/ui/panel.tsx',
    code: `${REACT} declare function Box(props: PropsWithChildren<{ title: string }>): ReactNode; export function Panel(props: PropsWithChildren<{ title: string }>) { return <Box {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a spread onto <div> passes: other HTML elements have neither prop',
    file: UI_FILE,
    code: 'export function Card(props: Record<string, string>) { return <div {...props} />; }',
    expected: [],
  },
  // E00-T11: a type parameter may hold more than its constraint, so a spread of a type built from
  // one passes only when the constraint types formAction and formMethod as undefined or never.
  {
    name: "g: a spread onto <button> of props: P with P extends Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>",
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NO_SUBMIT}>(props: P) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> of props: P with P extends PropsWithChildren',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends PropsWithChildren>(props: P) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> of Partial<P> with P extends object',
    file: UI_FILE,
    code: 'export function Button<P extends object>(props: Partial<P>) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> of Pick<P, K> with P extends object',
    file: UI_FILE,
    code: 'export function Button<P extends object, K extends keyof P>(props: Pick<P, K>) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: "g: <Comp {...props} /> with props: P and P extends Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>",
    file: UI_FILE,
    code: `${REACT} ${SLOT} export function Button<P extends ${NO_SUBMIT}>(props: P) { const Comp = Slot; return <Comp {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a generic shadcn/ui Button whose constraint omits the two: <Comp {...props} /> of the rest',
    file: UI_FILE,
    code: `${REACT} ${SLOT} export function Button<P extends ${NO_SUBMIT}>({ asChild = false, ...props }: P & { asChild?: boolean }) { const Comp = asChild ? Slot : 'button'; return <Comp {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: "g: a spread onto <button> of Omit<P, 'children'> with P extends ComponentProps<'button'>",
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ComponentProps<'button'>>(props: Omit<P, 'children'>) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    // The constraint itself must type both away: P alone could still hold a formAction URL.
    name: "g: a spread of P & { formAction?: never; formMethod?: never } with P extends ComponentProps<'button'>",
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ComponentProps<'button'>>(props: P & { formAction?: never; formMethod?: never }) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread of P whose constraint types the two as never but adds formaction in lower case',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NEVER_SUBMIT} & { formaction?: string }>(props: P) { return <button {...props} />; }`,
    expected: [FORMS],
  },
  {
    name: 'g: a spread of a mapped type written out over P, with P extends object',
    file: UI_FILE,
    code: 'export function Button<P extends object>(props: { [K in keyof P]: P[K] }) { return <button {...props} />; }',
    expected: [FORMS],
  },
  {
    name: 'g: a spread onto <button> of props: P with P extends Omit<…> & { formAction?: never; formMethod?: never } passes',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NEVER_SUBMIT}>(props: P) { return <button {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a spread onto <button> of Partial<P> with that constraint passes',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NEVER_SUBMIT}>(props: Partial<P>) { return <button {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a generic shadcn/ui Button with that constraint passes: <Comp {...props} /> of the rest',
    file: UI_FILE,
    code: `${REACT} ${SLOT} export function Button<P extends ${NEVER_SUBMIT}>({ asChild = false, ...props }: P & { asChild?: boolean }) { const Comp = asChild ? Slot : 'button'; return <Comp {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a spread of P & { label: string } with that constraint passes',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NEVER_SUBMIT}>(props: P & { label: string }) { return <button {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a spread of a mapped type written out over P with that constraint passes',
    file: UI_FILE,
    code: `${REACT} export function Button<P extends ${NEVER_SUBMIT}>(props: { [K in keyof P]: P[K] }) { return <button {...props} />; }`,
    expected: [],
  },
  {
    name: 'g: a spread typed { formAction?: undefined; disabled: boolean } passes',
    file: UI_FILE,
    code: 'declare const props: { formAction?: undefined; disabled: boolean }; export function Button() { return <button {...props} />; }',
    expected: [],
  },
  {
    name: 'g: a spread typed { formAction?: never; formMethod?: never; disabled?: boolean } passes',
    file: UI_FILE,
    code: 'declare const props: { formAction?: never; formMethod?: never; disabled?: boolean }; export function Button() { return <button {...props} />; }',
    expected: [],
  },

  // (h) No lint comment switches a guard off in src/ (D-077): ESLint ignores it and reports it.
  {
    name: "h: '// eslint-disable-next-line chairside/server-actions' switches nothing off",
    file: STAFF_ACTIONS,
    code: `${USE_SERVER}\n// eslint-disable-next-line chairside/server-actions\nexport async function save() {}`,
    expected: [INLINE_CONFIG, SERVER_ACTIONS],
  },
  {
    name: "h: '/* eslint-disable */' switches off no server-actions report",
    file: STAFF_ACTIONS,
    code: `/* eslint-disable */\n${USE_SERVER}\nexport async function save() {}`,
    expected: [INLINE_CONFIG, SERVER_ACTIONS],
  },
  {
    name: "h: '// eslint-disable-next-line chairside/database-access' switches nothing off",
    file: IN_MODULE,
    code: "// eslint-disable-next-line chairside/database-access\nimport { getDb } from '@/db/client';\nexport const db = getDb;",
    expected: [INLINE_CONFIG, DATABASE],
  },
  {
    name: "h: '/* eslint-disable chairside/database-access */' for the whole file switches nothing off",
    file: IN_MODULE,
    code: "/* eslint-disable chairside/database-access */\nimport { getDb } from '@/db/client';\nexport const db = getDb;",
    expected: [INLINE_CONFIG, DATABASE],
  },
  {
    name: 'h: an eslint-disable-next-line comment does not switch the clock rule off',
    file: IN_MODULE,
    code: '// eslint-disable-next-line no-restricted-syntax\nexport const a = Date.now();',
    expected: [INLINE_CONFIG, CLOCK],
  },
  {
    name: 'h: a file-wide eslint-disable comment does not switch the clock rule off',
    file: IN_MODULE,
    code: '/* eslint-disable */\nexport const a = Date.now();',
    expected: [INLINE_CONFIG, CLOCK],
  },
  {
    name: 'h: an eslint-disable-next-line comment does not switch no-floating-promises off',
    file: IN_MODULE,
    code: `${TABLE} ${TX}\nexport async function mark(tx: TenantTransaction, id: string) {\n// eslint-disable-next-line @typescript-eslint/no-floating-promises\ntx.insert(marks).values({ id });\n}`,
    expected: [INLINE_CONFIG, FLOATING],
  },
  {
    name: 'h: a file-wide eslint-disable comment does not switch no-floating-promises off',
    file: IN_MODULE,
    code: `/* eslint-disable @typescript-eslint/no-floating-promises */\n${TABLE} ${TX}\nexport async function mark(tx: TenantTransaction, id: string) { tx.insert(marks).values({ id }); }`,
    expected: [INLINE_CONFIG, FLOATING],
  },
  {
    name: 'h: an eslint-disable-line comment switches nothing off',
    file: IN_MODULE,
    code: 'export const a = Date.now(); // eslint-disable-line',
    expected: [CLOCK, INLINE_CONFIG],
  },
  {
    name: "h: a comment that sets a rule's severity switches nothing off",
    file: IN_MODULE,
    code: "/* eslint no-restricted-syntax: 'off' */\nexport const a = Date.now();",
    expected: [INLINE_CONFIG, CLOCK],
  },
  // E00-T11: outside src/ too, where chairside/server-actions runs as well (D-084).
  {
    name: "h: '/* eslint-disable */' in a 'use server' file outside src/ switches nothing off",
    file: 'lib/actions.ts',
    code: `/* eslint-disable */\n${USE_SERVER}\nexport async function save() {}`,
    expected: [INLINE_CONFIG, SERVER_ACTIONS],
  },
  {
    name: "h: '// eslint-disable-next-line chairside/server-actions' outside src/ switches nothing off",
    file: 'lib/actions.ts',
    code: `// eslint-disable-next-line chairside/server-actions\n${USE_SERVER}\nexport async function save() {}`,
    expected: [INLINE_CONFIG, SERVER_ACTIONS],
  },
  {
    // The comment would silence a real report: with it in force, lint would report nothing.
    name: 'h: a lint comment in a script outside src/ switches nothing off either',
    file: 'scripts/probe.mjs',
    code: '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst unused = 1;',
    expected: [INLINE_CONFIG],
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

describe('script files in src/', () => {
  // tsconfig.json includes .ts, .tsx and .mts files, and the type-aware rules (TYPED_FILES in
  // eslint.config.mjs) see only those: a .js, .jsx, .mjs, .cjs or .cts file in src/ would pass
  // no-floating-promises, only-throw-error and the form rule unchecked (D-074, D-077).
  it('are all TypeScript files the type-aware rules see', () => {
    const unchecked = readdirSync(path.join(ROOT, 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(js|jsx|mjs|cjs|cts)$/.test(entry.name))
      .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)))
      .map((file) => file.split(path.sep).join('/'));
    expect(unchecked).toEqual([]);
  });
});

// (i) Every visible text comes from the message file, and jsx-a11y's recommended rules, in src/app
// and src/ui (E00-T04a, D-053, D-086). A list and rules of their own: many cases above write text in
// JSX, which the text rule reports, and their expectations name only the architecture rules.
const TEXT = 'react/jsx-no-literals';
const UNLABELLED = 'jsx-a11y/label-has-associated-control';
const CLICK_WITHOUT_KEYS = 'jsx-a11y/click-events-have-key-events';
const STATIC_INTERACTION = 'jsx-a11y/no-static-element-interactions';
const AUTOFOCUS = 'jsx-a11y/no-autofocus';
const isTextOrA11yRule = (rule: string) => rule === TEXT || rule.startsWith('jsx-a11y/');
/** A component that returns `jsx`, with a translator as next-intl's t() is. */
const view = (jsx: string) =>
  `declare const t: (key: string) => string; export function View() { return ${jsx}; }`;
const UI_CARD = 'src/ui/card.tsx';

const textCases: Case[] = [
  ...[STAFF_PAGE, UI_CARD].flatMap((file): Case[] => [
    { name: `i: <p>Hello</p> in ${file}`, file, code: view('<p>Hello</p>'), expected: [TEXT] },
    {
      name: `i: <p>{'Hello'}</p> in ${file}`,
      file,
      code: view("<p>{'Hello'}</p>"),
      expected: [TEXT],
    },
    {
      // With its text from t(), the rule takes the {…} for a control it may render: a review check.
      name: `i: a <label> tied to no control in ${file}`,
      file,
      code: view('<label>Email</label>'),
      expected: [UNLABELLED, TEXT],
    },
    {
      name: `i: <div onClick> in ${file}`,
      file,
      code: view('<div onClick={() => undefined} />'),
      expected: [CLICK_WITHOUT_KEYS, STATIC_INTERACTION],
    },
    {
      name: `i: <p>{t('hello')}</p> in ${file} passes`,
      file,
      code: view("<p>{t('hello')}</p>"),
      expected: [],
    },
  ]),
  {
    name: 'i: a template literal written as text',
    file: STAFF_PAGE,
    code: view('<p>{`Hello`}</p>'),
    expected: [TEXT],
  },
  {
    name: 'i: text in a fragment',
    file: UI_CARD,
    code: view('<>Hello</>'),
    expected: [TEXT],
  },
  {
    name: "i: punctuation only, such as the header's ' · ', is text too",
    file: STAFF_PAGE,
    code: view("<p>{t('name')} · {t('role')}</p>"),
    expected: [TEXT],
  },
  {
    name: 'i: a space between two texts passes',
    file: STAFF_PAGE,
    code: view("<p>{t('name')} {t('role')}</p>"),
    expected: [],
  },
  {
    // A review check (CLAUDE.md): the rule reads no prop, so className and the like pass.
    name: 'i: text in aria-label, placeholder, title and alt is not seen by lint',
    file: STAFF_PAGE,
    code: view(
      '<div><input aria-label="Search" placeholder="Name" title="Name" /><img src="/x.png" alt="Logo" /></div>',
    ),
    expected: [],
  },
  {
    name: 'i: a <label> around its input passes',
    file: STAFF_PAGE,
    code: view('<label>{t(\'email\')}<input name="email" /></label>'),
    expected: [],
  },
  {
    name: 'i: a <label htmlFor> and its input pass',
    file: UI_CARD,
    code: view('<><label htmlFor="email">{t(\'email\')}</label><input id="email" /></>'),
    expected: [],
  },
  {
    name: 'i: a <button onClick> passes',
    file: UI_CARD,
    code: view('<button type="button" onClick={() => undefined}>{t(\'go\')}</button>'),
    expected: [],
  },
  {
    name: 'i: autoFocus is reported',
    file: STAFF_PAGE,
    code: view('<input name="q" autoFocus />'),
    expected: [AUTOFOCUS],
  },
  {
    // Its own exception in eslint.config.mjs, block (i), with the reason there.
    name: "i: autoFocus in the login form passes: that file's exception",
    file: 'src/app/(auth)/login/login-form.tsx',
    code: view('<input name="email" autoFocus />'),
    expected: [],
  },
  // The pages and components as they are.
  ...[
    'src/app/layout.tsx',
    'src/app/(auth)/layout.tsx',
    'src/app/(auth)/login/page.tsx',
    'src/app/(auth)/login/login-form.tsx',
    'src/app/(auth)/choose-clinic/page.tsx',
    'src/app/(staff)/layout.tsx',
    'src/app/(staff)/page.tsx',
    'src/app/_lib/logout-button.tsx',
    'src/ui/button.tsx',
    'src/ui/input.tsx',
    'src/ui/label.tsx',
    'src/ui/logo.tsx',
  ].map((file) => ({ name: `i: ${file}, as it is, passes`, ...asItIs(file), expected: [] })),
];

/** Lints snippets with eslint-rules/lint-snippets.mjs, as the beforeAll above does for `cases`. */
async function lintSnippets(list: Case[]): Promise<string[][]> {
  const helper = fileURLToPath(new URL('./lint-snippets.mjs', import.meta.url));
  const run = promisify(execFile)(process.execPath, [helper], { cwd: ROOT });
  run.child.stdin?.end(JSON.stringify(list.map(({ code, file }) => ({ code, file }))));
  return JSON.parse((await run).stdout) as string[][];
}

describe('text and accessibility lint rules', () => {
  let textReported: string[][] = [];

  beforeAll(async () => {
    textReported = await lintSnippets(textCases);
  }, 180_000);

  it.each(textCases.map((c, index) => ({ ...c, index })))('$name', ({ index, expected }) => {
    const messages = textReported[index] ?? [];
    expect(messages.filter((message) => message.startsWith('parse error'))).toEqual([]);
    expect(messages.filter(isTextOrA11yRule)).toEqual(expected);
  });
});
