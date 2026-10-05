// ESLint rule: who may reach the database (D-062, D-071, D-077).
//
//   import { getDb } from '@/db/client';                    only in src/db/ and src/modules/auth/
//   import { withTenant } from '@/db/tenant';                only in src/app/_lib/actions.ts (the
//                                                            action wrappers), src/db/ and
//                                                            src/modules/auth/ (the login audit)
//   import type { TenantTransaction } from '@/db/tenant';   everywhere
//   export { withTenant } from '@/db/tenant';               nowhere: the files allowed a handle
//                                                            never pass it on (D-077)
//   import pg from 'pg';                                     only in src/db/ (D-077)
//   export { Pool } from 'pg';                               nowhere: src/db/ never passes a
//                                                            driver on (D-084)
//
// A handle is withTenant, or anything from the client file (getDb, connect, closeDb…). Passing one
// on is a value re-export of it: `export { … } from`, `export *` of the tenant or client file, or
// `export { x }` or `export default x` of an imported handle (D-084). `export const x = withTenant`,
// and a function that wraps it, stay review checks.
//
// The drivers, allowed only in src/db/: pg and every pg-… package, every drizzle-orm/… path except
// drizzle-orm/pg-core, and the scripts that open connections of their own (src/db/reset,
// src/db/migrate). drizzle-orm itself and drizzle-orm/pg-core hold no driver: allowed everywhere.
// Type-only imports of a driver pass. Any file may import any file of src/db/, so src/db/ passes no
// driver on either, in the same ways as a handle (D-084).
//
// Every way of naming those files counts: the @/ alias or a relative path, import and export,
// import(), require() and `import x = require()`. Tests are exempt (eslint.config.mjs).
import { importTarget, importsValue, isInside, repoPath, sourceText } from './import-paths.mjs';

const CLIENT_FILE = 'src/db/client';
const TENANT_FILE = 'src/db/tenant';
const DATABASE_FOLDERS = ['src/db', 'src/modules/auth'];
const WRAPPERS_FILE = 'src/app/_lib/actions.ts';
const DRIVERS_FOLDER = 'src/db';
/** Files that open connections of their own, as importTarget() gives them: no extension. */
const OWN_CONNECTIONS = ['src/db/reset', 'src/db/migrate'];
/** drizzle-orm's entry points that hold no driver: sql, eq and the rest, and pgTable and the rest. */
const DRIZZLE_WITHOUT_DRIVER = ['drizzle-orm', 'drizzle-orm/pg-core'];

/** The name an import or export specifier refers to in the other file. */
const theirName = (node) => node.name ?? node.value;

/** The package an import source names: `pg` for 'pg/lib/client', `@scope/name` for a scoped one. */
function packageName(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** True for a database driver, or a file of ours that opens connections of its own. */
function isDriver(sourceNode, target) {
  if (target !== null) return OWN_CONNECTIONS.includes(target);
  const source = sourceText(sourceNode);
  if (source === null) return false;
  const name = packageName(source);
  if (name === 'pg' || name.startsWith('pg-')) return true;
  return name === 'drizzle-orm' && !DRIZZLE_WITHOUT_DRIVER.includes(source);
}

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
      passedOn:
        'Do not pass withTenant or the database client on: re-exported here, any file could import ' +
        'it from this file without a report (D-077). Export a function that does the work instead.',
      driverPassedOn:
        'Do not pass a database driver on from src/db/: any file may import any file here, so it ' +
        'would reach the driver without a report (D-084). Export a function that does the work.',
      driver:
        "Only src/db/ may import a database driver ('pg', a 'pg-…' package, a 'drizzle-orm/…' path " +
        "other than 'drizzle-orm/pg-core') or src/db/reset and src/db/migrate: they open " +
        'connections with no clinic set (D-077). Use the `tx` the action wrappers pass.',
    },
  },
  create(context) {
    const file = context.filename;
    const inDatabaseFolder = DATABASE_FOLDERS.some((folder) => isInside(file, folder));
    // The files that may hold a handle: they must not pass it on (D-077).
    const holdsHandles = inDatabaseFolder || repoPath(file) === WRAPPERS_FILE;
    const mayUseDrivers = isInside(file, DRIVERS_FOLDER);

    /**
     * Reports at most one problem per import or export statement: a driver outside src/db/; the
     * client, or withTenant where `reachesWithTenant` says so, outside the files allowed them; in
     * those files, a re-export that `passesOn` says hands a handle on, or in src/db/ a driver.
     */
    function check(node, sourceNode, reachesWithTenant, passesOn = () => false) {
      const target = importTarget(sourceNode, file);
      const driver = isDriver(sourceNode, target);
      if (!mayUseDrivers && driver && importsValue(node)) {
        context.report({ node, messageId: 'driver' });
      } else if (target === CLIENT_FILE && !inDatabaseFolder) {
        context.report({ node, messageId: 'client' });
      } else if (target === TENANT_FILE && !holdsHandles && reachesWithTenant()) {
        context.report({ node, messageId: 'withTenant' });
      } else if (holdsHandles && passesOn(target, driver)) {
        context.report({ node, messageId: driver ? 'driverPassedOn' : 'passedOn' });
      }
    }

    /**
     * What exporting an imported name passes on, as the message to report: a handle (withTenant,
     * the tenant file, the client's code), or in src/db/ a driver (D-084). Null for anything else.
     */
    function passedOnBy(definition) {
      if (definition?.type !== 'ImportBinding') return null;
      const { node: binding, parent: declaration } = definition;
      if (declaration.importKind === 'type' || binding.importKind === 'type') return null;
      const isWholeFile = declaration.type === 'TSImportEqualsDeclaration'; // import x = require()
      const sourceNode = isWholeFile ? declaration.moduleReference.expression : declaration.source;
      const target = importTarget(sourceNode, file);
      const isHandle =
        target === CLIENT_FILE ||
        (target === TENANT_FILE &&
          (isWholeFile ||
            binding.type === 'ImportNamespaceSpecifier' ||
            (binding.type === 'ImportSpecifier' && theirName(binding.imported) === 'withTenant')));
      if (isHandle) return 'passedOn';
      return mayUseDrivers && isDriver(sourceNode, target) ? 'driverPassedOn' : null;
    }

    /** `export { x }` and `export { x as y }` without `from`: x is looked up in the file. */
    function checkLocalExports(node) {
      if (node.exportKind === 'type') return;
      const scope = context.sourceCode.getScope(node);
      for (const specifier of node.specifiers) {
        if (specifier.exportKind === 'type') continue;
        const messageId = passedOnBy(scope.set.get(theirName(specifier.local))?.defs[0]);
        if (messageId) context.report({ node: specifier, messageId });
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
        if (!node.source) {
          if (holdsHandles) checkLocalExports(node);
          return;
        }
        const values =
          node.exportKind === 'type' ? [] : node.specifiers.filter((s) => s.exportKind !== 'type');
        const reExportsWithTenant = () =>
          values.some((specifier) => theirName(specifier.local) === 'withTenant');
        check(node, node.source, reExportsWithTenant, (target, driver) =>
          target === CLIENT_FILE || driver
            ? values.length > 0
            : target === TENANT_FILE && reExportsWithTenant(),
        );
      },
      ExportAllDeclaration(node) {
        const reExportsValues = () => node.exportKind !== 'type';
        check(
          node,
          node.source,
          reExportsValues,
          (target, driver) =>
            (target === CLIENT_FILE || target === TENANT_FILE || driver) && reExportsValues(),
        );
      },
      // export default x: an imported name, checked as export { x as default } is (D-084).
      ExportDefaultDeclaration(node) {
        if (!holdsHandles || node.declaration.type !== 'Identifier') return;
        const scope = context.sourceCode.getScope(node);
        const messageId = passedOnBy(scope.set.get(node.declaration.name)?.defs[0]);
        if (messageId) context.report({ node, messageId });
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
