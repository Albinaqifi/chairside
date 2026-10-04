// ESLint rule: who may reach the database (D-062, D-071).
//
//   import { getDb } from '@/db/client';                    only in src/db/ and src/modules/auth/
//   import { withTenant } from '@/db/tenant';                only in src/app/_lib/actions.ts (the
//                                                            action wrappers), src/db/ and
//                                                            src/modules/auth/ (the login audit)
//   import type { TenantTransaction } from '@/db/tenant';   everywhere
//
// Every way of naming those files counts: the @/ alias or a relative path, import and export,
// import(), require() and `import x = require()`. Tests are exempt (eslint.config.mjs).
import { importTarget, isInside, repoPath } from './import-paths.mjs';

const CLIENT_FILE = 'src/db/client';
const TENANT_FILE = 'src/db/tenant';
const DATABASE_FOLDERS = ['src/db', 'src/modules/auth'];
const WRAPPERS_FILE = 'src/app/_lib/actions.ts';

/** The name an import or export specifier refers to in the other file. */
const theirName = (node) => node.name ?? node.value;

const databaseAccess = {
  meta: {
    type: 'problem',
    docs: { description: 'Only the files that open transactions may reach the database' },
    schema: [],
    messages: {
      client:
        "Only src/db/ and src/modules/auth/ may import '@/db/client' (D-062). Reach tenant data " +
        'through the `tx` the action wrappers pass to the handler.',
      withTenant:
        'Only the action wrappers (src/app/_lib/actions.ts), src/db/ and src/modules/auth/ may ' +
        'open withTenant (D-071). Take the `tx` the wrapper passes; ' +
        "`import type { TenantTransaction } from '@/db/tenant'` is fine.",
    },
  },
  create(context) {
    const file = context.filename;
    if (DATABASE_FOLDERS.some((folder) => isInside(file, folder))) return {};
    const opensTransactions = repoPath(file) === WRAPPERS_FILE;

    /** Reports an import of the client, and one of withTenant where `reachesWithTenant` says so. */
    function check(node, sourceNode, reachesWithTenant) {
      const target = importTarget(sourceNode, file);
      if (target === CLIENT_FILE) {
        context.report({ node, messageId: 'client' });
      } else if (target === TENANT_FILE && !opensTransactions && reachesWithTenant()) {
        context.report({ node, messageId: 'withTenant' });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source, () => {
          if (node.importKind === 'type') return false;
          return node.specifiers.some(
            (specifier) =>
              specifier.type === 'ImportNamespaceSpecifier' ||
              (specifier.type === 'ImportSpecifier' &&
                specifier.importKind !== 'type' &&
                theirName(specifier.imported) === 'withTenant'),
          );
        });
      },
      ExportNamedDeclaration(node) {
        if (!node.source) return;
        check(node, node.source, () => {
          if (node.exportKind === 'type') return false;
          return node.specifiers.some(
            (specifier) =>
              specifier.exportKind !== 'type' && theirName(specifier.local) === 'withTenant',
          );
        });
      },
      ExportAllDeclaration(node) {
        check(node, node.source, () => node.exportKind !== 'type');
      },
      ImportExpression(node) {
        check(node, node.source, () => true);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node, node.arguments[0], () => true);
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type !== 'TSExternalModuleReference') return;
        check(node, node.moduleReference.expression, () => node.importKind !== 'type');
      },
      // import('@/db/client').Db used as a type still names the client file.
      TSImportType(node) {
        check(node, node.source, () => false);
      },
    };
  },
};

export default databaseAccess;
