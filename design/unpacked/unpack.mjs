// Unpacks a bundled design export (.html with gzip+base64 assets) into a readable
// HTML file: markup + the inline logic script, with embedded fonts removed.
// Design tooling only - not part of the application.
// Usage: node design/unpacked/unpack.mjs "<bundled.html>" "<output.html>"
import fs from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Usage: node unpack.mjs "<bundled.html>" "<output.html>"');
  process.exit(1);
}
const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/);
const tagLine = lines.findIndex((l) => l.trim() === '<script type="__bundler/template">');
if (tagLine < 0) throw new Error('No bundled template found in ' + input);
const template = JSON.parse(lines[tagLine + 1]);
const readable = template
  .replace(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}\s*/g, '')
  .replace(/@font-face\s*\{[^}]*\}\s*/g, '');
fs.writeFileSync(output, readable);
console.log(`${output}: ${readable.split('\n').length} lines`);
