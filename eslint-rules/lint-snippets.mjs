// Test helper for architecture.test.ts. Lints code snippets with the project's ESLint config in
// a plain Node process: inside Vitest, ESLint's first run takes about a minute instead of a
// second. Reads [{ code, file }] as JSON on stdin; writes, per snippet, the rule ids reported
// (`parse error: …` for a snippet that could not be parsed).
import fs from 'node:fs';
import { ESLint } from 'eslint';
import { TYPED_FILES } from '../eslint.config.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const snippets = JSON.parse(input);

// The type-aware rules need each file in the TypeScript project (tsconfig.json). A snippet at a
// path that does not exist is in no project, so this runner, and only this runner, lets such paths
// use the default project, which has tsconfig.json's options. Glob characters in a path, such as
// the brackets of [id] or the parentheses of (staff), are escaped.
const missing = [...new Set(snippets.map(({ file }) => file))].filter(
  (file) => !fs.existsSync(file),
);
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: {
    files: [TYPED_FILES],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: missing.map((file) => file.replace(/[?*()[\]{}\\]/g, '\\$&')),
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: missing.length,
        },
      },
    },
  },
});

const output = [];
for (const { code, file } of snippets) {
  const [result] = await eslint.lintText(code, { filePath: file });
  // A snippet that cannot be parsed reports no rule at all: name the error, so a test sees it.
  output.push(
    result.messages.map((message) => message.ruleId ?? `parse error: ${message.message}`),
  );
  // A snippet at a file that exists takes that file's place in the TypeScript project. Put the
  // file's own text back, so a later snippet that imports the file sees the real one.
  if (!missing.includes(file)) {
    await eslint.lintText(fs.readFileSync(file, 'utf8'), { filePath: file });
  }
}
process.stdout.write(JSON.stringify(output));
