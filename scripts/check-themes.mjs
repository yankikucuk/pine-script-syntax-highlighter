// Fails when a scope emitted by the grammar has no rule in a theme.
import { readFileSync } from 'node:fs';

const grammar = JSON.parse(readFileSync('syntaxes/pinescript.tmLanguage.json', 'utf8'));
const scopes = new Set();
JSON.stringify(grammar, (key, value) => {
  if ((key === 'name' || key === 'contentName') && typeof value === 'string')
    value.split(' ').forEach((s) => scopes.add(s));
  return value;
});
scopes.delete('Pine');
scopes.delete('Script');

let failed = false;
for (const file of ['themes/pine-dark-color-theme.json', 'themes/pine-light-color-theme.json']) {
  const theme = JSON.parse(readFileSync(file, 'utf8'));
  const rules = theme.tokenColors.flatMap((r) => (Array.isArray(r.scope) ? r.scope : [r.scope]));
  const covered = (scope) => rules.some((r) => scope === r || scope.startsWith(r + '.'));
  const missing = [...scopes].filter((s) => !covered(s));
  if (missing.length) {
    failed = true;
    console.error(`${file} has no rule for:\n  ${missing.join('\n  ')}`);
  }
}
if (failed) process.exit(1);
console.log('Themes cover every grammar scope.');
