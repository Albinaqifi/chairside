import { execFile } from 'node:child_process';
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

interface Case {
  name: string;
  file: string;
  code: string;
  expected: string[];
}

const IN_MODULE = 'src/modules/scheduling/slots.ts';
const DECLARE = 'declare const DateTime: any; declare const Temporal: any;';

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

  // (c) No Next.js or React inside src/modules.
  ...['next/headers', 'next', 'react', 'react-dom/server', 'server-only'].map((source) => ({
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
    const architectureRules = (reported[index] ?? []).filter((rule) =>
      [CLOCK, FRAMEWORK, BOUNDARY].includes(rule),
    );
    expect(architectureRules).toEqual(expected);
  });
});
