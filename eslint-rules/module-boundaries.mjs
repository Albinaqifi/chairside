// ESLint rule: code outside a module may import it only through its index.ts.
//
//   import { x } from '@/modules/patients';            allowed (the module's public API)
//   import { x } from '@/modules/patients/search';     reported (deep import)
//   import { x } from '../patients/search';            reported (deep import, relative)
//
// One exception: a module's schema.ts may import another module's schema.ts, so its tables
// can declare foreign keys (D-058). Nothing else may reach into another module's tables.
import path from 'node:path';

const SRC_DIR = path.resolve(import.meta.dirname, '../src');
const MODULES_DIR = path.join(SRC_DIR, 'modules');
const INDEX_FILE = /^index(\.(ts|tsx|js|mjs))?$/;
const SCHEMA_FILE = /^schema(\.ts)?$/;

/** Splits a path inside src/modules into [module, ...rest], or returns null. */
function modulePath(absolutePath) {
  const relative = path.relative(MODULES_DIR, absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(/[\\/]/);
}

function resolveSource(source, importerFile) {
  if (source.startsWith('@/')) return path.join(SRC_DIR, source.slice(2));
  if (source.startsWith('.')) return path.resolve(path.dirname(importerFile), source);
  return null; // a package
}

const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Import another module only through its index.ts' },
    schema: [],
    messages: {
      deepImport:
        "Import module '{{module}}' only through its index: '@/modules/{{module}}'. " +
        'Its other files are private (CLAUDE.md, module rules).',
    },
  },
  create(context) {
    const importer = modulePath(context.filename);

    function check(sourceNode) {
      if (!sourceNode || typeof sourceNode.value !== 'string') return;
      const target = resolveSource(sourceNode.value, context.filename);
      if (!target) return;
      const [targetModule, ...rest] = modulePath(target) ?? [];
      if (!targetModule) return;
      if (importer && importer[0] === targetModule) return; // inside the same module
      if (rest.length === 0 || (rest.length === 1 && INDEX_FILE.test(rest[0]))) return;
      const importerIsSchema = importer?.length === 2 && importer[1] === 'schema.ts';
      if (importerIsSchema && rest.length === 1 && SCHEMA_FILE.test(rest[0])) return;
      context.report({ node: sourceNode, messageId: 'deepImport', data: { module: targetModule } });
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

export default moduleBoundaries;
