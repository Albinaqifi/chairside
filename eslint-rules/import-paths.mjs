// Helpers for the lint rules that look at where a file is and where an import leads, whether the
// import is written with the @/ alias or as a relative path. Paths are compared relative to the
// repository, with forward slashes: path.relative ignores the drive letter's case on Windows.
import path from 'node:path';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(REPO_DIR, 'src');

const SCRIPT_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** A file's path inside the repository, with forward slashes: `src/app/_lib/actions.ts`. */
export function repoPath(absolutePath) {
  return path.relative(REPO_DIR, absolutePath).split(path.sep).join('/');
}

/** True if the file is in `folder` (a repository path such as `src/db`), at any depth. */
export function isInside(absolutePath, folder) {
  const relative = path.relative(path.join(REPO_DIR, folder), absolutePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The text of an import source: a string, or a template literal without `${}` in it. */
function sourceText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

/**
 * The repository path an import source names, without its script extension, or null for a
 * package: `@/db/client`, `../../db/client` and `@/db/client.ts` all give `src/db/client`.
 */
export function importTarget(sourceNode, importerFile) {
  const source = sourceText(sourceNode);
  if (source === null) return null;
  let target;
  if (source.startsWith('@/')) target = path.join(SRC_DIR, source.slice(2));
  else if (source.startsWith('.')) target = path.resolve(path.dirname(importerFile), source);
  else return null;
  return repoPath(target).replace(SCRIPT_EXTENSION, '');
}
