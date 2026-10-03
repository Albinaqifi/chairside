// Test helper for architecture.test.ts. Lints code snippets with the project's ESLint config in
// a plain Node process: inside Vitest, ESLint's first run takes about a minute instead of a
// second. Reads [{ code, file }] as JSON on stdin; writes, per snippet, the rule ids reported.
import { ESLint } from 'eslint';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const eslint = new ESLint({ cwd: process.cwd() });
const output = [];
for (const { code, file } of JSON.parse(input)) {
  const [result] = await eslint.lintText(code, { filePath: file });
  output.push(result.messages.map((message) => message.ruleId));
}
process.stdout.write(JSON.stringify(output));
