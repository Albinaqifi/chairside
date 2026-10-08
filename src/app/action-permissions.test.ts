import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import type { ClinicChoice } from '@/modules/auth';

// E01-T02a (E00-T04c critical review, D-093; test-strategy.md, "Permissions"): one table-driven
// test of every action as every member, against the table in scope-v1.md, "Navigation and roles".
//
// It finds every action itself: every file under src/app whose directives hold 'use server' is
// imported, and lint makes each value it exports a wrapper-made action (chairside/server-actions).
// A wrapper called in any other file of src/app, tests and the wrappers' own file aside, fails it:
// that would be an action this test cannot see. Each action needs an entry in ACTIONS below, and
// each entry its action.
//
// Each staff action is called as each member with an input no schema takes. The wrapper checks the
// permission before the input (src/app/_lib/actions.ts), so a member the row refuses gets
// `forbidden` before any transaction, and one it allows gets anything else: invalid_input, or
// internal from a handler that reached the stand-in transaction. Only who is asking (currentStaff,
// requireUser), the transaction and the audit log are stand-ins, as in
// src/app/(staff)/dev/components/actions.test.ts. Every value is synthetic.

const CLINIC = '01970000-0000-7000-8000-0000000000f1';
const NO_SCHEMA_TAKES_THIS = Symbol('no schema takes this');
const FORBIDDEN = { ok: false, error: { code: 'forbidden' } };

const request = vi.hoisted(() => ({
  staff: undefined as Staff | undefined,
  currentStaff: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock('@/app/_lib/auth', () => ({
  currentStaff: request.currentStaff,
  requireUser: request.requireUser,
}));

const db = vi.hoisted(() => ({ opened: 0 }));
vi.mock('@/db/tenant', () => ({
  withTenant: async (_clinicId: string, work: (tx: unknown) => Promise<unknown>) => {
    db.opened += 1;
    const tx = new Proxy(
      {},
      {
        get() {
          throw new Error('the handler used the transaction');
        },
      },
    );
    return work(tx);
  },
}));

vi.mock('@/modules/audit', () => ({ record: vi.fn(() => Promise.resolve('row')) }));

/** The members each action is called as: every role, and what a membership adds to it (D-021). */
const MEMBERS = {
  'an owner': { role: 'owner', extraPermissions: [], providerKind: null },
  'an owner linked to a dentist': { role: 'owner', extraPermissions: [], providerKind: 'dentist' },
  'a dentist': { role: 'dentist', extraPermissions: [], providerKind: 'dentist' },
  'a hygienist': { role: 'hygienist', extraPermissions: [], providerKind: 'hygienist' },
  'the front desk': { role: 'front_desk', extraPermissions: [], providerKind: null },
  'the front desk with import': {
    role: 'front_desk',
    extraPermissions: ['import'],
    providerKind: null,
  },
  'the front desk with export': {
    role: 'front_desk',
    extraPermissions: ['export'],
    providerKind: null,
  },
} satisfies Record<string, Pick<ClinicChoice, 'role' | 'extraPermissions' | 'providerKind'>>;
type Member = keyof typeof MEMBERS;
const EVERY_MEMBER = Object.keys(MEMBERS) as Member[];

/**
 * scope-v1.md, "Navigation and roles": each row of its table, as the members it allows, with the
 * row's cells (Owner | Dentist / hygienist | Front desk) above it. Written from that table, never
 * from PERMISSION_TABLE (src/modules/auth/permissions.ts): this test is what checks the two agree.
 * Its row "Import patients, export data" is two here: "only with the extra permission" is the import
 * permission for an import and the export permission for an export (D-021). The last row is not
 * the table's: an action that belongs to no area of it, which every member of the clinic may use.
 */
const SCOPE_ROWS = {
  // ✔ | ✔ (opens on own column) | ✔
  'Calendar, patients, booking': EVERY_MEMBER,
  // ✔ if linked to a provider | ✔ | ✔
  'Visit wrap-up': EVERY_MEMBER.filter((member) => member !== 'an owner'),
  // ✔ | ✔ | ✔
  'Read aftercare drafts and the library': EVERY_MEMBER,
  // only if also a dentist | dentist ✔ · hygienist ✖ | ✖
  'Approve, edit or discard aftercare; approve library templates (D-051)': [
    'an owner linked to a dentist',
    'a dentist',
  ],
  // ✔ | ✖ | ✖
  'Edit automations and care plans': ['an owner', 'an owner linked to a dentist'],
  // ✔ | ✖ | only with the extra permission
  'Import patients, export data: an import': [
    'an owner',
    'an owner linked to a dentist',
    'the front desk with import',
  ],
  'Import patients, export data: an export': [
    'an owner',
    'an owner linked to a dentist',
    'the front desk with export',
  ],
  // ✔ | ✖ | ✖
  'Staff, settings, audit log, results panel': ['an owner', 'an owner linked to a dentist'],
  // Not a row of the table: every member of the clinic.
  'No area of the table: every member': EVERY_MEMBER,
} satisfies Record<string, Member[]>;
type ScopeRow = keyof typeof SCOPE_ROWS;

/**
 * Every action, by the file that exports it, with the row of SCOPE_ROWS it belongs to, or
 * 'userAction' for one made with userAction: called before a clinic is chosen, it checks the
 * session and the input, and no role. A new action needs its entry here, from scope-v1.md.
 */
const ACTIONS: Record<string, Record<string, ScopeRow | 'userAction'>> = {
  'src/app/(auth)/choose-clinic/actions.ts': { chooseClinic: 'userAction' },
  'src/app/(staff)/dev/components/actions.ts': {
    demoAnswer: 'No area of the table: every member',
    demoOwnerOnly: 'Staff, settings, audit log, results panel',
  },
  'src/app/(staff)/patients/actions.ts': { searchPatients: 'Calendar, patients, booking' },
  'src/app/(staff)/patients/new/actions.ts': {
    createPatient: 'Calendar, patients, booking',
    findLikelyDuplicates: 'Calendar, patients, booking',
  },
  'src/app/_lib/clinic-time-zone.ts': { clinicTimeZone: 'No area of the table: every member' },
};

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WRAPPERS = new Set(['staffAction', 'staffRead', 'userAction']);
const WRAPPERS_FILE = 'src/app/_lib/actions.ts';
const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.[a-z]+$/;

interface AppFile {
  file: string;
  /** Its directives hold 'use server': every value it exports is a server action. */
  serverFile: boolean;
  /** The wrappers it calls, by the name it calls them with. */
  calls: string[];
}

/** Every script file under src/app but tests and the wrappers' own file, as the parser reads it. */
function appFiles(): AppFile[] {
  return readdirSync(path.join(ROOT, 'src/app'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SCRIPT.test(entry.name) && !TEST.test(entry.name))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file !== WRAPPERS_FILE)
    .map((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(path.join(ROOT, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      return { file, serverFile: directives(source).includes('use server'), calls: calls(source) };
    });
}

/** The string-literal statements a file starts with: its directives, as Next.js and lint read them. */
function directives(source: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    found.push(statement.expression.text);
  }
  return found;
}

/** Each call of a wrapper: by its own name, a name it was imported as, or as a namespace's member. */
function calls(source: ts.SourceFile): string[] {
  const names = new Set(WRAPPERS);
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (WRAPPERS.has((element.propertyName ?? element.name).text)) names.add(element.name.text);
    }
  }
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee !== undefined && names.has(callee)) found.push(callee);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function calleeName(expression: ts.Expression): string | undefined {
  let callee = expression;
  while (
    ts.isParenthesizedExpression(callee) ||
    ts.isNonNullExpression(callee) ||
    ts.isAsExpression(callee) ||
    ts.isSatisfiesExpression(callee)
  ) {
    callee = callee.expression;
  }
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return undefined;
}

type AnyAction = (...args: unknown[]) => Promise<unknown>;

/** The actions each 'use server' file exports, by file and name: imported once, before the cases. */
const exported: Record<string, Record<string, AnyAction>> = {};

function actionsOf(file: string): Record<string, AnyAction> {
  const actions = exported[file];
  if (!actions) throw new Error(`${file} is not a 'use server' file`);
  return actions;
}

function staffAs(member: Member): Staff {
  return {
    user: {
      id: '01970000-0000-7000-8000-0000000000f2',
      name: 'Front desk',
      email: 'staff-permissions@example.test',
    },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000f3',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      ...MEMBERS[member],
    },
    clinicCount: 1,
  };
}

const files = appFiles();

// Importing every action file loads the modules, the auth library and the database code behind
// them: on a slow computer, more than a case's 5 seconds.
beforeAll(async () => {
  for (const { file } of files.filter((f) => f.serverFile)) {
    const specifier = path.join(ROOT, file);
    exported[file] = (await import(/* @vite-ignore */ specifier)) as Record<string, AnyAction>;
  }
}, 60_000);

beforeEach(() => {
  request.staff = undefined;
  request.currentStaff.mockReset();
  request.currentStaff.mockImplementation(() => Promise.resolve(request.staff));
  request.requireUser.mockReset();
  request.requireUser.mockResolvedValue(staffAs('the front desk').user);
  db.opened = 0;
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

describe('every action is found', () => {
  it("a wrapper is called in a 'use server' file only", () => {
    expect(files.filter((f) => !f.serverFile && f.calls.length > 0).map((f) => f.file)).toEqual([]);
  });

  it("every action of every 'use server' file has its entry, and every entry its action", () => {
    const found = Object.fromEntries(
      Object.entries(exported).map(([file, actions]) => [file, Object.keys(actions).sort()]),
    );
    const listed = Object.fromEntries(
      Object.entries(ACTIONS).map(([file, actions]) => [file, Object.keys(actions).sort()]),
    );
    expect(found).toEqual(listed);
  });
});

const staffCases = Object.entries(ACTIONS).flatMap(([file, actions]) =>
  Object.entries(actions).flatMap(([action, row]) =>
    row === 'userAction'
      ? []
      : EVERY_MEMBER.map((member) => {
          const allowed = (SCOPE_ROWS[row] as Member[]).includes(member);
          return { file, action, row, member, allowed, answer: allowed ? 'allowed' : 'forbidden' };
        }),
  ),
);

describe("every staff action, as every member, as scope-v1.md's table says", () => {
  it.each(staffCases)(
    '$action ($row), as $member: $answer',
    async ({ file, action, member, allowed }) => {
      request.staff = staffAs(member);
      const result = await actionsOf(file)[action]!(CLINIC, NO_SCHEMA_TAKES_THIS);
      expect(request.currentStaff, 'a staff action asks who is acting').toHaveBeenCalled();
      if (allowed) {
        expect(result).not.toEqual(FORBIDDEN);
      } else {
        expect(result).toEqual(FORBIDDEN);
        expect(db.opened, 'refused before any transaction').toBe(0);
      }
    },
  );
});

const userCases = Object.entries(ACTIONS).flatMap(([file, actions]) =>
  Object.entries(actions)
    .filter(([, row]) => row === 'userAction')
    .map(([action]) => ({ file, action })),
);

describe('every userAction: no clinic and no role, so no row of the table', () => {
  it.each(userCases)(
    '$action asks who is signed in, never for a clinic',
    async ({ file, action }) => {
      const result = await actionsOf(file)[action]!(NO_SCHEMA_TAKES_THIS);
      expect(request.requireUser).toHaveBeenCalled();
      expect(request.currentStaff).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    },
  );
});
