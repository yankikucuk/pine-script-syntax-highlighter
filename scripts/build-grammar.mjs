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

const data = (name) => JSON.parse(readFileSync(join(root, 'src', 'data', `${name}.json`), 'utf8'));

function flatten(groups) {
  const names = new Set();
  for (const [ns, members] of Object.entries(groups)) {
    for (const m of members) names.add(ns ? `${ns}.${m}` : m);
  }
  return names;
}

// The grammar data and the scraped reference must describe the same built-ins.
function checkReferenceConsistency() {
  const reference = data('reference').entries;
  const types = new Set(reference.filter((e) => e.kind === 'type').map((e) => e.name));
  const languageConstants = new Set(['true', 'false', 'na']);
  const byKind = { function: new Set(), variable: new Set(), constant: new Set() };
  for (const e of reference) {
    // Type-cast functions (`int()`, `float()`, ...) are highlighted as types; true/false/na as language constants.
    if (e.kind === 'function' && types.has(e.name)) continue;
    if (e.kind === 'constant' && languageConstants.has(e.name)) continue;
    byKind[e.kind]?.add(e.name);
  }
  const inGrammar = {
    function: flatten(data('functions')),
    variable: flatten(data('variables')),
    constant: flatten(data('constants')),
  };
  const problems = [];
  for (const kind of Object.keys(byKind)) {
    for (const n of inGrammar[kind]) {
      if (kind === 'function' && types.has(n)) continue;
      if (!byKind[kind].has(n)) problems.push(`${kind} "${n}" is in grammar data but not in reference.json`);
    }
    for (const n of byKind[kind])
      if (!inGrammar[kind].has(n)) problems.push(`${kind} "${n}" is in reference.json but not in grammar data`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`${problems.length} reference/grammar mismatches. Update src/data/*.json.`);
    process.exit(1);
  }
}

checkReferenceConsistency();

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
