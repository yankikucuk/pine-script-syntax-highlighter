#!/usr/bin/env node
/**
 * Compiles `src/grammar.mjs` into `syntaxes/pinescript.tmLanguage.json`.
 *
 *   node scripts/build-grammar.mjs          # write the grammar
 *   node scripts/build-grammar.mjs --check  # fail if the committed file is stale
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { grammar } from '../src/grammar.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'syntaxes', 'pinescript.tmLanguage.json');
const output = JSON.stringify(grammar, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // missing file is stale by definition
  }
  if (current !== output) {
    console.error('syntaxes/pinescript.tmLanguage.json is out of date. Run `npm run build`.');
    process.exit(1);
  }
  console.log('Grammar is up to date.');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
  const rules = Object.keys(grammar.repository).length;
  console.log(`Wrote ${target} (${rules} repository rules, ${output.length} bytes).`);
}
