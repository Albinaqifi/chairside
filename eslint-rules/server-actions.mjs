// ESLint rule: every server action is made by one of the action wrappers (D-071, D-073), so its
// checks (session, clinic, permission, input, audit) cannot be forgotten.
//
//   'use server';
//   import { staffAction } from '@/app/_lib/actions';
//   export const renamePatient = staffAction({ … }, async (…) => …);   allowed: the one shape
//   export type RenameInput = { … };                                   allowed: types only
//   export const readPatient = staffRead({ … }, …).forPage;            reported: skips the clinic check
//   export async function renamePatient() { … }                        reported: no wrapper
//
// Reported:
// - in a 'use server' file under src/app, every value export except
//   `export const name = staffAction(…)` (or staffRead, userAction), called directly, the wrapper
//   imported under its own name from src/app/_lib/actions.ts;
// - a 'use server' file anywhere else, in src/ or outside it (a module cannot import Next.js, but
//   the directive is not an import);
// - a 'use server' file that ends in .tsx: lint checks the .catch(…), .then(ok, fail) and
//   .finally(…) statements of the .ts and .mts files only (D-082), so a handler's `tx` there would
//   go without that check (D-084);
// - a 'use server' directive inside a function, anywhere;
// - a route handler (route.ts) in src/app that is not on ROUTE_HANDLERS below;
// - any file in src/pages/: Next.js serves the Pages Router there next to src/app, outside the
//   wrappers and ROUTE_HANDLERS (D-077). A folder named pages inside src/app is an App Router path.
// The rule runs on every script file in the repository (eslint.config.mjs).
import path from 'node:path';
import { importTarget, isInside, repoPath } from './import-paths.mjs';

/**
 * The route handlers in src/app, each with the reason it may be reached without the action
 * wrappers. A route handler takes any request it is sent, so each one checks for itself who may
 * call it. Add a handler here in the task that builds it (E02 patient links, E03 webhooks).
 */
export const ROUTE_HANDLERS = [
  {
    file: 'src/app/api/auth/[...all]/route.ts',
    reason: 'The auth library: sign-in, sign-out, get-session (D-063). No code of ours.',
  },
];

const WRAPPERS = new Set(['staffAction', 'staffRead', 'userAction']);
const WRAPPERS_FILE = 'src/app/_lib/actions'; // as importTarget() gives it: no extension
const ROUTE_FILE = /^route\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The string-literal statements a body starts with: its directives, such as 'use server'. */
function directives(statements) {
  const found = [];
  for (const statement of statements) {
    const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
    if (expression?.type !== 'Literal' || typeof expression.value !== 'string') break;
    found.push(statement);
  }
  return found;
}

const serverDirective = (statements) =>
  directives(statements).find((statement) => statement.expression.value === 'use server');

/** The name an import specifier imports: `a` in `import { a as b }`. */
const importedName = (specifier) => specifier.imported.name ?? specifier.imported.value;

/** The variable an identifier refers to, from the scope it is used in. */
function resolve(scope, identifier) {
  for (let current = scope; current; current = current.upper) {
    const reference = current.references.find((r) => r.identifier === identifier);
    if (reference) return reference.resolved;
  }
  return null;
}

const serverActions = {
  meta: {
    type: 'problem',
    docs: { description: 'Every server action is made by one of the action wrappers' },
    schema: [],
    messages: {
      notWrapped:
        "A 'use server' file exports only `export const name = staffAction(…)`, `staffRead(…)` or " +
        "`userAction(…)`, the wrapper imported from '@/app/_lib/actions' under its own name, and " +
        'types. Anything else would be a server action without the checks (D-071, D-073).',
      forPage:
        '`.forPage` skips the clinic check: a page calls it while it renders, and it is never a ' +
        'server action. Export the read itself, `export const name = staffRead(…)` ' +
        '(D-069, D-072, D-073).',
      fileOutsideApp:
        "No 'use server' file outside src/app: server actions are made by the action wrappers in " +
        'src/app (D-073). A module provides functions for them to call.',
      tsxFile:
        "A 'use server' file ends in .ts, not .tsx: lint checks a `.catch(…)`, `.then(ok, fail)` " +
        "or `.finally(…)` statement in .ts and .mts files only, so a handler's query here could " +
        'run after its transaction has ended unseen (R-32). A server action needs no JSX (D-084).',
      inlineFunction:
        "No 'use server' inside a function: a server action is exported from a 'use server' file " +
        'and made by an action wrapper (D-071, D-073).',
      unlistedRouteHandler:
        'Route handlers are reached without the action wrappers. Add this one to ROUTE_HANDLERS in ' +
        'eslint-rules/server-actions.mjs, with the reason, or use a server action (D-071).',
      pagesRouter:
        'Next.js serves every file in src/pages/ (the Pages Router) outside the action wrappers and ' +
        'ROUTE_HANDLERS. Pages, routes and actions belong in src/app (D-077).',
    },
  },
  create(context) {
    const file = context.filename;
    const inApp = isInside(file, 'src/app');
    const inPages = isInside(file, 'src/pages');

    /** True for the one accepted shape: `name = wrapper(…)`, the wrapper imported as itself. */
    function isWrapperCall(declarator) {
      const call = declarator.init;
      if (declarator.id.type !== 'Identifier' || call?.type !== 'CallExpression') return false;
      if (call.callee.type !== 'Identifier' || !WRAPPERS.has(call.callee.name)) return false;
      const variable = resolve(context.sourceCode.getScope(call), call.callee);
      const definition = variable?.defs.length === 1 ? variable.defs[0] : null;
      return (
        definition?.type === 'ImportBinding' &&
        definition.node.type === 'ImportSpecifier' &&
        definition.parent.importKind !== 'type' &&
        definition.node.importKind !== 'type' &&
        importedName(definition.node) === call.callee.name &&
        importTarget(definition.parent.source, file) === WRAPPERS_FILE
      );
    }

    function reportDeclarator(declarator) {
      const init = declarator.init;
      const forPage =
        init?.type === 'MemberExpression' &&
        (init.property.name === 'forPage' || init.property.value === 'forPage');
      context.report({ node: declarator, messageId: forPage ? 'forPage' : 'notWrapped' });
    }

    /** Every export of a 'use server' file in src/app: only wrapper calls and types pass. */
    function checkExport(statement) {
      switch (statement.type) {
        case 'ExportNamedDeclaration': {
          if (statement.exportKind === 'type') return; // export type { … } (from …)
          const declaration = statement.declaration;
          if (declaration) {
            const isType =
              declaration.type === 'TSTypeAliasDeclaration' ||
              declaration.type === 'TSInterfaceDeclaration' ||
              (declaration.type === 'TSImportEqualsDeclaration' &&
                declaration.importKind === 'type');
            if (isType) return;
            if (
              declaration.type === 'VariableDeclaration' &&
              declaration.kind === 'const' &&
              !declaration.declare
            ) {
              for (const declarator of declaration.declarations) {
                if (!isWrapperCall(declarator)) reportDeclarator(declarator);
              }
              return;
            }
            context.report({ node: statement, messageId: 'notWrapped' });
            return;
          }
          // export { a, b as c } and export { a } from '…': re-exports, also of a wrapper's result.
          for (const specifier of statement.specifiers) {
            if (specifier.exportKind !== 'type') {
              context.report({ node: specifier, messageId: 'notWrapped' });
            }
          }
          return;
        }
        case 'ExportAllDeclaration':
          if (statement.exportKind !== 'type') {
            context.report({ node: statement, messageId: 'notWrapped' });
          }
          return;
        case 'ExportDefaultDeclaration':
        case 'TSExportAssignment': // export = …
          context.report({ node: statement, messageId: 'notWrapped' });
          return;
        default:
      }
    }

    function checkFunction(node) {
      if (node.body?.type !== 'BlockStatement') return;
      const directive = serverDirective(node.body.body);
      if (directive) context.report({ node: directive, messageId: 'inlineFunction' });
    }

    return {
      Program(program) {
        if (inPages) context.report({ node: program, messageId: 'pagesRouter' });
        if (inApp && ROUTE_FILE.test(path.basename(file))) {
          const listed = ROUTE_HANDLERS.some((handler) => handler.file === repoPath(file));
          if (!listed) context.report({ node: program, messageId: 'unlistedRouteHandler' });
        }
        const directive = serverDirective(program.body);
        if (!directive) return;
        if (!inApp) {
          context.report({ node: directive, messageId: 'fileOutsideApp' });
          return;
        }
        if (path.extname(file) === '.tsx') {
          context.report({ node: directive, messageId: 'tsxFile' });
        }
        for (const statement of program.body) checkExport(statement);
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
};

export default serverActions;
