# Language Features (3.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the grammar-only extension into a full Pine Script v6 language extension: completion, hover, signature help, outline, libraries, opt-in compiler diagnostics, docstring and type-annotation commands, templates and two themes, released as 3.0.0.

**Architecture:** One extension using the VS Code API directly. Pure TypeScript logic in `src/extension/core/` (no `vscode` import, tested with vitest), thin providers and commands on top, bundled with esbuild into `dist/extension.cjs`. Documentation comes from a generated `src/data/reference.json` scraped from the v6 reference; the existing grammar pipeline is untouched.

**Tech Stack:** TypeScript 5.9, esbuild 0.28, vitest 5, @types/vscode 1.96, playwright-core (optional, scraper only), existing Prettier + vscode-tmgrammar-test.

**Spec:** `docs/specs/2026-09-07-language-features-design.md`

## Global Constraints

- No AI, assistant, or tool attribution anywhere: not in commits, comments, docs, or metadata. Commit messages are plain imperative sentences with no trailers.
- `engines.vscode` is `^1.96.0`; `engines.node` stays `>=20`. No runtime dependencies (`dependencies` stays absent).
- `src/extension/core/**` never imports `vscode`.
- `syntaxes/pinescript.tmLanguage.json` and `src/data/reference.json` are generated; never hand-edited.
- Every remote call goes through `core/pine-facade.ts`; failures are silent to the user and logged to the "Pine Script" output channel.
- `pinescript.diagnostics.remote` defaults to `false`.
- Prettier formats everything it is not told to ignore: run `npm run format` before every commit.
- Commands are prefixed `pinescript.`; settings are prefixed `pinescript.`; command titles start with `Pine Script: `.
- Language id is `pinescript`, scope name `source.pine`.

---

## File map

| Path | Responsibility |
|------|----------------|
| `tsconfig.json` | strict TS config, `noEmit` |
| `vitest.config.ts` | test discovery for `tests/core` |
| `scripts/build-extension.mjs` | esbuild bundle, `--watch` mode |
| `scripts/scrape-reference.mjs` | headless scrape to `src/data/reference.json` |
| `scripts/lib/extract-reference.js` | browser-side extraction code shared by the scraper |
| `scripts/build-grammar.mjs` | + consistency check against `reference.json` |
| `src/data/reference.json` | generated documentation |
| `src/extension/extension.ts` | `activate`/`deactivate`, registration, settings reload |
| `src/extension/vscode/settings.ts` | typed settings reader |
| `src/extension/vscode/output.ts` | output channel logger |
| `src/extension/vscode/document-cache.ts` | model + tokens cache per document version |
| `src/extension/core/reference.ts` | `ReferenceIndex` |
| `src/extension/core/tokenizer.ts` | `tokenize`, token helpers |
| `src/extension/core/document-model.ts` | `buildModel`, symbols |
| `src/extension/core/call-resolver.ts` | `enclosingCall` |
| `src/extension/core/context.ts` | `completionContext` |
| `src/extension/core/markdown.ts` | documentation strings |
| `src/extension/core/type-inference.ts` | `inferType`, `planTypeAnnotations` |
| `src/extension/core/docstring.ts` | `docstringLines`, `annotationBlockRange` |
| `src/extension/core/templates.ts` | file templates |
| `src/extension/core/pine-facade.ts` | HTTP client with cache and backoff |
| `src/extension/core/diagnostics.ts` | compiler result mapping |
| `src/extension/core/libraries.ts` | `parseLibrary`, library models |
| `src/extension/providers/completion.ts` | CompletionItemProvider |
| `src/extension/providers/hover.ts` | HoverProvider |
| `src/extension/providers/signature-help.ts` | SignatureHelpProvider |
| `src/extension/providers/document-symbol.ts` | DocumentSymbolProvider |
| `src/extension/providers/code-action.ts` | docstring code action |
| `src/extension/providers/diagnostics-controller.ts` | debounced remote diagnostics |
| `src/extension/providers/library-index.ts` | workspace library discovery + remote lookup |
| `src/extension/commands/new-file.ts` | three template commands |
| `src/extension/commands/generate-docstring.ts` | docstring command |
| `src/extension/commands/add-type-annotations.ts` | type annotation command |
| `src/extension/commands/open-reference.ts` | open reference URL |
| `themes/pine-dark-color-theme.json`, `themes/pine-light-color-theme.json` | themes |
| `tests/core/*.test.ts`, `tests/core/fixtures/*.pine` | vitest suites |

---

### Task 1: Toolchain and empty extension

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`, `vitest.config.ts`, `scripts/build-extension.mjs`, `src/extension/extension.ts`, `src/extension/vscode/output.ts`, `tests/core/smoke.test.ts`
- Modify: `.gitignore`, `.vscodeignore`, `.prettierignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run build:extension` → `dist/extension.cjs`; `npm run typecheck`; `npm run test:core`; `log(msg)` from `vscode/output.ts`.

- [ ] **Step 1: Install dev dependencies**

```bash
npm install --save-dev typescript@^5.9.3 esbuild@^0.28.2 vitest@^5.0.0 @types/vscode@^1.96.0 @types/node@^22.0.0
```

- [ ] **Step 2: Update `package.json` metadata and scripts**

Edit these fields (keep everything else):

```json
"description": "Pine Script v6 for Visual Studio Code: highlighting, completion, hover documentation, signature help, snippets, themes and compiler diagnostics.",
"engines": { "vscode": "^1.96.0", "node": ">=20" },
"main": "./dist/extension.cjs",
"activationEvents": [],
"categories": ["Programming Languages", "Snippets", "Themes", "Linters"],
"keywords": ["pine", "pinescript", "pine script", "tradingview", "trading", "indicator", "strategy", "syntax", "highlighting", "completion", "hover", "themes"],
"capabilities": {
  "untrustedWorkspaces": { "supported": true },
  "virtualWorkspaces": { "supported": "limited", "description": "Workspace library discovery needs files on disk." }
},
"scripts": {
  "build": "npm run build:grammar && npm run build:extension",
  "build:grammar": "node scripts/build-grammar.mjs",
  "build:grammar:check": "node scripts/build-grammar.mjs --check",
  "build:extension": "node scripts/build-extension.mjs",
  "watch": "node scripts/build-extension.mjs --watch",
  "scrape:reference": "node scripts/scrape-reference.mjs",
  "typecheck": "tsc --noEmit",
  "test": "npm run build:grammar:check && npm run typecheck && npm run test:core && npm run test:unit && npm run test:snap",
  "test:core": "vitest run",
  "test:unit": "vscode-tmgrammar-test -g syntaxes/pinescript.tmLanguage.json \"tests/unit/**/*.pine\"",
  "test:snap": "vscode-tmgrammar-snap -s source.pine -g syntaxes/pinescript.tmLanguage.json \"tests/snapshots/**/*.pine\"",
  "test:snap:update": "npm run test:snap -- --updateSnapshot",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "package": "vsce package",
  "publish": "vsce publish",
  "vscode:prepublish": "npm test && npm run build:extension"
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vscode"]
  },
  "include": ["src/extension/**/*.ts", "tests/core/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `scripts/build-extension.mjs`**

```js
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
```

- [ ] **Step 6: Create `src/extension/vscode/output.ts`**

```ts
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Pine Script');
  }
  return channel;
}

export function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  output().appendLine(`[${stamp}] ${message}`);
}
```

- [ ] **Step 7: Create `src/extension/extension.ts` (minimal)**

```ts
import * as vscode from 'vscode';
import { log, output } from './vscode/output';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(output());
  log('Pine Script extension activated');
}

export function deactivate(): void {}
```

- [ ] **Step 8: Create `tests/core/smoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Ignore files**

Append to `.gitignore`:

```
dist/
```

Replace `.vscodeignore` with:

```
.vscode/**
.github/**
.gstack/**
node_modules/**
src/**
scripts/**
tests/**
docs/**
.editorconfig
.gitignore
.prettierrc
.prettierignore
tsconfig.json
vitest.config.ts
package-lock.json
*.vsix
```

Append to `.prettierignore`:

```
dist/
src/data/reference.json
```

- [ ] **Step 10: Run the toolchain**

Run: `npm run typecheck && npm run build:extension && npm run test:core`
Expected: no type errors, `dist/extension.cjs` written, 1 test passed.

- [ ] **Step 11: Update CI**

In `.github/workflows/ci.yml`, after the `npm run build:grammar:check` step (rename from `build:check`), add:

```yaml
      - run: npm run typecheck
      - run: npm run test:core
```

and before `npx vsce package` add `- run: npm run build:extension`. After packaging add:

```yaml
      - name: Verify bundle in package
        run: unzip -l *.vsix | grep -q 'extension/dist/extension.cjs'
```

Update `release.yml` the same way (build extension before `vsce package`).

- [ ] **Step 12: Format and commit**

```bash
npm run format
git add -A
git commit -m "Add TypeScript, esbuild and vitest toolchain with an empty extension entry point"
```

---

### Task 2: Reference scraper and consistency check

**Files:**
- Create: `scripts/lib/extract-reference.js`, `scripts/scrape-reference.mjs`, `src/data/reference.json`
- Modify: `scripts/build-grammar.mjs`, `src/data/functions.json`, `src/data/variables.json`, `src/data/constants.json` (reconciliation only)

**Interfaces:**
- Produces: `src/data/reference.json` with the schema in spec §4.2 plus `fields: RefParam[]` on every entry (empty for non-types).

- [ ] **Step 1: Write the browser-side extractor `scripts/lib/extract-reference.js`**

This file is loaded as text and evaluated in the page. It must be self-contained ES2020, no imports.

```js
// Runs inside the reference page. Returns { entries: [...] }.
// Kept in its own file so it can be pasted into a browser console for debugging.
async function extractReference() {
  const KIND = { fun: 'function', var: 'variable', const: 'constant', kw: 'keyword', type: 'type', an: 'annotation', op: 'operator' };
  const BASE = 'https://www.tradingview.com/pine-script-reference/v6/#';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clean(text) {
    return (text || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  // Converts an element's inline HTML to markdown: <code> → backticks, <a> → link, <br> → newline.
  function md(el) {
    if (!el) return '';
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
      else if (node.nodeName === 'CODE') out += '`' + node.textContent + '`';
      else if (node.nodeName === 'A') {
        const href = node.getAttribute('data-href') || (node.getAttribute('href') || '').replace(/^#/, '');
        out += href ? `[${node.textContent}](${BASE}${href})` : node.textContent;
      } else if (node.nodeName === 'BR') out += '\n';
      else out += md(node);
    }
    return clean(out);
  }

  function codeText(pre) {
    if (!pre) return '';
    const code = pre.querySelector('code') || pre;
    let out = '';
    for (const node of code.childNodes) {
      if (node.nodeName === 'BR') out += '\n';
      else out += node.textContent;
    }
    return clean(out).replace(/ /g, ' ');
  }

  // Groups the flat children of an item into sections keyed by sub-header text.
  function sections(content) {
    const result = { intro: [] };
    let current = 'intro';
    for (const child of content.children) {
      if (child.classList.contains('tv-pine-reference-item__header-wrapper')) continue;
      if (child.classList.contains('tv-pine-reference-item__sub-header')) {
        current = clean(child.textContent).replace(/\s+/g, ' ');
        if (!result[current]) result[current] = [];
        continue;
      }
      result[current].push(child);
    }
    return result;
  }

  function parseArgs(nodes) {
    const args = [];
    for (const node of nodes) {
      const typeSpan = node.querySelector('.tv-pine-reference-item__arg-type');
      if (!typeSpan) continue;
      const head = clean(typeSpan.textContent);
      const m = head.match(/^([\w.]+)\s*\(([^)]*)\)/);
      if (!m) continue;
      const clone = node.cloneNode(true);
      clone.querySelector('.tv-pine-reference-item__arg-type').remove();
      const description = md(clone);
      const defMatch = description.match(/[Dd]efault(?: value)? is ([^.\n]+)/) || description.match(/[Dd]efault:\s*([^.\n]+)/);
      args.push({
        name: m[1],
        type: m[2].trim(),
        description,
        optional: /\boptional\b/i.test(description),
        default: defMatch ? defMatch[1].trim() : null,
      });
    }
    return args;
  }

  function readOverloadBlock(content) {
    const s = sections(content);
    const syntaxKey = Object.keys(s).find((k) => k.startsWith('Syntax'));
    const syntax = syntaxKey ? s[syntaxKey].map((n) => codeText(n.matches('pre') ? n : n.querySelector('pre'))).filter(Boolean) : [];
    const returnsNodes = s['Returns'] || [];
    const returns = returnsNodes.length ? returnsNodes.map(md).filter(Boolean).join('\n\n') : '';
    return { s, syntax, params: parseArgs(s['Arguments'] || []), returns };
  }

  function returnType(syntax) {
    const m = syntax.match(/→\s*(.+)$/);
    return m ? m[1].trim() : '';
  }

  const items = [...document.querySelectorAll('.tv-pine-reference-item[id]')];
  const entries = [];
  for (const item of items) {
    const id = item.id;
    const prefix = id.split('_')[0];
    const kind = KIND[prefix];
    if (!kind) continue;
    const content = item.querySelector('.tv-pine-reference-item__content');
    const header = clean(item.querySelector('.tv-pine-reference-item__header')?.textContent).replace(/\(\)$/, '');
    const name = header;
    const namespace = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '';

    const first = readOverloadBlock(content);
    const s = first.s;
    const description = (s.intro || []).map(md).filter(Boolean).join('\n\n');
    const remarks = (s['Remarks'] || []).map(md).filter(Boolean).join('\n\n');
    const example = (s['Example'] || []).map((n) => codeText(n.matches('pre') ? n : n.querySelector('pre'))).filter(Boolean).join('\n\n');
    const seeAlso = [...(s['See also'] || []).flatMap((n) => [...n.querySelectorAll('a[data-href]')])].map((a) => a.getAttribute('data-href'));
    const fields = parseArgs(s['Fields'] || []);
    const typeNodes = s['Type'] || [];
    const type = typeNodes.length ? clean(typeNodes[0].textContent) : null;

    const overloads = [];
    if (kind === 'function') {
      const anchors = [...content.querySelectorAll('a[data-href^="' + id + '-"]')];
      if (anchors.length <= 1) {
        for (const syntax of first.syntax) {
          overloads.push({ syntax, params: first.params, returns: { type: returnType(syntax), description: first.returns } });
        }
      } else {
        for (const anchor of anchors) {
          anchor.click();
          const wanted = codeText(anchor.querySelector('pre'));
          for (let tries = 0; tries < 20; tries++) {
            const selected = content.querySelector('pre.tv-pine-reference-item__syntax.selected');
            if (selected && codeText(selected) === wanted) break;
            await sleep(25);
          }
          const block = readOverloadBlock(item.querySelector('.tv-pine-reference-item__content'));
          overloads.push({ syntax: wanted, params: block.params, returns: { type: returnType(wanted), description: block.returns } });
        }
      }
    }

    entries.push({ id, kind, name, namespace, description, overloads, fields, type, remarks, example, seeAlso });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries };
}
```

- [ ] **Step 2: Write `scripts/scrape-reference.mjs`**

```js
// Produces src/data/reference.json from the Pine Script v6 reference.
// Needs playwright-core and a Chromium: `npx playwright-core install chromium` once.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const URL = 'https://www.tradingview.com/pine-script-reference/v6/';
const OUT = path.join(root, 'src/data/reference.json');

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run: npm install --no-save playwright-core && npx playwright-core install chromium');
  process.exit(1);
}

const extractor = await readFile(path.join(here, 'lib/extract-reference.js'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tv-pine-reference-item[id]');
  const { entries } = await page.evaluate(`${extractor}; extractReference();`);
  if (entries.length < 900) {
    throw new Error(`Only ${entries.length} entries extracted; the page structure may have changed.`);
  }
  const data = { version: '6', generatedAt: new Date().toISOString().slice(0, 10), entries };
  await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`Wrote ${entries.length} entries to ${path.relative(root, OUT)}`);
} finally {
  await browser.close();
}
```

- [ ] **Step 3: Run the scraper**

```bash
npm install --no-save playwright-core@^1.63.0
npx playwright-core install chromium
npm run scrape:reference
```

Expected: `Wrote 94x entries to src/data/reference.json`. Spot check:

```bash
node -e 'const d=require("./src/data/reference.json"); const f=d.entries.find(e=>e.id==="fun_str.tostring"); console.log(f.overloads.length, f.overloads[1].params.map(p=>p.name+":"+p.type)); const c=d.entries.find(e=>e.id==="var_close"); console.log(c.type); const t=d.entries.find(e=>e.id==="type_chart.point"); console.log(t.fields.map(f=>f.name));'
```

Expected: `5 [ 'value:simple int/float', 'format:simple string' ]`, `series float`, `[ 'index', 'time', 'price' ]`.

If the scrape leaves `playwright-core` in `package-lock.json`, run `npm install` again to drop it (it was installed with `--no-save`).

- [ ] **Step 4: Add the consistency check to `scripts/build-grammar.mjs`**

Add a function and call it in both normal and `--check` mode, before writing:

```js
import reference from '../src/data/reference.json' with { type: 'json' };
import functions from '../src/data/functions.json' with { type: 'json' };
import variables from '../src/data/variables.json' with { type: 'json' };
import constants from '../src/data/constants.json' with { type: 'json' };

function flatten(groups) {
  const names = new Set();
  for (const [ns, members] of Object.entries(groups)) {
    for (const m of members) names.add(ns ? `${ns}.${m}` : m);
  }
  return names;
}

function checkReferenceConsistency() {
  const byKind = { function: new Set(), variable: new Set(), constant: new Set() };
  for (const e of reference.entries) byKind[e.kind]?.add(e.name);
  const grammar = { function: flatten(functions), variable: flatten(variables), constant: flatten(constants) };
  const problems = [];
  for (const kind of Object.keys(byKind)) {
    for (const n of grammar[kind]) if (!byKind[kind].has(n)) problems.push(`${kind} "${n}" is in grammar data but not in reference.json`);
    for (const n of byKind[kind]) if (!grammar[kind].has(n)) problems.push(`${kind} "${n}" is in reference.json but not in grammar data`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    throw new Error(`${problems.length} reference/grammar mismatches`);
  }
}
```

(If the existing file already imports JSON differently, follow its style.)

- [ ] **Step 5: Reconcile grammar data**

Run: `npm run build:grammar:check`
Expected: a list of mismatches (the reference has 475 functions and 239 constants against 471 and 237 in grammar data). For each name reported as missing from grammar data, add it to the matching namespace array in `src/data/functions.json` / `variables.json` / `constants.json`. For each name reported as missing from the reference, remove it from grammar data. Then:

```bash
npm run build:grammar && npm run build:grammar:check && npm run test:unit && npm run test:snap
```

Expected: build passes, all grammar tests pass (update snapshots with `npm run test:snap:update` only if a snapshot file uses a renamed built-in; inspect the diff first).

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "Scrape the v6 reference into reference.json and keep grammar data consistent with it"
```

---

### Task 3: Reference index

**Files:**
- Create: `src/extension/core/reference.ts`, `tests/core/reference.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EntryKind = 'function' | 'variable' | 'constant' | 'keyword' | 'type' | 'annotation' | 'operator';
  interface RefParam { name: string; type: string; description: string; optional: boolean; default: string | null }
  interface RefOverload { syntax: string; params: RefParam[]; returns: { type: string; description: string } | null }
  interface RefEntry { id: string; kind: EntryKind; name: string; namespace: string; description: string; overloads: RefOverload[]; fields: RefParam[]; type: string | null; remarks: string; example: string; seeAlso: string[] }
  class ReferenceIndex {
    constructor(data: ReferenceData);
    get(name: string, kind?: EntryKind): RefEntry | undefined;   // kind priority: function, variable, constant, type, keyword, annotation, operator
    getAll(name: string): RefEntry[];
    members(namespace: string): RefEntry[];                      // direct members, sorted by name
    childNamespaces(namespace: string): string[];                // e.g. 'chart' -> ['point']; '' -> top-level namespaces
    bare(): RefEntry[];                                          // namespace === '' and kind in function|variable|constant
    byKind(kind: EntryKind): RefEntry[];
    url(entry: RefEntry): string;
    static baseType(qualified: string): string;                  // 'series float' -> 'float', 'series int/float' -> 'float'
  }
  function loadReference(): ReferenceIndex;                      // lazy singleton over the bundled JSON
  ```

- [ ] **Step 1: Write the failing test `tests/core/reference.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ReferenceIndex, loadReference } from '../../src/extension/core/reference';

describe('ReferenceIndex', () => {
  const ref = loadReference();

  it('finds a function with its overloads', () => {
    const e = ref.get('ta.sma');
    expect(e?.kind).toBe('function');
    expect(e?.overloads[0]?.params.map((p) => p.name)).toEqual(['source', 'length']);
    expect(e?.overloads[0]?.returns?.type).toBe('series float');
  });

  it('prefers the function when a name is both function and variable', () => {
    expect(ref.get('time')?.kind).toBe('function');
    expect(ref.get('time', 'variable')?.kind).toBe('variable');
    expect(ref.getAll('time').map((e) => e.kind).sort()).toEqual(['function', 'variable']);
  });

  it('lists namespace members and child namespaces', () => {
    expect(ref.members('ta').some((e) => e.name === 'ta.ema')).toBe(true);
    expect(ref.members('ta').every((e) => e.namespace === 'ta')).toBe(true);
    expect(ref.childNamespaces('chart')).toContain('point');
    expect(ref.childNamespaces('')).toContain('ta');
    expect(ref.childNamespaces('')).not.toContain('');
  });

  it('exposes bare built-ins and urls', () => {
    expect(ref.bare().some((e) => e.name === 'close')).toBe(true);
    expect(ref.url(ref.get('close')!)).toBe('https://www.tradingview.com/pine-script-reference/v6/#var_close');
  });

  it('strips qualifiers from types', () => {
    expect(ReferenceIndex.baseType('series float')).toBe('float');
    expect(ReferenceIndex.baseType('series int/float')).toBe('float');
    expect(ReferenceIndex.baseType('const string')).toBe('string');
    expect(ReferenceIndex.baseType('array<float>')).toBe('array<float>');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/reference.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/reference.ts`**

```ts
import data from '../../data/reference.json';

export type EntryKind = 'function' | 'variable' | 'constant' | 'keyword' | 'type' | 'annotation' | 'operator';

export interface RefParam {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  default: string | null;
}

export interface RefOverload {
  syntax: string;
  params: RefParam[];
  returns: { type: string; description: string } | null;
}

export interface RefEntry {
  id: string;
  kind: EntryKind;
  name: string;
  namespace: string;
  description: string;
  overloads: RefOverload[];
  fields: RefParam[];
  type: string | null;
  remarks: string;
  example: string;
  seeAlso: string[];
}

export interface ReferenceData {
  version: string;
  generatedAt: string;
  entries: RefEntry[];
}

export const REFERENCE_URL = 'https://www.tradingview.com/pine-script-reference/v6/';

const KIND_PRIORITY: EntryKind[] = ['function', 'variable', 'constant', 'type', 'keyword', 'annotation', 'operator'];
const QUALIFIERS = /^(?:series|simple|const|input|literal)\s+/;

export class ReferenceIndex {
  private readonly byName = new Map<string, RefEntry[]>();
  private readonly byNamespace = new Map<string, RefEntry[]>();
  private readonly children = new Map<string, Set<string>>();
  private readonly kinds = new Map<EntryKind, RefEntry[]>();

  constructor(public readonly data: ReferenceData) {
    for (const entry of data.entries) {
      push(this.byName, entry.name, entry);
      push(this.byNamespace, entry.namespace, entry);
      push(this.kinds, entry.kind, entry);
      // Register every namespace segment as a child of its parent: 'a.b.c' -> ''->a, a->b, a.b->c
      const parts = entry.name.split('.');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i - 1).join('.');
        const child = parts[i - 1]!;
        if (!this.children.has(parent)) this.children.set(parent, new Set());
        this.children.get(parent)!.add(child);
      }
    }
    for (const list of this.byNamespace.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string, kind?: EntryKind): RefEntry | undefined {
    const all = this.byName.get(name);
    if (!all) return undefined;
    if (kind) return all.find((e) => e.kind === kind);
    for (const k of KIND_PRIORITY) {
      const hit = all.find((e) => e.kind === k);
      if (hit) return hit;
    }
    return all[0];
  }

  getAll(name: string): RefEntry[] {
    return this.byName.get(name) ?? [];
  }

  members(namespace: string): RefEntry[] {
    return this.byNamespace.get(namespace) ?? [];
  }

  childNamespaces(namespace: string): string[] {
    return [...(this.children.get(namespace) ?? [])].sort();
  }

  bare(): RefEntry[] {
    return this.members('').filter((e) => e.kind === 'function' || e.kind === 'variable' || e.kind === 'constant');
  }

  byKind(kind: EntryKind): RefEntry[] {
    return this.kinds.get(kind) ?? [];
  }

  url(entry: RefEntry): string {
    return `${REFERENCE_URL}#${entry.id}`;
  }

  static baseType(qualified: string): string {
    const stripped = qualified.trim().replace(QUALIFIERS, '');
    // 'int/float' means either; the wider type is float.
    if (stripped === 'int/float') return 'float';
    return stripped;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

let singleton: ReferenceIndex | undefined;

export function loadReference(): ReferenceIndex {
  if (!singleton) singleton = new ReferenceIndex(data as ReferenceData);
  return singleton;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/reference.test.ts`
Expected: PASS (5 tests). If `time` is not both a function and a variable in the scraped data, pick another dual name from `reference.json` (`node -e` over `entries` grouped by name) and adjust the test.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/extension/core/reference.ts tests/core/reference.test.ts
git commit -m "Add reference index over the scraped v6 documentation"
```

---

### Task 4: Tokenizer

**Files:**
- Create: `src/extension/core/tokenizer.ts`, `tests/core/tokenizer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TokenKind = 'comment' | 'string' | 'number' | 'ident' | 'op' | 'open' | 'close' | 'comma' | 'ws';
  interface Token { kind: TokenKind; start: number; end: number; text: string; line: number }
  interface TokenizedLine { tokens: Token[]; depthAtStart: number; continuesString: boolean }
  function tokenize(text: string): TokenizedLine[];
  function tokenAt(tokens: Token[], col: number): Token | undefined;   // token with start <= col < end, else the token ending exactly at col
  function isInStringOrComment(line: TokenizedLine, col: number): boolean;
  function wordAt(lineText: string, col: number): { text: string; start: number; end: number } | null; // dotted identifier around col
  ```

- [ ] **Step 1: Write the failing test `tests/core/tokenizer.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isInStringOrComment, tokenAt, tokenize, wordAt } from '../../src/extension/core/tokenizer';

const kinds = (line: string) => tokenize(line)[0]!.tokens.filter((t) => t.kind !== 'ws').map((t) => `${t.kind}:${t.text}`);

describe('tokenize', () => {
  it('splits a plot call', () => {
    expect(kinds('plot(ta.sma(close, 14), color = #ff0000aa)')).toEqual([
      'ident:plot', 'open:(', 'ident:ta.sma', 'open:(', 'ident:close', 'comma:,', 'number:14', 'close:)',
      'comma:,', 'ident:color', 'op:=', 'number:#ff0000aa', 'close:)',
    ]);
  });

  it('keeps strings and comments whole', () => {
    expect(kinds('x = "a // not comment" // real')).toEqual(['ident:x', 'op:=', 'string:"a // not comment"', 'comment:// real']);
    expect(kinds("s = 'it\\'s'")).toEqual(['ident:s', 'op:=', "string:'it\\'s'"]);
  });

  it('carries triple-quoted strings across lines', () => {
    const lines = tokenize('t = """first\nsecond""" + x');
    expect(lines[0]!.tokens.at(-1)?.kind).toBe('string');
    expect(lines[0]!.continuesString).toBe(true);
    expect(lines[1]!.tokens.map((t) => t.kind)).toEqual(['string', 'ws', 'op', 'ws', 'ident']);
  });

  it('tracks bracket depth across lines', () => {
    const lines = tokenize('f(a,\n  b)\nc = 1');
    expect(lines.map((l) => l.depthAtStart)).toEqual([0, 1, 0]);
  });

  it('recognizes multi-character operators', () => {
    expect(kinds('a := b == c ? d => e')).toEqual(['ident:a', 'op::=', 'ident:b', 'op:==', 'ident:c', 'op:?', 'ident:d', 'op:=>', 'ident:e']);
  });

  it('tells strings and comments apart from code', () => {
    const line = tokenize('x = "abc" // c')[0]!;
    expect(isInStringOrComment(line, 0)).toBe(false);
    expect(isInStringOrComment(line, 6)).toBe(true);
    expect(isInStringOrComment(line, 12)).toBe(true);
  });

  it('finds tokens and words at a column', () => {
    const line = tokenize('ta.sma(close)')[0]!;
    expect(tokenAt(line.tokens, 3)?.text).toBe('ta.sma');
    expect(tokenAt(line.tokens, 6)?.text).toBe('ta.sma');
    expect(wordAt('ta.sma(close)', 4)).toEqual({ text: 'ta.sma', start: 0, end: 6 });
    expect(wordAt('ta.sma(close)', 9)).toEqual({ text: 'close', start: 7, end: 12 });
    expect(wordAt('ta.sma(close)', 6)).toEqual({ text: 'ta.sma', start: 0, end: 6 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/tokenizer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/tokenizer.ts`**

```ts
export type TokenKind = 'comment' | 'string' | 'number' | 'ident' | 'op' | 'open' | 'close' | 'comma' | 'ws';

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  line: number;
}

export interface TokenizedLine {
  tokens: Token[];
  depthAtStart: number;
  continuesString: boolean;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;
const NUMBER = /#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const OPS = ['=>', ':=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '?', ':', '+', '-', '*', '/', '%', '=', '<', '>', '!'];

export function tokenize(text: string): TokenizedLine[] {
  const lines = text.split(/\r?\n/);
  const result: TokenizedLine[] = [];
  let depth = 0;
  let openString: string | null = null; // '"""' or "'''" while inside a triple-quoted string

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!;
    const tokens: Token[] = [];
    const depthAtStart = depth;
    let i = 0;

    const push = (kind: TokenKind, start: number, end: number) => {
      tokens.push({ kind, start, end, text: line.slice(start, end), line: lineNo });
    };

    if (openString) {
      const close = line.indexOf(openString);
      if (close === -1) {
        push('string', 0, line.length);
        result.push({ tokens, depthAtStart, continuesString: true });
        continue;
      }
      push('string', 0, close + 3);
      i = close + 3;
      openString = null;
    }

    while (i < line.length) {
      const ch = line[i]!;
      if (ch === ' ' || ch === '\t') {
        let j = i + 1;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
        push('ws', i, j);
        i = j;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') {
        push('comment', i, line.length);
        i = line.length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const triple = line.startsWith(ch.repeat(3), i);
        if (triple) {
          const close = line.indexOf(ch.repeat(3), i + 3);
          if (close === -1) {
            push('string', i, line.length);
            openString = ch.repeat(3);
            i = line.length;
            continue;
          }
          push('string', i, close + 3);
          i = close + 3;
          continue;
        }
        let j = i + 1;
        while (j < line.length && line[j] !== ch) {
          if (line[j] === '\\') j++;
          j++;
        }
        push('string', i, Math.min(j + 1, line.length));
        i = Math.min(j + 1, line.length);
        continue;
      }
      IDENT.lastIndex = i;
      const id = IDENT.exec(line);
      if (id) {
        push('ident', i, i + id[0].length);
        i += id[0].length;
        continue;
      }
      NUMBER.lastIndex = i;
      const num = NUMBER.exec(line);
      if (num && (ch === '#' || /\d/.test(ch) || (ch === '.' && /\d/.test(line[i + 1] ?? '')))) {
        push('number', i, i + num[0].length);
        i += num[0].length;
        continue;
      }
      if (ch === '(' || ch === '[') {
        depth++;
        push('open', i, i + 1);
        i++;
        continue;
      }
      if (ch === ')' || ch === ']') {
        depth = Math.max(0, depth - 1);
        push('close', i, i + 1);
        i++;
        continue;
      }
      if (ch === ',') {
        push('comma', i, i + 1);
        i++;
        continue;
      }
      const op = OPS.find((o) => line.startsWith(o, i));
      if (op) {
        push('op', i, i + op.length);
        i += op.length;
        continue;
      }
      push('op', i, i + 1);
      i++;
    }
    result.push({ tokens, depthAtStart, continuesString: openString !== null });
  }
  return result;
}

export function tokenAt(tokens: Token[], col: number): Token | undefined {
  return tokens.find((t) => t.start <= col && col < t.end) ?? tokens.find((t) => t.end === col && t.kind === 'ident');
}

export function isInStringOrComment(line: TokenizedLine, col: number): boolean {
  const t = line.tokens.find((t) => t.start <= col && col < t.end) ?? line.tokens.find((t) => t.start < col && col <= t.end);
  if (!t) return line.continuesString && line.tokens.length === 0;
  return t.kind === 'string' || t.kind === 'comment';
}

export function wordAt(lineText: string, col: number): { text: string; start: number; end: number } | null {
  const isWord = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = col;
  let end = col;
  while (start > 0 && isWord(lineText[start - 1]!)) start--;
  while (end < lineText.length && isWord(lineText[end]!)) end++;
  if (start === end) return null;
  const text = lineText.slice(start, end).replace(/^\.+|\.+$/g, '');
  if (!text) return null;
  const s = lineText.indexOf(text, start);
  return { text, start: s, end: s + text.length };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/tokenizer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/extension/core/tokenizer.ts tests/core/tokenizer.test.ts
git commit -m "Add line tokenizer for Pine Script"
```

---

### Task 5: Document model

**Files:**
- Create: `src/extension/core/document-model.ts`, `tests/core/document-model.test.ts`, `tests/core/fixtures/library.pine`, `tests/core/fixtures/consumer.pine`

**Interfaces:**
- Consumes: `tokenize` from Task 4.
- Produces:
  ```ts
  interface LineRange { start: number; end: number }             // inclusive line numbers
  interface Annotations { function: string | null; description: string | null; params: Record<string, string>; returns: string | null; type: string | null; fields: Record<string, string>; enum: string | null; raw: string[] }
  interface ParamDecl { name: string; type: string | null; default: string | null }
  interface FunctionSymbol { kind: 'function'; name: string; isMethod: boolean; isExport: boolean; params: ParamDecl[]; docs: Annotations; line: number; range: LineRange }
  interface FieldDecl { name: string; type: string; default: string | null }
  interface TypeSymbol { kind: 'type'; name: string; isExport: boolean; fields: FieldDecl[]; docs: Annotations; line: number; range: LineRange }
  interface EnumMember { name: string; title: string | null }
  interface EnumSymbol { kind: 'enum'; name: string; isExport: boolean; members: EnumMember[]; docs: Annotations; line: number; range: LineRange }
  interface VariableSymbol { kind: 'variable'; name: string; declaredType: string | null; qualifier: 'var' | 'varip' | null; initializer: string | null; line: number; column: number; scope: LineRange }
  interface ImportDecl { owner: string; name: string; version: string; alias: string | null; line: number }
  interface DocumentModel { version: number | null; scriptKind: 'indicator' | 'strategy' | 'library' | null; libraryTitle: string | null; imports: ImportDecl[]; functions: FunctionSymbol[]; types: TypeSymbol[]; enums: EnumSymbol[]; variables: VariableSymbol[]; lineCount: number }
  type DeclSymbol = FunctionSymbol | TypeSymbol | EnumSymbol;
  function buildModel(text: string): DocumentModel;
  function declarationAt(model: DocumentModel, line: number): DeclSymbol | null;   // header line only
  function visibleVariables(model: DocumentModel, line: number): VariableSymbol[];
  function emptyAnnotations(): Annotations;
  ```

- [ ] **Step 1: Write fixtures**

`tests/core/fixtures/library.pine`:

```pine
//@version=6
//@description Helpers for moving averages.
library("MaHelpers", overlay = true)

//@function Weighted average of two series.
//@param a First series.
//@param b Second series.
//@param w Weight of `a`, between 0 and 1.
//@returns The weighted average.
export weighted(float a, float b,
     float w = 0.5) =>
    a * w + b * (1 - w)

//@type A price level with a label.
//@field price The level.
//@field name Display name.
export type Level
    float price
    string name = "level"

//@enum Trade direction.
export enum Side
    long = "Long"
    short

method describe(Level this) =>
    str.format("{0}: {1}", this.name, this.price)

internal(x) =>
    y = x * 2
    y
```

`tests/core/fixtures/consumer.pine`:

```pine
//@version=6
indicator("Consumer", shorttitle = "C", overlay = false)
import yankikucuk/MaHelpers/2 as ma
import TradingView/ta/14

length = input.int(14, "Length")
var float acc = na
src = close
[dc, up] = ta.dmi(14, 14)
fast = ta.ema(src, length)
plot(fast, title = "Fast",
     color = color.new(color.blue, 0))
if fast > src
    label.new(bar_index, high, "up")
```

- [ ] **Step 2: Write the failing test `tests/core/document-model.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, declarationAt, visibleVariables } from '../../src/extension/core/document-model';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('buildModel on a library', () => {
  const m = buildModel(fixture('library.pine'));

  it('reads the header', () => {
    expect(m.version).toBe(6);
    expect(m.scriptKind).toBe('library');
    expect(m.libraryTitle).toBe('MaHelpers');
  });

  it('parses exported functions with multi-line params and docs', () => {
    const f = m.functions.find((f) => f.name === 'weighted')!;
    expect(f.isExport).toBe(true);
    expect(f.isMethod).toBe(false);
    expect(f.params).toEqual([
      { name: 'a', type: 'float', default: null },
      { name: 'b', type: 'float', default: null },
      { name: 'w', type: 'float', default: '0.5' },
    ]);
    expect(f.docs.function).toBe('Weighted average of two series.');
    expect(f.docs.params.w).toBe('Weight of `a`, between 0 and 1.');
    expect(f.docs.returns).toBe('The weighted average.');
    expect(f.range).toEqual({ start: 9, end: 11 });
  });

  it('parses types and enums', () => {
    const t = m.types.find((t) => t.name === 'Level')!;
    expect(t.fields).toEqual([
      { name: 'price', type: 'float', default: null },
      { name: 'name', type: 'string', default: '"level"' },
    ]);
    expect(t.docs.fields.price).toBe('The level.');
    const e = m.enums.find((e) => e.name === 'Side')!;
    expect(e.members).toEqual([
      { name: 'long', title: '"Long"' },
      { name: 'short', title: null },
    ]);
    expect(e.docs.enum).toBe('Trade direction.');
  });

  it('parses methods and private functions', () => {
    const d = m.functions.find((f) => f.name === 'describe')!;
    expect(d.isMethod).toBe(true);
    expect(d.params[0]).toEqual({ name: 'this', type: 'Level', default: null });
    const i = m.functions.find((f) => f.name === 'internal')!;
    expect(i.isExport).toBe(false);
    expect(i.params).toEqual([{ name: 'x', type: null, default: null }]);
  });

  it('scopes local variables to their function', () => {
    const y = m.variables.find((v) => v.name === 'y')!;
    expect(y.scope).toEqual({ start: 28, end: 29 });
    expect(visibleVariables(m, 29).map((v) => v.name)).toContain('y');
    expect(visibleVariables(m, 3).map((v) => v.name)).not.toContain('y');
  });

  it('finds declarations by header line', () => {
    expect(declarationAt(m, 9)?.name).toBe('weighted');
    expect(declarationAt(m, 10)).toBeNull();
    expect(declarationAt(m, 17)?.kind).toBe('type');
  });
});

describe('buildModel on a consumer script', () => {
  const m = buildModel(fixture('consumer.pine'));

  it('reads imports', () => {
    expect(m.scriptKind).toBe('indicator');
    expect(m.imports).toEqual([
      { owner: 'yankikucuk', name: 'MaHelpers', version: '2', alias: 'ma', line: 2 },
      { owner: 'TradingView', name: 'ta', version: '14', alias: null, line: 3 },
    ]);
  });

  it('reads variable declarations with types, qualifiers and tuples', () => {
    const byName = Object.fromEntries(m.variables.map((v) => [v.name, v]));
    expect(byName.length).toMatchObject({ declaredType: null, qualifier: null, initializer: 'input.int(14, "Length")' });
    expect(byName.acc).toMatchObject({ declaredType: 'float', qualifier: 'var', initializer: 'na' });
    expect(byName.dc).toMatchObject({ initializer: null });
    expect(byName.up).toMatchObject({ initializer: null });
    expect(byName.fast?.initializer).toBe('ta.ema(src, length)');
  });

  it('does not treat named arguments on continuation lines as variables', () => {
    expect(m.variables.some((v) => v.name === 'color')).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/core/document-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/extension/core/document-model.ts`**

```ts
import { tokenize, type TokenizedLine } from './tokenizer';

export interface LineRange {
  start: number;
  end: number;
}

export interface Annotations {
  function: string | null;
  description: string | null;
  params: Record<string, string>;
  returns: string | null;
  type: string | null;
  fields: Record<string, string>;
  enum: string | null;
  raw: string[];
}

export interface ParamDecl {
  name: string;
  type: string | null;
  default: string | null;
}

export interface FunctionSymbol {
  kind: 'function';
  name: string;
  isMethod: boolean;
  isExport: boolean;
  params: ParamDecl[];
  docs: Annotations;
  line: number;
  range: LineRange;
}

export interface FieldDecl {
  name: string;
  type: string;
  default: string | null;
}

export interface TypeSymbol {
  kind: 'type';
  name: string;
  isExport: boolean;
  fields: FieldDecl[];
  docs: Annotations;
  line: number;
  range: LineRange;
}

export interface EnumMember {
  name: string;
  title: string | null;
}

export interface EnumSymbol {
  kind: 'enum';
  name: string;
  isExport: boolean;
  members: EnumMember[];
  docs: Annotations;
  line: number;
  range: LineRange;
}

export interface VariableSymbol {
  kind: 'variable';
  name: string;
  declaredType: string | null;
  qualifier: 'var' | 'varip' | null;
  initializer: string | null;
  line: number;
  column: number;
  scope: LineRange;
}

export interface ImportDecl {
  owner: string;
  name: string;
  version: string;
  alias: string | null;
  line: number;
}

export interface DocumentModel {
  version: number | null;
  scriptKind: 'indicator' | 'strategy' | 'library' | null;
  libraryTitle: string | null;
  imports: ImportDecl[];
  functions: FunctionSymbol[];
  types: TypeSymbol[];
  enums: EnumSymbol[];
  variables: VariableSymbol[];
  lineCount: number;
}

export type DeclSymbol = FunctionSymbol | TypeSymbol | EnumSymbol;

const TYPE = String.raw`[A-Za-z_][\w.]*(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?(?:\[\])?`;
const NAME = String.raw`[A-Za-z_]\w*`;
const RE_VERSION = /^\/\/@version\s*=\s*(\d+)/;
const RE_DECLARATION = /^(indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?("([^"]*)"|'([^']*)')?/;
const RE_IMPORT = /^import\s+([\w-]+)\/([\w-]+)\/(\d+)(?:\s+as\s+(\w+))?/;
const RE_FUNCTION_HEAD = new RegExp(String.raw`^(export\s+)?(method\s+)?(${NAME})\s*\(`);
const RE_TYPE = new RegExp(String.raw`^(export\s+)?type\s+(${NAME})\s*$`);
const RE_ENUM = new RegExp(String.raw`^(export\s+)?enum\s+(${NAME})\s*$`);
const RE_FIELD = new RegExp(String.raw`^(${TYPE})\s+(${NAME})(?:\s*=\s*(.+))?$`);
const RE_ENUM_MEMBER = new RegExp(String.raw`^(${NAME})(?:\s*=\s*(.+))?$`);
const RE_VARIABLE = new RegExp(String.raw`^(?:(var|varip)\s+)?(?:(${TYPE})\s+)?(${NAME})\s*=(?![=>])\s*(.*)$`);
const RE_TUPLE = /^\[\s*([\w\s,]+)\]\s*=(?![=>])/;
const RE_PARAM = new RegExp(String.raw`^(?:(${TYPE})\s+)?(${NAME})(?:\s*=\s*(.+))?$`);

export function emptyAnnotations(): Annotations {
  return { function: null, description: null, params: {}, returns: null, type: null, fields: {}, enum: null, raw: [] };
}

export function buildModel(text: string): DocumentModel {
  const lines = text.split(/\r?\n/);
  const tokenLines = tokenize(text);
  const model: DocumentModel = {
    version: null,
    scriptKind: null,
    libraryTitle: null,
    imports: [],
    functions: [],
    types: [],
    enums: [],
    variables: [],
    lineCount: lines.length,
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const tl = tokenLines[i]!;
    if (tl.depthAtStart > 0 || tl.tokens[0]?.kind === 'string') continue; // continuation line
    const indent = raw.length - raw.trimStart().length;
    const code = stripComment(raw, tl).trim();
    if (!code) {
      const v = raw.match(RE_VERSION);
      if (v) model.version = Number(v[1]);
      continue;
    }

    if (indent === 0) {
      const decl = code.match(RE_DECLARATION);
      if (decl) {
        model.scriptKind = decl[1] as DocumentModel['scriptKind'];
        if (decl[1] === 'library') model.libraryTitle = decl[3] ?? decl[4] ?? null;
      }
      const imp = code.match(RE_IMPORT);
      if (imp) {
        model.imports.push({ owner: imp[1]!, name: imp[2]!, version: imp[3]!, alias: imp[4] ?? null, line: i });
        continue;
      }
    }

    const typeMatch = code.match(RE_TYPE);
    if (typeMatch) {
      const range = blockRange(lines, i, indent);
      const fields: FieldDecl[] = [];
      for (let j = i + 1; j <= range.end; j++) {
        const f = stripComment(lines[j]!, tokenLines[j]!).trim().match(RE_FIELD);
        if (f) fields.push({ name: f[2]!, type: f[1]!, default: f[3]?.trim() ?? null });
      }
      model.types.push({ kind: 'type', name: typeMatch[2]!, isExport: !!typeMatch[1], fields, docs: annotationsAbove(lines, i), line: i, range });
      i = range.end;
      continue;
    }

    const enumMatch = code.match(RE_ENUM);
    if (enumMatch) {
      const range = blockRange(lines, i, indent);
      const members: EnumMember[] = [];
      for (let j = i + 1; j <= range.end; j++) {
        const m = stripComment(lines[j]!, tokenLines[j]!).trim().match(RE_ENUM_MEMBER);
        if (m) members.push({ name: m[1]!, title: m[2]?.trim() ?? null });
      }
      model.enums.push({ kind: 'enum', name: enumMatch[2]!, isExport: !!enumMatch[1], members, docs: annotationsAbove(lines, i), line: i, range });
      i = range.end;
      continue;
    }

    const fn = code.match(RE_FUNCTION_HEAD);
    if (fn) {
      const header = joinHeader(lines, tokenLines, i);
      if (header && /=>\s*$/.test(header.text)) {
        const range = blockRange(lines, header.endLine, indent);
        range.start = i;
        const paramText = header.text.slice(header.text.indexOf('(') + 1, header.text.lastIndexOf(')'));
        model.functions.push({
          kind: 'function',
          name: fn[3]!,
          isMethod: !!fn[2],
          isExport: !!fn[1],
          params: parseParams(paramText),
          docs: annotationsAbove(lines, i),
          line: i,
          range,
        });
        // Body variables are collected in the main loop; the header lines are skipped here.
        i = header.endLine;
        continue;
      }
    }

    const tuple = code.match(RE_TUPLE);
    if (tuple) {
      for (const name of tuple[1]!.split(',').map((s) => s.trim()).filter(Boolean)) {
        model.variables.push({ kind: 'variable', name, declaredType: null, qualifier: null, initializer: null, line: i, column: raw.indexOf(name), scope: { start: i, end: lines.length - 1 } });
      }
      continue;
    }

    const v = code.match(RE_VARIABLE);
    if (v && !isKeyword(v[3]!)) {
      model.variables.push({
        kind: 'variable',
        name: v[3]!,
        declaredType: v[2] ?? null,
        qualifier: (v[1] as 'var' | 'varip' | undefined) ?? null,
        initializer: v[4]?.trim() || null,
        line: i,
        column: raw.indexOf(v[3]!),
        scope: { start: i, end: lines.length - 1 },
      });
    }
  }

  // Narrow variable scopes to the enclosing function body.
  for (const variable of model.variables) {
    const owner = model.functions.find((f) => variable.line > f.line && variable.line <= f.range.end);
    if (owner) variable.scope = { start: variable.line, end: owner.range.end };
  }
  return model;
}

export function declarationAt(model: DocumentModel, line: number): DeclSymbol | null {
  return model.functions.find((f) => f.line === line) ?? model.types.find((t) => t.line === line) ?? model.enums.find((e) => e.line === line) ?? null;
}

export function visibleVariables(model: DocumentModel, line: number): VariableSymbol[] {
  return model.variables.filter((v) => v.scope.start <= line && line <= v.scope.end);
}

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'once', 'return', 'and', 'or', 'not', 'import', 'export', 'type', 'enum', 'method', 'var', 'varip']);

function isKeyword(name: string): boolean {
  return KEYWORDS.has(name);
}

function stripComment(raw: string, tl: TokenizedLine): string {
  const c = tl.tokens.find((t) => t.kind === 'comment');
  return c ? raw.slice(0, c.start) : raw;
}

// Lines belonging to the block that starts at `line`: every following line that is blank or indented deeper than `indent`.
function blockRange(lines: string[], line: number, indent: number): LineRange {
  let end = line;
  for (let j = line + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (!l.trim()) continue;
    const ind = l.length - l.trimStart().length;
    if (ind <= indent) break;
    end = j;
  }
  return { start: line, end };
}

// Joins a function header whose parameter list spans several lines. Returns null when no `)` closes it within 20 lines.
function joinHeader(lines: string[], tokenLines: TokenizedLine[], start: number): { text: string; endLine: number } | null {
  let text = '';
  for (let j = start; j < Math.min(lines.length, start + 20); j++) {
    text += (j === start ? '' : ' ') + stripComment(lines[j]!, tokenLines[j]!).trim();
    const next = tokenLines[j + 1];
    if (!next || next.depthAtStart === 0) return { text, endLine: j };
  }
  return null;
}

export function parseParams(paramText: string): ParamDecl[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (const ch of paramText) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    if (ch === ')' || ch === ']' || ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts
    .map((p) => p.trim().replace(/^(?:series|simple|const|input)\s+/, ''))
    .map((p) => p.match(RE_PARAM))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[2]!, type: m[1] ?? null, default: m[3]?.trim() ?? null }));
}

export function annotationsAbove(lines: string[], line: number): Annotations {
  const docs = emptyAnnotations();
  const block: string[] = [];
  for (let j = line - 1; j >= 0; j--) {
    const t = lines[j]!.trim();
    if (!t.startsWith('//')) break;
    block.unshift(t);
  }
  let lastKey: { kind: 'params' | 'fields'; name: string } | 'function' | 'description' | 'returns' | 'type' | 'enum' | null = null;
  for (const text of block) {
    const m = text.match(/^\/\/\s*@(\w+)\s*(.*)$/);
    if (!m) {
      const plain = text.replace(/^\/\/\s?/, '');
      if (lastKey && plain) appendDoc(docs, lastKey, plain);
      continue;
    }
    docs.raw.push(text);
    const tag = m[1]!;
    const rest = m[2]!.trim();
    if (tag === 'param' || tag === 'field') {
      const pm = rest.match(/^(\w+)\s*(.*)$/);
      if (!pm) continue;
      const bucket = tag === 'param' ? docs.params : docs.fields;
      bucket[pm[1]!] = pm[2]!.trim();
      lastKey = { kind: tag === 'param' ? 'params' : 'fields', name: pm[1]! };
    } else if (tag === 'function' || tag === 'description' || tag === 'returns' || tag === 'type' || tag === 'enum') {
      docs[tag] = rest;
      lastKey = tag;
    } else if (tag === 'variable') {
      docs.description = rest;
      lastKey = 'description';
    }
  }
  return docs;
}

function appendDoc(docs: Annotations, key: NonNullable<ReturnType<typeof keyOf>>, text: string): void {
  if (typeof key === 'string') docs[key] = docs[key] ? `${docs[key]} ${text}` : text;
  else docs[key.kind][key.name] = docs[key.kind][key.name] ? `${docs[key.kind][key.name]} ${text}` : text;
}

function keyOf(): { kind: 'params' | 'fields'; name: string } | 'function' | 'description' | 'returns' | 'type' | 'enum' | null {
  return null;
}
```

Note for the implementer: `keyOf` exists only to name the union type for `appendDoc`; if you prefer, declare `type DocKey = …` and delete `keyOf`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/core/document-model.test.ts`
Expected: PASS (10 tests). If a range assertion is off by one, check the fixture line numbers (0-based) rather than the implementation first.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/extension/core/document-model.ts tests/core/document-model.test.ts tests/core/fixtures
git commit -m "Add document model for functions, types, enums, variables and imports"
```

---

### Task 6: Call resolver and completion context

**Files:**
- Create: `src/extension/core/call-resolver.ts`, `src/extension/core/context.ts`, `tests/core/call-resolver.test.ts`, `tests/core/context.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `TokenizedLine`, `Token` (Task 4).
- Produces:
  ```ts
  interface CallInfo { name: string; argIndex: number; namedArg: string | null; usedNamedArgs: string[]; line: number; column: number }
  function enclosingCall(tokenLines: TokenizedLine[], line: number, col: number): CallInfo | null;
  type CompletionContext =
    | { kind: 'none' }
    | { kind: 'annotation'; prefix: string }
    | { kind: 'import-path'; prefix: string }
    | { kind: 'member'; receiver: string; prefix: string }
    | { kind: 'named-arg'; call: CallInfo; prefix: string }
    | { kind: 'identifier'; prefix: string };
  function completionContext(tokenLines: TokenizedLine[], lineText: string, line: number, col: number): CompletionContext;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/core/call-resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { enclosingCall } from '../../src/extension/core/call-resolver';
import { tokenize } from '../../src/extension/core/tokenizer';

const at = (text: string) => {
  const line = text.split('\n').length - 1;
  const col = text.split('\n').at(-1)!.length;
  return enclosingCall(tokenize(text), line, col);
};

describe('enclosingCall', () => {
  it('finds the callee and argument index', () => {
    expect(at('plot(close, ')).toMatchObject({ name: 'plot', argIndex: 1, namedArg: null });
    expect(at('plot(ta.sma(close, ')).toMatchObject({ name: 'ta.sma', argIndex: 1 });
    expect(at('plot(ta.sma(close, 14), ')).toMatchObject({ name: 'plot', argIndex: 1 });
  });

  it('detects named arguments and remembers used ones', () => {
    expect(at('plot(close, title = "x", color = ')).toMatchObject({ name: 'plot', argIndex: 2, namedArg: 'color', usedNamedArgs: ['title', 'color'] });
  });

  it('ignores commas inside strings and brackets', () => {
    expect(at('str.format("{0}, {1}", a[1, ')).toMatchObject({ name: 'str.format', argIndex: 1 });
  });

  it('works across lines', () => {
    expect(at('plot(close,\n     title = "x",\n     ')).toMatchObject({ name: 'plot', argIndex: 2 });
  });

  it('returns null outside calls or for grouping parens', () => {
    expect(at('x = 1 + ')).toBeNull();
    expect(at('x = (a + ')).toBeNull();
  });

  it('reports the call position', () => {
    expect(at('  plot(close, ')).toMatchObject({ line: 0, column: 2 });
  });
});
```

`tests/core/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { completionContext } from '../../src/extension/core/context';
import { tokenize } from '../../src/extension/core/tokenizer';

const ctx = (text: string) => {
  const lines = text.split('\n');
  const line = lines.length - 1;
  return completionContext(tokenize(text), lines[line]!, line, lines[line]!.length);
};

describe('completionContext', () => {
  it('is silent inside strings and plain comments', () => {
    expect(ctx('x = "ab')).toEqual({ kind: 'none' });
    expect(ctx('// hello wo')).toEqual({ kind: 'none' });
  });

  it('detects annotations', () => {
    expect(ctx('//@par')).toEqual({ kind: 'annotation', prefix: 'par' });
    expect(ctx('// @')).toEqual({ kind: 'annotation', prefix: '' });
  });

  it('detects import paths', () => {
    expect(ctx('import Trad')).toEqual({ kind: 'import-path', prefix: 'Trad' });
    expect(ctx('import TradingView/ta/')).toEqual({ kind: 'import-path', prefix: 'TradingView/ta/' });
    expect(ctx('import TradingView/ta/14 as ')).toEqual({ kind: 'none' });
  });

  it('detects member access', () => {
    expect(ctx('x = ta.')).toEqual({ kind: 'member', receiver: 'ta', prefix: '' });
    expect(ctx('x = ta.sm')).toEqual({ kind: 'member', receiver: 'ta', prefix: 'sm' });
    expect(ctx('chart.point.')).toEqual({ kind: 'member', receiver: 'chart.point', prefix: '' });
  });

  it('detects named-argument position inside calls', () => {
    expect(ctx('plot(close, ')).toMatchObject({ kind: 'named-arg', prefix: '', call: { name: 'plot', argIndex: 1 } });
    expect(ctx('plot(close, ti')).toMatchObject({ kind: 'named-arg', prefix: 'ti' });
    expect(ctx('plot(close, title = ')).toEqual({ kind: 'identifier', prefix: '' });
  });

  it('falls back to identifiers', () => {
    expect(ctx('x = clo')).toEqual({ kind: 'identifier', prefix: 'clo' });
    expect(ctx('')).toEqual({ kind: 'identifier', prefix: '' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/call-resolver.test.ts tests/core/context.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/extension/core/call-resolver.ts`**

```ts
import type { Token, TokenizedLine } from './tokenizer';

export interface CallInfo {
  name: string;
  argIndex: number;
  namedArg: string | null;
  usedNamedArgs: string[];
  line: number;
  column: number;
}

const MAX_LINES_BACK = 50;

// Flattens tokens from up to MAX_LINES_BACK lines before the cursor, keeping only what precedes (line, col).
function tokensBefore(tokenLines: TokenizedLine[], line: number, col: number): Token[] {
  const out: Token[] = [];
  for (let l = Math.max(0, line - MAX_LINES_BACK); l <= line; l++) {
    for (const t of tokenLines[l]?.tokens ?? []) {
      if (t.kind === 'ws' || t.kind === 'comment') continue;
      if (l === line && t.start >= col) break;
      if (l === line && t.end > col) {
        out.push({ ...t, end: col, text: t.text.slice(0, col - t.start) });
        break;
      }
      out.push(t);
    }
  }
  return out;
}

export function enclosingCall(tokenLines: TokenizedLine[], line: number, col: number): CallInfo | null {
  const tokens = tokensBefore(tokenLines, line, col);
  let depth = 0;
  let commas = 0;
  let openIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind === 'close') depth++;
    else if (t.kind === 'open') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const callee = tokens[i - 1];
      if (t.text === '(' && callee?.kind === 'ident') {
        openIndex = i;
        break;
      }
      // Grouping parens or an index: keep looking outward but reset the comma count for this level.
      commas = 0;
      continue;
    } else if (t.kind === 'comma' && depth === 0) commas++;
  }
  if (openIndex === -1) return null;
  const callee = tokens[openIndex - 1]!;

  // Split the argument region into top-level segments to find named arguments.
  const args: Token[][] = [[]];
  let d = 0;
  for (const t of tokens.slice(openIndex + 1)) {
    if (t.kind === 'open') d++;
    if (t.kind === 'close') d--;
    if (t.kind === 'comma' && d === 0) {
      args.push([]);
      continue;
    }
    args.at(-1)!.push(t);
  }
  const usedNamedArgs: string[] = [];
  for (const seg of args) {
    if (seg[0]?.kind === 'ident' && seg[1]?.kind === 'op' && seg[1].text === '=') usedNamedArgs.push(seg[0].text);
  }
  const current = args.at(-1)!;
  const namedArg = current[0]?.kind === 'ident' && current[1]?.kind === 'op' && current[1].text === '=' ? current[0].text : null;

  return { name: callee.text, argIndex: commas, namedArg, usedNamedArgs, line: callee.line, column: callee.start };
}
```

- [ ] **Step 4: Implement `src/extension/core/context.ts`**

```ts
import { enclosingCall, type CallInfo } from './call-resolver';
import { isInStringOrComment, type TokenizedLine } from './tokenizer';

export type CompletionContext =
  | { kind: 'none' }
  | { kind: 'annotation'; prefix: string }
  | { kind: 'import-path'; prefix: string }
  | { kind: 'member'; receiver: string; prefix: string }
  | { kind: 'named-arg'; call: CallInfo; prefix: string }
  | { kind: 'identifier'; prefix: string };

const RE_ANNOTATION = /\/\/\s*@(\w*)$/;
const RE_IMPORT = /^\s*import\s+([\w\-/.]*)$/;
const RE_MEMBER = /([A-Za-z_][\w.]*)\.(\w*)$/;
const RE_WORD = /(\w*)$/;

export function completionContext(tokenLines: TokenizedLine[], lineText: string, line: number, col: number): CompletionContext {
  const before = lineText.slice(0, col);
  const annotation = before.match(RE_ANNOTATION);
  if (annotation) return { kind: 'annotation', prefix: annotation[1]! };

  const tl = tokenLines[line];
  if (tl && isInStringOrComment(tl, col) && !/^\s*\/\/\s*@\w*$/.test(before)) return { kind: 'none' };

  const imp = before.match(RE_IMPORT);
  if (imp) return { kind: 'import-path', prefix: imp[1]! };
  if (/^\s*import\s+\S+\s/.test(before)) return { kind: 'none' };

  const member = before.match(RE_MEMBER);
  if (member) return { kind: 'member', receiver: member[1]!, prefix: member[2]! };

  const prefix = before.match(RE_WORD)![1]!;
  const call = enclosingCall(tokenLines, line, col);
  if (call && !call.namedArg) {
    const sinceSeparator = before.slice(0, col - prefix.length).trimEnd();
    if (sinceSeparator.endsWith('(') || sinceSeparator.endsWith(',')) return { kind: 'named-arg', call, prefix };
  }
  return { kind: 'identifier', prefix };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/core/call-resolver.test.ts tests/core/context.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/extension/core/call-resolver.ts src/extension/core/context.ts tests/core/call-resolver.test.ts tests/core/context.test.ts
git commit -m "Resolve enclosing calls and completion context at a cursor position"
```

---

### Task 7: Markdown builders

**Files:**
- Create: `src/extension/core/markdown.ts`, `tests/core/markdown.test.ts`

**Interfaces:**
- Consumes: `RefEntry`, `RefOverload`, `ReferenceIndex` (Task 3); `FunctionSymbol`, `TypeSymbol`, `EnumSymbol`, `ParamDecl` (Task 5).
- Produces:
  ```ts
  function entryMarkdown(entry: RefEntry, ref: ReferenceIndex, overloadIndex?: number): string;
  function entryDetail(entry: RefEntry): string;                       // one line: syntax or "kind · type"
  function functionSignatureLabel(fn: FunctionSymbol): string;         // "weighted(float a, float b, float w = 0.5)"
  function functionMarkdown(fn: FunctionSymbol, origin?: string): string;
  function typeMarkdown(t: TypeSymbol, origin?: string): string;
  function enumMarkdown(e: EnumSymbol, origin?: string): string;
  ```

- [ ] **Step 1: Write the failing test `tests/core/markdown.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import { entryDetail, entryMarkdown, functionMarkdown, functionSignatureLabel } from '../../src/extension/core/markdown';
import { loadReference } from '../../src/extension/core/reference';

describe('markdown', () => {
  const ref = loadReference();

  it('renders a built-in function', () => {
    const md = entryMarkdown(ref.get('ta.sma')!, ref);
    expect(md).toContain('```pine\nta.sma(source, length) → series float\n```');
    expect(md).toContain('**Parameters**');
    expect(md).toContain('`source`');
    expect(md).toContain('**Returns**');
    expect(md).toContain('[Reference](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sma)');
  });

  it('renders a variable with its type', () => {
    const md = entryMarkdown(ref.get('close')!, ref);
    expect(md).toContain('```pine\n(variable) close: series float\n```');
    expect(entryDetail(ref.get('close')!)).toBe('series float');
  });

  it('renders user functions from the document model', () => {
    const m = buildModel('//@function Adds.\n//@param a Left.\n//@returns Sum.\nadd(float a, b = 1) =>\n    a + b\n');
    const fn = m.functions[0]!;
    expect(functionSignatureLabel(fn)).toBe('add(float a, b = 1)');
    const md = functionMarkdown(fn);
    expect(md).toContain('```pine\nadd(float a, b = 1)\n```');
    expect(md).toContain('Adds.');
    expect(md).toContain('`a` Left.');
    expect(md).toContain('**Returns** Sum.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/markdown.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/markdown.ts`**

```ts
import type { EnumSymbol, FunctionSymbol, ParamDecl, TypeSymbol } from './document-model';
import type { RefEntry, ReferenceIndex } from './reference';

const fence = (code: string) => '```pine\n' + code + '\n```';

export function entryDetail(entry: RefEntry): string {
  if (entry.kind === 'function') return entry.overloads[0]?.syntax ?? `${entry.name}()`;
  if (entry.type) return entry.type;
  return entry.kind;
}

export function entryMarkdown(entry: RefEntry, ref: ReferenceIndex, overloadIndex = 0): string {
  const parts: string[] = [];
  if (entry.kind === 'function') {
    const overload = entry.overloads[overloadIndex] ?? entry.overloads[0];
    const others = entry.overloads.length > 1 ? `\n\n_${entry.overloads.length} overloads_` : '';
    parts.push(fence(overload?.syntax ?? `${entry.name}()`) + others);
    if (entry.description) parts.push(entry.description);
    if (overload && overload.params.length) {
      parts.push('**Parameters**\n\n' + overload.params.map((p) => `- \`${p.name}\` (${p.type}) ${p.description}`).join('\n'));
    }
    if (overload?.returns?.description || overload?.returns?.type) {
      parts.push(`**Returns** ${overload.returns.description || overload.returns.type}`);
    }
  } else {
    const label = entry.kind === 'type' ? `(type) ${entry.name}` : `(${entry.kind}) ${entry.name}${entry.type ? `: ${entry.type}` : ''}`;
    parts.push(fence(label));
    if (entry.description) parts.push(entry.description);
    if (entry.fields.length) parts.push('**Fields**\n\n' + entry.fields.map((f) => `- \`${f.name}\` (${f.type}) ${f.description}`).join('\n'));
    if (entry.kind === 'keyword' || entry.kind === 'operator') {
      const syntax = entry.overloads[0]?.syntax;
      if (syntax) parts.push(fence(syntax));
    }
  }
  if (entry.remarks) parts.push(`**Remarks** ${entry.remarks}`);
  parts.push(`[Reference](${ref.url(entry)})`);
  return parts.join('\n\n');
}

function paramLabel(p: ParamDecl): string {
  return `${p.type ? `${p.type} ` : ''}${p.name}${p.default !== null ? ` = ${p.default}` : ''}`;
}

export function functionSignatureLabel(fn: FunctionSymbol): string {
  return `${fn.name}(${fn.params.map(paramLabel).join(', ')})`;
}

export function functionMarkdown(fn: FunctionSymbol, origin?: string): string {
  const parts = [fence(`${fn.isExport ? 'export ' : ''}${fn.isMethod ? 'method ' : ''}${functionSignatureLabel(fn)}`)];
  if (origin) parts.push(`_${origin}_`);
  if (fn.docs.function || fn.docs.description) parts.push(fn.docs.function ?? fn.docs.description!);
  const documented = fn.params.filter((p) => fn.docs.params[p.name]);
  if (documented.length) parts.push('**Parameters**\n\n' + documented.map((p) => `- \`${p.name}\` ${fn.docs.params[p.name]}`).join('\n'));
  if (fn.docs.returns) parts.push(`**Returns** ${fn.docs.returns}`);
  return parts.join('\n\n');
}

export function typeMarkdown(t: TypeSymbol, origin?: string): string {
  const parts = [fence(`${t.isExport ? 'export ' : ''}type ${t.name}`)];
  if (origin) parts.push(`_${origin}_`);
  if (t.docs.type || t.docs.description) parts.push(t.docs.type ?? t.docs.description!);
  if (t.fields.length) {
    parts.push('**Fields**\n\n' + t.fields.map((f) => `- \`${f.name}\` (${f.type})${t.docs.fields[f.name] ? ` ${t.docs.fields[f.name]}` : ''}`).join('\n'));
  }
  return parts.join('\n\n');
}

export function enumMarkdown(e: EnumSymbol, origin?: string): string {
  const parts = [fence(`${e.isExport ? 'export ' : ''}enum ${e.name}`)];
  if (origin) parts.push(`_${origin}_`);
  if (e.docs.enum || e.docs.description) parts.push(e.docs.enum ?? e.docs.description!);
  if (e.members.length) {
    parts.push('**Members**\n\n' + e.members.map((m) => `- \`${m.name}\`${m.title ? ` ${m.title}` : ''}${e.docs.fields[m.name] ? ` ${e.docs.fields[m.name]}` : ''}`).join('\n'));
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/markdown.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/extension/core/markdown.ts tests/core/markdown.test.ts
git commit -m "Build hover and completion documentation as markdown"
```

---

### Task 8: Settings, document cache, and the four read-only providers

**Files:**
- Create: `src/extension/vscode/settings.ts`, `src/extension/vscode/document-cache.ts`, `src/extension/providers/completion.ts`, `src/extension/providers/hover.ts`, `src/extension/providers/signature-help.ts`, `src/extension/providers/document-symbol.ts`
- Modify: `src/extension/extension.ts`, `package.json` (configuration contribution)

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces:
  ```ts
  // settings.ts
  interface Settings { completion: boolean; hover: boolean; signatureHelp: boolean; librariesInclude: string; librariesRemote: boolean; diagnosticsRemote: boolean }
  function getSettings(): Settings;
  // document-cache.ts
  interface Analysis { model: DocumentModel; tokens: TokenizedLine[]; lines: string[] }
  function analyze(document: vscode.TextDocument): Analysis;      // cached by uri+version, 20 documents LRU
  // extension.ts
  function registerProviders(context): void;                       // disposes and re-registers on configuration change
  ```
  Library-aware parts of completion and hover call `LibraryIndex` from Task 12; until then they use an interface stub `libraries: LibraryLookup` with `aliasExports(alias, model)` returning `[]`. Define that interface here:
  ```ts
  interface LibraryLookup {
    forImport(imp: ImportDecl): Promise<LibraryInfo | null>;
    local(): LibraryInfo[];
    search(prefix: string): Promise<LibraryInfo[]>;
  }
  ```
  and `LibraryInfo` in `core/libraries.ts` (create the type file now; Task 12 fills the logic):
  ```ts
  interface LibraryInfo { id: string; title: string; owner: string | null; version: string | null; description: string | null; functions: FunctionSymbol[]; types: TypeSymbol[]; enums: EnumSymbol[]; source: 'local' | 'remote' }
  ```

- [ ] **Step 1: Add the configuration contribution to `package.json`**

Inside `contributes`:

```json
"configuration": {
  "title": "Pine Script",
  "properties": {
    "pinescript.completion.enabled": { "type": "boolean", "default": true, "description": "Suggest built-ins, keywords, user symbols and named arguments while typing." },
    "pinescript.hover.enabled": { "type": "boolean", "default": true, "description": "Show documentation when hovering built-ins and user symbols." },
    "pinescript.signatureHelp.enabled": { "type": "boolean", "default": true, "description": "Show parameter hints inside function calls." },
    "pinescript.libraries.local.include": { "type": "string", "default": "**/*.pine", "description": "Glob for workspace files scanned for library() declarations." },
    "pinescript.libraries.remote": { "type": "boolean", "default": true, "description": "Query TradingView for published libraries when completing import statements and hovering imports. Only the typed prefix and library ids are sent." },
    "pinescript.diagnostics.remote": { "type": "boolean", "default": false, "description": "Send the document text to the TradingView compiler to show errors and warnings. Off by default because the full script leaves your machine." }
  }
}
```

- [ ] **Step 2: Create `src/extension/vscode/settings.ts`**

```ts
import * as vscode from 'vscode';

export interface Settings {
  completion: boolean;
  hover: boolean;
  signatureHelp: boolean;
  librariesInclude: string;
  librariesRemote: boolean;
  diagnosticsRemote: boolean;
}

export function getSettings(): Settings {
  const c = vscode.workspace.getConfiguration('pinescript');
  return {
    completion: c.get<boolean>('completion.enabled', true),
    hover: c.get<boolean>('hover.enabled', true),
    signatureHelp: c.get<boolean>('signatureHelp.enabled', true),
    librariesInclude: c.get<string>('libraries.local.include', '**/*.pine'),
    librariesRemote: c.get<boolean>('libraries.remote', true),
    diagnosticsRemote: c.get<boolean>('diagnostics.remote', false),
  };
}
```

- [ ] **Step 3: Create `src/extension/vscode/document-cache.ts`**

```ts
import * as vscode from 'vscode';
import { buildModel, type DocumentModel } from '../core/document-model';
import { tokenize, type TokenizedLine } from '../core/tokenizer';

export interface Analysis {
  model: DocumentModel;
  tokens: TokenizedLine[];
  lines: string[];
}

const MAX = 20;
const cache = new Map<string, { version: number; analysis: Analysis }>();

export function analyze(document: vscode.TextDocument): Analysis {
  const key = document.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === document.version) return hit.analysis;
  const text = document.getText();
  const analysis: Analysis = { model: buildModel(text), tokens: tokenize(text), lines: text.split(/\r?\n/) };
  cache.delete(key);
  cache.set(key, { version: document.version, analysis });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return analysis;
}

export function forget(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}
```

- [ ] **Step 4: Create the `LibraryInfo` type and `LibraryLookup` stub**

`src/extension/core/libraries.ts` (types only for now):

```ts
import type { EnumSymbol, FunctionSymbol, ImportDecl, TypeSymbol } from './document-model';

export interface LibraryInfo {
  id: string;
  title: string;
  owner: string | null;
  version: string | null;
  description: string | null;
  functions: FunctionSymbol[];
  types: TypeSymbol[];
  enums: EnumSymbol[];
  source: 'local' | 'remote';
}

export interface LibraryLookup {
  forImport(imp: ImportDecl): Promise<LibraryInfo | null>;
  local(): LibraryInfo[];
  search(prefix: string): Promise<LibraryInfo[]>;
}

export const noLibraries: LibraryLookup = {
  forImport: async () => null,
  local: () => [],
  search: async () => [],
};
```

- [ ] **Step 5: Create `src/extension/providers/completion.ts`**

```ts
import * as vscode from 'vscode';
import { completionContext } from '../core/context';
import type { DocumentModel, EnumSymbol, FunctionSymbol, TypeSymbol } from '../core/document-model';
import { visibleVariables } from '../core/document-model';
import type { LibraryInfo, LibraryLookup } from '../core/libraries';
import { entryDetail, entryMarkdown, enumMarkdown, functionMarkdown, functionSignatureLabel, typeMarkdown } from '../core/markdown';
import type { RefEntry, ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';

const KEYWORDS = ['and', 'or', 'not', 'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'once', 'var', 'varip', 'import', 'export', 'method', 'type', 'enum', 'true', 'false', 'na', 'series', 'simple', 'const', 'input'];
const TYPES = ['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'array', 'matrix', 'map', 'chart.point', 'footprint', 'volume_row'];

const KIND: Record<RefEntry['kind'], vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  constant: vscode.CompletionItemKind.Constant,
  keyword: vscode.CompletionItemKind.Keyword,
  type: vscode.CompletionItemKind.Class,
  annotation: vscode.CompletionItemKind.Keyword,
  operator: vscode.CompletionItemKind.Operator,
};

export class PineCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const { model, tokens, lines } = analyze(document);
    const ctx = completionContext(tokens, lines[position.line] ?? '', position.line, position.character);
    switch (ctx.kind) {
      case 'none':
        return [];
      case 'annotation':
        return this.ref.byKind('annotation').map((e) => this.entryItem(e, e.name.replace(/^@/, '')));
      case 'import-path':
        return this.importItems(ctx.prefix);
      case 'member':
        return this.memberItems(ctx.receiver, model);
      case 'named-arg':
        return [...this.namedArgItems(ctx.call.name, ctx.call.usedNamedArgs, model), ...this.identifierItems(model, position.line)];
      case 'identifier':
        return this.identifierItems(model, position.line);
    }
  }

  private entryItem(entry: RefEntry, label = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1) : entry.name): vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, KIND[entry.kind]);
    item.detail = entryDetail(entry);
    item.documentation = new vscode.MarkdownString(entryMarkdown(entry, this.ref));
    if (entry.kind === 'function') {
      item.insertText = new vscode.SnippetString(`${label}($1)`);
      item.command = { command: 'editor.action.triggerParameterHints', title: 'Trigger parameter hints' };
    }
    return item;
  }

  private namespaceItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = 'namespace';
    return item;
  }

  private identifierItems(model: DocumentModel, line: number): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    for (const ns of this.ref.childNamespaces('')) items.push(this.namespaceItem(ns));
    for (const e of this.ref.bare()) items.push(this.entryItem(e));
    for (const k of KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
    for (const t of TYPES) items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.Class));
    for (const f of model.functions) items.push(userFunctionItem(f));
    for (const t of model.types) items.push(userTypeItem(t));
    for (const e of model.enums) items.push(userEnumItem(e));
    for (const v of visibleVariables(model, line)) {
      const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
      item.detail = v.declaredType ?? undefined;
      items.push(item);
    }
    for (const imp of model.imports) {
      if (imp.alias) {
        const item = new vscode.CompletionItem(imp.alias, vscode.CompletionItemKind.Module);
        item.detail = `${imp.owner}/${imp.name}/${imp.version}`;
        items.push(item);
      }
    }
    return items;
  }

  private async memberItems(receiver: string, model: DocumentModel): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    for (const ns of this.ref.childNamespaces(receiver)) items.push(this.namespaceItem(ns));
    for (const e of this.ref.members(receiver)) items.push(this.entryItem(e));

    const type = model.types.find((t) => t.name === receiver);
    if (type) {
      const ctor = new vscode.CompletionItem('new', vscode.CompletionItemKind.Constructor);
      ctor.insertText = new vscode.SnippetString('new($1)');
      ctor.detail = `${type.name}.new(${type.fields.map((f) => f.name).join(', ')})`;
      items.push(ctor);
      for (const f of type.fields) items.push(Object.assign(new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Field), { detail: f.type }));
    }
    const en = model.enums.find((e) => e.name === receiver);
    if (en) for (const m of en.members) items.push(new vscode.CompletionItem(m.name, vscode.CompletionItemKind.EnumMember));

    const imp = model.imports.find((i) => i.alias === receiver);
    if (imp) {
      const lib = await this.libraries.forImport(imp);
      if (lib) items.push(...libraryExportItems(lib));
    }
    // Methods declared on user types: `x.` where x is a variable of that type is out of scope; methods appear as functions.
    return items;
  }

  private namedArgItems(callee: string, used: string[], model: DocumentModel): vscode.CompletionItem[] {
    const names = new Set<string>();
    const entry = this.ref.get(callee, 'function');
    if (entry) for (const o of entry.overloads) for (const p of o.params) names.add(p.name);
    const fn = model.functions.find((f) => f.name === callee);
    if (fn) for (const p of fn.params) names.add(p.name);
    return [...names]
      .filter((n) => !used.includes(n))
      .map((n) => {
        const item = new vscode.CompletionItem(`${n}=`, vscode.CompletionItemKind.Property);
        item.insertText = `${n} = `;
        item.sortText = `0${n}`;
        item.detail = 'named argument';
        return item;
      });
  }

  private async importItems(prefix: string): Promise<vscode.CompletionItem[]> {
    const local = this.libraries.local();
    const remote = await this.libraries.search(prefix);
    return [...local, ...remote].map((lib) => {
      const item = new vscode.CompletionItem(lib.id, vscode.CompletionItemKind.Module);
      item.detail = lib.source === 'local' ? 'workspace library' : 'TradingView library';
      if (lib.description) item.documentation = new vscode.MarkdownString(lib.description);
      item.range = undefined;
      item.filterText = lib.id;
      return item;
    });
  }
}

export function userFunctionItem(f: FunctionSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(f.name, f.isMethod ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Function);
  item.detail = functionSignatureLabel(f);
  item.documentation = new vscode.MarkdownString(functionMarkdown(f, origin));
  item.insertText = new vscode.SnippetString(`${f.name}($1)`);
  item.command = { command: 'editor.action.triggerParameterHints', title: 'Trigger parameter hints' };
  return item;
}

export function userTypeItem(t: TypeSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Class);
  item.documentation = new vscode.MarkdownString(typeMarkdown(t, origin));
  return item;
}

export function userEnumItem(e: EnumSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Enum);
  item.documentation = new vscode.MarkdownString(enumMarkdown(e, origin));
  return item;
}

export function libraryExportItems(lib: LibraryInfo): vscode.CompletionItem[] {
  const origin = `from ${lib.id}`;
  return [
    ...lib.functions.map((f) => userFunctionItem(f, origin)),
    ...lib.types.map((t) => userTypeItem(t, origin)),
    ...lib.enums.map((e) => userEnumItem(e, origin)),
  ];
}
```

- [ ] **Step 6: Create `src/extension/providers/hover.ts`**

```ts
import * as vscode from 'vscode';
import { visibleVariables } from '../core/document-model';
import type { LibraryLookup } from '../core/libraries';
import { entryMarkdown, enumMarkdown, functionMarkdown, typeMarkdown } from '../core/markdown';
import type { ReferenceIndex } from '../core/reference';
import { isInStringOrComment, wordAt } from '../core/tokenizer';
import { analyze } from '../vscode/document-cache';

export class PineHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    const { model, tokens, lines } = analyze(document);
    const lineText = lines[position.line] ?? '';
    const tl = tokens[position.line];

    const imp = model.imports.find((i) => i.line === position.line);
    if (imp) {
      const lib = await this.libraries.forImport(imp);
      if (!lib) return null;
      const exports = [...lib.functions.map((f) => `\`${f.name}()\``), ...lib.types.map((t) => `\`${t.name}\``), ...lib.enums.map((e) => `\`${e.name}\``)];
      const md = [`**${lib.title}** _(${lib.source === 'local' ? 'workspace' : 'TradingView'})_`, lib.description ?? '', exports.length ? `Exports: ${exports.join(', ')}` : ''].filter(Boolean).join('\n\n');
      return new vscode.Hover(new vscode.MarkdownString(md));
    }

    if (tl && isInStringOrComment(tl, position.character)) {
      const ann = lineText.slice(0, position.character + 1).match(/\/\/\s*(@\w+)$/) ?? lineText.match(/\/\/\s*(@\w+)/);
      const entry = ann ? this.ref.get(ann[1]!, 'annotation') : undefined;
      return entry ? new vscode.Hover(new vscode.MarkdownString(entryMarkdown(entry, this.ref))) : null;
    }

    const word = wordAt(lineText, position.character);
    if (!word) return null;
    const range = new vscode.Range(position.line, word.start, position.line, word.end);
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    // Alias member: ma.weighted
    const dot = word.text.indexOf('.');
    if (dot > 0) {
      const alias = word.text.slice(0, dot);
      const member = word.text.slice(dot + 1);
      const imp = model.imports.find((i) => i.alias === alias);
      if (imp) {
        const lib = await this.libraries.forImport(imp);
        const f = lib?.functions.find((f) => f.name === member);
        if (f) return new vscode.Hover(new vscode.MarkdownString(functionMarkdown(f, `from ${lib!.id}`)), range);
        const t = lib?.types.find((t) => t.name === member);
        if (t) return new vscode.Hover(new vscode.MarkdownString(typeMarkdown(t, `from ${lib!.id}`)), range);
        const e = lib?.enums.find((e) => e.name === member);
        if (e) return new vscode.Hover(new vscode.MarkdownString(enumMarkdown(e, `from ${lib!.id}`)), range);
      }
    }

    // User symbols.
    const fn = model.functions.find((f) => f.name === word.text || (word.text.includes('.') && f.isMethod && word.text.endsWith(`.${f.name}`)));
    if (fn) return new vscode.Hover(new vscode.MarkdownString(functionMarkdown(fn)), range);
    const type = model.types.find((t) => t.name === word.text);
    if (type) return new vscode.Hover(new vscode.MarkdownString(typeMarkdown(type)), range);
    const en = model.enums.find((e) => e.name === word.text || word.text.startsWith(`${e.name}.`));
    if (en) return new vscode.Hover(new vscode.MarkdownString(enumMarkdown(en)), range);
    const variable = visibleVariables(model, position.line).find((v) => v.name === word.text);
    if (variable) {
      const decl = `${variable.qualifier ? `${variable.qualifier} ` : ''}${variable.declaredType ? `${variable.declaredType} ` : ''}${variable.name}${variable.initializer ? ` = ${variable.initializer}` : ''}`;
      return new vscode.Hover(new vscode.MarkdownString('```pine\n' + decl + '\n```'), range);
    }

    // Built-ins: longest dotted match first, then shorter prefixes ending at the cursor.
    const candidates = [word.text];
    const parts = word.text.split('.');
    for (let i = parts.length - 1; i > 0; i--) candidates.push(parts.slice(0, i).join('.'));
    for (const name of candidates) {
      const entries = this.ref.getAll(name);
      if (entries.length) {
        const preferred = this.ref.get(name)!;
        const others = entries.filter((e) => e !== preferred);
        const text = [entryMarkdown(preferred, this.ref), ...others.map((e) => entryMarkdown(e, this.ref))].join('\n\n---\n\n');
        return new vscode.Hover(new vscode.MarkdownString(text), range);
      }
    }
    return null;
  }
}
```

- [ ] **Step 7: Create `src/extension/providers/signature-help.ts`**

```ts
import * as vscode from 'vscode';
import { enclosingCall } from '../core/call-resolver';
import type { LibraryLookup } from '../core/libraries';
import { functionSignatureLabel } from '../core/markdown';
import type { ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';
import type { FunctionSymbol } from '../core/document-model';

export class PineSignatureHelpProvider implements vscode.SignatureHelpProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.SignatureHelp | null> {
    const { model, tokens } = analyze(document);
    const call = enclosingCall(tokens, position.line, position.character);
    if (!call) return null;

    const help = new vscode.SignatureHelp();
    const entry = this.ref.get(call.name, 'function');
    if (entry) {
      for (const o of entry.overloads) {
        const sig = new vscode.SignatureInformation(o.syntax, new vscode.MarkdownString(entry.description));
        sig.parameters = o.params.map((p) => new vscode.ParameterInformation(p.name, new vscode.MarkdownString(`(${p.type}) ${p.description}`)));
        help.signatures.push(sig);
      }
    } else {
      let fn: FunctionSymbol | undefined = model.functions.find((f) => f.name === call.name);
      let origin: string | undefined;
      const dot = call.name.indexOf('.');
      if (!fn && dot > 0) {
        const imp = model.imports.find((i) => i.alias === call.name.slice(0, dot));
        const lib = imp ? await this.libraries.forImport(imp) : null;
        fn = lib?.functions.find((f) => f.name === call.name.slice(dot + 1));
        origin = lib?.id;
        if (!fn) {
          const type = model.types.find((t) => t.name === call.name.slice(0, dot));
          if (type && call.name.endsWith('.new')) {
            const sig = new vscode.SignatureInformation(`${type.name}.new(${type.fields.map((f) => `${f.type} ${f.name}${f.default ? ` = ${f.default}` : ''}`).join(', ')})`);
            sig.parameters = type.fields.map((f) => new vscode.ParameterInformation(f.name, type.docs.fields[f.name]));
            help.signatures.push(sig);
          }
        }
      }
      if (fn) {
        const sig = new vscode.SignatureInformation(functionSignatureLabel(fn), new vscode.MarkdownString(origin ? `_from ${origin}_\n\n${fn.docs.function ?? ''}` : (fn.docs.function ?? '')));
        sig.parameters = fn.params.map((p) => new vscode.ParameterInformation(p.name, fn!.docs.params[p.name]));
        help.signatures.push(sig);
      }
    }
    if (!help.signatures.length) return null;

    // Active signature: first whose parameter count covers the current argument; active parameter: named or positional.
    help.activeSignature = Math.max(0, help.signatures.findIndex((s) => s.parameters.length > call.argIndex));
    const active = help.signatures[help.activeSignature]!;
    const named = call.namedArg ? active.parameters.findIndex((p) => p.label === call.namedArg) : -1;
    help.activeParameter = named >= 0 ? named : Math.min(call.argIndex, Math.max(0, active.parameters.length - 1));
    return help;
  }
}
```

- [ ] **Step 8: Create `src/extension/providers/document-symbol.ts`**

```ts
import * as vscode from 'vscode';
import { analyze } from '../vscode/document-cache';

export class PineDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const { model, lines } = analyze(document);
    const symbols: vscode.DocumentSymbol[] = [];
    const lineRange = (start: number, end: number) => new vscode.Range(start, 0, end, lines[end]?.length ?? 0);

    for (const f of model.functions) {
      symbols.push(new vscode.DocumentSymbol(f.name, f.isMethod ? 'method' : 'function', f.isMethod ? vscode.SymbolKind.Method : vscode.SymbolKind.Function, lineRange(f.range.start, f.range.end), lineRange(f.line, f.line)));
    }
    for (const t of model.types) {
      const s = new vscode.DocumentSymbol(t.name, 'type', vscode.SymbolKind.Struct, lineRange(t.range.start, t.range.end), lineRange(t.line, t.line));
      s.children = t.fields.map((f, i) => new vscode.DocumentSymbol(f.name, f.type, vscode.SymbolKind.Field, lineRange(t.line + 1 + i, t.line + 1 + i), lineRange(t.line + 1 + i, t.line + 1 + i)));
      symbols.push(s);
    }
    for (const e of model.enums) {
      const s = new vscode.DocumentSymbol(e.name, 'enum', vscode.SymbolKind.Enum, lineRange(e.range.start, e.range.end), lineRange(e.line, e.line));
      s.children = e.members.map((m, i) => new vscode.DocumentSymbol(m.name, m.title ?? '', vscode.SymbolKind.EnumMember, lineRange(e.line + 1 + i, e.line + 1 + i), lineRange(e.line + 1 + i, e.line + 1 + i)));
      symbols.push(s);
    }
    for (const v of model.variables) {
      if (model.functions.some((f) => v.line > f.line && v.line <= f.range.end)) continue; // locals stay out of the outline
      symbols.push(new vscode.DocumentSymbol(v.name, v.declaredType ?? '', vscode.SymbolKind.Variable, lineRange(v.line, v.line), new vscode.Range(v.line, v.column, v.line, v.column + v.name.length)));
    }
    return symbols.sort((a, b) => a.range.start.line - b.range.start.line);
  }
}
```

- [ ] **Step 9: Wire everything in `src/extension/extension.ts`**

```ts
import * as vscode from 'vscode';
import { noLibraries, type LibraryLookup } from './core/libraries';
import { loadReference } from './core/reference';
import { PineCompletionProvider } from './providers/completion';
import { PineDocumentSymbolProvider } from './providers/document-symbol';
import { PineHoverProvider } from './providers/hover';
import { PineSignatureHelpProvider } from './providers/signature-help';
import { forget } from './vscode/document-cache';
import { log, output } from './vscode/output';
import { getSettings } from './vscode/settings';

const SELECTOR: vscode.DocumentSelector = { language: 'pinescript' };
let providerDisposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(output());
  const libraries: LibraryLookup = noLibraries; // replaced in Task 12

  registerProviders(context, libraries);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('pinescript')) registerProviders(context, libraries);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => forget(d.uri)),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, new PineDocumentSymbolProvider()),
  );
  log('Pine Script extension activated');
}

export function registerProviders(context: vscode.ExtensionContext, libraries: LibraryLookup): void {
  for (const d of providerDisposables) d.dispose();
  providerDisposables = [];
  const settings = getSettings();
  const ref = loadReference();
  if (settings.completion) {
    providerDisposables.push(vscode.languages.registerCompletionItemProvider(SELECTOR, new PineCompletionProvider(ref, libraries), '.', '/', '@', '(', ','));
  }
  if (settings.hover) providerDisposables.push(vscode.languages.registerHoverProvider(SELECTOR, new PineHoverProvider(ref, libraries)));
  if (settings.signatureHelp) providerDisposables.push(vscode.languages.registerSignatureHelpProvider(SELECTOR, new PineSignatureHelpProvider(ref, libraries), '(', ','));
  context.subscriptions.push(...providerDisposables);
}

export function deactivate(): void {}
```

- [ ] **Step 10: Type-check, build, and try it**

Run: `npm run typecheck && npm run build:extension && npm run test:core`
Expected: clean. Then press F5 in VS Code, open `tests/core/fixtures/consumer.pine`, and check: typing `ta.` lists members with documentation; hovering `close` shows the type; typing `plot(` shows signature help; the Outline view lists `length`, `acc`, `src`, `fast`. Fix anything that misbehaves before committing.

- [ ] **Step 11: Commit**

```bash
npm run format
git add -A
git commit -m "Add completion, hover, signature help and outline providers"
```

---

### Task 9: Type inference and the "Add Type Annotations" command

**Files:**
- Create: `src/extension/core/type-inference.ts`, `src/extension/commands/add-type-annotations.ts`, `tests/core/type-inference.test.ts`
- Modify: `src/extension/extension.ts`, `package.json` (commands, menus)

**Interfaces:**
- Consumes: `ReferenceIndex` (Task 3), `DocumentModel`, `VariableSymbol`, `visibleVariables` (Task 5), `tokenize` (Task 4).
- Produces:
  ```ts
  interface InferenceScope { ref: ReferenceIndex; model: DocumentModel; line: number; compilerTypes?: ReadonlyMap<string, string> }
  function inferType(expr: string, scope: InferenceScope): string | null;   // base type or null
  interface AnnotationEdit { line: number; column: number; insert: string }  // insert "float " before the name
  function planTypeAnnotations(model: DocumentModel, ref: ReferenceIndex, lines: [number, number] | null, compilerTypes?: ReadonlyMap<string, string>): { edits: AnnotationEdit[]; skipped: string[] };
  ```

- [ ] **Step 1: Write the failing test `tests/core/type-inference.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import { loadReference } from '../../src/extension/core/reference';
import { inferType, planTypeAnnotations } from '../../src/extension/core/type-inference';

const ref = loadReference();
const scopeFor = (text: string, line = 99) => ({ ref, model: buildModel(text), line });

describe('inferType', () => {
  const s = scopeFor('');
  it.each([
    ['1', 'int'],
    ['1.5', 'float'],
    ['"x"', 'string'],
    ['true', 'bool'],
    ['#ff0000', 'color'],
    ['na', null],
    ['close', 'float'],
    ['bar_index', 'int'],
    ['color.red', 'color'],
    ['ta.sma(close, 14)', 'float'],
    ['input.int(14)', 'int'],
    ['input.string("a")', 'string'],
    ['input.source(close)', 'float'],
    ['label.new(bar_index, high)', 'label'],
    ['array.new<float>()', 'array<float>'],
    ['close > open', 'bool'],
    ['a and b', 'bool'],
    ['not x', 'bool'],
    ['1 + 2', 'int'],
    ['1 + 2.0', 'float'],
    ['"a" + str.tostring(1)', 'string'],
    ['close > open ? 1 : 0', 'int'],
    ['close > open ? 1 : 0.5', 'float'],
    ['close > open ? 1 : "x"', null],
    ['unknown_fn(1)', null],
  ])('%s → %s', (expr, expected) => {
    expect(inferType(expr, s)).toBe(expected);
  });

  it('uses declared types of earlier variables and user types', () => {
    const text = 'type Point\n    float x\nfloat a = 1\np = Point.new(1)\nb = a * 2\n';
    const s = scopeFor(text, 4);
    expect(inferType('a', s)).toBe('float');
    expect(inferType('Point.new(1)', s)).toBe('Point');
    expect(inferType('a + p.x', s)).toBe(null); // field access is not inferred
  });

  it('prefers compiler-provided types', () => {
    const s = { ...scopeFor('x = mystery()'), compilerTypes: new Map([['x', 'series string']]) };
    expect(inferType('mystery()', { ...s, line: 0 })).toBe(null);
    const plan = planTypeAnnotations(s.model, ref, null, s.compilerTypes);
    expect(plan.edits).toEqual([{ line: 0, column: 0, insert: 'string ' }]);
  });
});

describe('planTypeAnnotations', () => {
  it('annotates inferable declarations and reports the rest', () => {
    const text = 'length = input.int(14)\nvar acc = 0.0\nfloat done = 1\nsrc = close\nweird = foo(1)\n';
    const plan = planTypeAnnotations(buildModel(text), ref, null);
    expect(plan.edits).toEqual([
      { line: 0, column: 0, insert: 'int ' },
      { line: 1, column: 4, insert: 'float ' },
      { line: 3, column: 0, insert: 'float ' },
    ]);
    expect(plan.skipped).toEqual(['weird']);
  });

  it('respects a line range', () => {
    const text = 'a = 1\nb = 2\nc = 3\n';
    const plan = planTypeAnnotations(buildModel(text), ref, [1, 1]);
    expect(plan.edits.map((e) => e.line)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/type-inference.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/type-inference.ts`**

```ts
import { visibleVariables, type DocumentModel } from './document-model';
import { ReferenceIndex } from './reference';
import { tokenize, type Token } from './tokenizer';

export interface InferenceScope {
  ref: ReferenceIndex;
  model: DocumentModel;
  line: number;
  compilerTypes?: ReadonlyMap<string, string>;
}

export interface AnnotationEdit {
  line: number;
  column: number;
  insert: string;
}

const INPUT_TYPES: Record<string, string> = {
  'input.int': 'int',
  'input.float': 'float',
  'input.bool': 'bool',
  'input.string': 'string',
  'input.color': 'color',
  'input.source': 'float',
  'input.timeframe': 'string',
  'input.symbol': 'string',
  'input.session': 'string',
  'input.price': 'float',
  'input.time': 'int',
  'input.text_area': 'string',
  'input.enum': 'enum',
  input: 'float',
};
const COMPARISON = new Set(['==', '!=', '<', '<=', '>', '>=']);
const NUMERIC = new Set(['+', '-', '*', '/', '%']);

export function inferType(expr: string, scope: InferenceScope): string | null {
  const tokens = tokenize(expr)[0]?.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment') ?? [];
  if (!tokens.length) return null;
  const type = inferTokens(tokens, scope);
  return type === 'na' ? null : type;
}

function inferTokens(tokens: Token[], scope: InferenceScope): string | null {
  // Unwrap a single outer group: (expr)
  if (tokens[0]?.text === '(' && matchingClose(tokens, 0) === tokens.length - 1) return inferTokens(tokens.slice(1, -1), scope);

  // Ternary at depth 0: cond ? a : b
  const q = indexAtDepth(tokens, (t) => t.text === '?');
  if (q > 0) {
    const c = indexAtDepth(tokens.slice(q + 1), (t) => t.text === ':');
    if (c > 0) {
      const a = inferTokens(tokens.slice(q + 1, q + 1 + c), scope);
      const b = inferTokens(tokens.slice(q + 2 + c), scope);
      return unify(a, b);
    }
  }
  // Logical operators and `not` yield bool.
  if (indexAtDepth(tokens, (t) => t.kind === 'ident' && (t.text === 'and' || t.text === 'or')) >= 0) return 'bool';
  if (tokens[0]?.kind === 'ident' && tokens[0].text === 'not') return 'bool';
  if (indexAtDepth(tokens, (t) => t.kind === 'op' && COMPARISON.has(t.text)) > 0) return 'bool';

  // Binary arithmetic at depth 0, lowest precedence first (+,- before *,/,%).
  for (const ops of [['+', '-'], ['*', '/', '%']]) {
    const i = lastIndexAtDepth(tokens, (t) => t.kind === 'op' && ops.includes(t.text));
    if (i > 0) {
      const left = inferTokens(tokens.slice(0, i), scope);
      const right = inferTokens(tokens.slice(i + 1), scope);
      if (tokens[i]!.text === '+' && (left === 'string' || right === 'string')) return 'string';
      return numeric(left, right);
    }
  }
  // Unary minus.
  if (tokens[0]?.kind === 'op' && tokens[0].text === '-' && tokens.length > 1) return inferTokens(tokens.slice(1), scope);

  const first = tokens[0]!;
  if (first.kind === 'number') return first.text.startsWith('#') ? 'color' : /[.eE]/.test(first.text) ? 'float' : 'int';
  if (first.kind === 'string') return 'string';
  if (first.kind !== 'ident') return null;

  // History reference x[1] keeps the type of x.
  const indexed = tokens.length > 1 && tokens[1]!.text === '[' && matchingClose(tokens, 1) === tokens.length - 1;
  if (indexed) return inferTokens(tokens.slice(0, 1), scope);

  const name = first.text;
  const isCall = tokens[1]?.text === '(' || tokens[1]?.text === '<';
  if (tokens.length === 1 || !isCall) {
    if (tokens.length !== 1) return null; // something after an identifier we do not model
    if (name === 'true' || name === 'false') return 'bool';
    if (name === 'na') return 'na';
    const variable = visibleVariables(scope.model, scope.line).filter((v) => v.line < scope.line || scope.line === 99).find((v) => v.name === name);
    if (variable?.declaredType) return variable.declaredType;
    const entry = scope.ref.get(name, 'variable') ?? scope.ref.get(name, 'constant');
    if (entry?.type) return ReferenceIndex.baseType(entry.type);
    const en = scope.model.enums.find((e) => name.startsWith(`${e.name}.`));
    if (en) return en.name;
    return null;
  }

  // Calls.
  if (name in INPUT_TYPES) return INPUT_TYPES[name]!;
  if (name.endsWith('.new')) {
    const owner = name.slice(0, -4);
    if (scope.model.types.some((t) => t.name === owner)) return owner;
    if (tokens[1]?.text === '<') {
      const close = tokens.findIndex((t) => t.text === '>');
      if (close > 1) return `${owner}<${tokens.slice(2, close).map((t) => t.text).join('')}>`;
    }
  }
  const userFn = scope.model.functions.find((f) => f.name === name);
  if (userFn) return null; // user function return types need the compiler
  const entry = scope.ref.get(name, 'function');
  if (entry) {
    const argCount = countArgs(tokens);
    const overload = entry.overloads.find((o) => o.params.length >= argCount) ?? entry.overloads[0];
    const ret = overload?.returns?.type;
    if (!ret || ret === 'void') return null;
    const base = ReferenceIndex.baseType(ret);
    return base.includes(' ') || base === 'plot' || base === 'hline' ? null : base;
  }
  return null;
}

function countArgs(tokens: Token[]): number {
  const open = tokens.findIndex((t) => t.text === '(');
  if (open < 0) return 0;
  const close = matchingClose(tokens, open);
  const inner = tokens.slice(open + 1, close);
  if (!inner.length) return 0;
  let depth = 0;
  let n = 1;
  for (const t of inner) {
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (t.kind === 'comma' && depth === 0) n++;
  }
  return n;
}

function matchingClose(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i]!.kind === 'open') depth++;
    if (tokens[i]!.kind === 'close') depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function indexAtDepth(tokens: Token[], pred: (t: Token) => boolean): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (depth === 0 && pred(t)) return i;
  }
  return -1;
}

function lastIndexAtDepth(tokens: Token[], pred: (t: Token) => boolean): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (depth === 0 && pred(t) && i > 0 && tokens[i - 1]!.kind !== 'op') found = i;
  }
  return found;
}

function unify(a: string | null, b: string | null): string | null {
  if (a === 'na') return b === 'na' ? null : b;
  if (b === 'na') return a;
  if (a === b) return a;
  if ((a === 'int' && b === 'float') || (a === 'float' && b === 'int')) return 'float';
  return null;
}

function numeric(a: string | null, b: string | null): string | null {
  if (a === 'na') a = null;
  if (b === 'na') b = null;
  if (a === 'float' || b === 'float') return a && b ? 'float' : null;
  if (a === 'int' && b === 'int') return 'int';
  return null;
}

export function planTypeAnnotations(
  model: DocumentModel,
  ref: ReferenceIndex,
  lines: [number, number] | null,
  compilerTypes?: ReadonlyMap<string, string>,
): { edits: AnnotationEdit[]; skipped: string[] } {
  const edits: AnnotationEdit[] = [];
  const skipped: string[] = [];
  for (const v of model.variables) {
    if (lines && (v.line < lines[0] || v.line > lines[1])) continue;
    if (v.declaredType || v.initializer === null) continue;
    let type: string | null = null;
    const compiled = compilerTypes?.get(v.name);
    if (compiled) type = ReferenceIndex.baseType(compiled);
    else type = inferType(v.initializer, { ref, model, line: v.line, compilerTypes });
    if (!type || type === 'enum') {
      skipped.push(v.name);
      continue;
    }
    edits.push({ line: v.line, column: v.column, insert: `${type} ` });
  }
  return { edits, skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/type-inference.test.ts`
Expected: PASS. Cases that depend on reference data (`input.source` returning `series float`, `label.new` returning `series label`) are covered through `baseType`; if a case fails because the scraped return type differs, fix the expectation only after checking `reference.json`.

- [ ] **Step 5: Create `src/extension/commands/add-type-annotations.ts`**

```ts
import * as vscode from 'vscode';
import { loadReference } from '../core/reference';
import { planTypeAnnotations } from '../core/type-inference';
import { analyze } from '../vscode/document-cache';

export type CompilerTypesLookup = (uri: vscode.Uri) => ReadonlyMap<string, string> | undefined;

export function registerAddTypeAnnotations(context: vscode.ExtensionContext, compilerTypes: CompilerTypesLookup): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.addTypeAnnotations', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pinescript') return;
      const { model } = analyze(editor.document);
      const range: [number, number] | null = editor.selection.isEmpty ? null : [editor.selection.start.line, editor.selection.end.line];
      const { edits, skipped } = planTypeAnnotations(model, loadReference(), range, compilerTypes(editor.document.uri));
      if (!edits.length) {
        void vscode.window.showInformationMessage(skipped.length ? `No types could be inferred for: ${skipped.join(', ')}` : 'Every declaration already has a type.');
        return;
      }
      await editor.edit((b) => {
        for (const e of edits) b.insert(new vscode.Position(e.line, e.column), e.insert);
      });
      const tail = skipped.length ? ` Skipped ${skipped.length}: ${skipped.join(', ')}.` : '';
      void vscode.window.showInformationMessage(`Added ${edits.length} type annotation${edits.length === 1 ? '' : 's'}.${tail}`);
    }),
  );
}
```

- [ ] **Step 6: Contribute the command and menu in `package.json`**

Inside `contributes` add (the other commands are appended in later tasks):

```json
"commands": [
  { "command": "pinescript.addTypeAnnotations", "title": "Pine Script: Add Type Annotations", "enablement": "editorLangId == pinescript" }
],
"menus": {
  "editor/context": [
    { "command": "pinescript.addTypeAnnotations", "when": "editorLangId == pinescript", "group": "1_pinescript@2" }
  ]
}
```

- [ ] **Step 7: Register in `extension.ts`**

Add `import { registerAddTypeAnnotations } from './commands/add-type-annotations';` and inside `activate`, after `registerProviders`:

```ts
registerAddTypeAnnotations(context, () => undefined); // compiler types arrive in Task 13
```

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run build:extension && npm run test:core`. In the Extension Development Host, run the command on `consumer.pine`: `length`, `src`, `fast` gain types; `dc`/`up` are left alone.

```bash
npm run format
git add -A
git commit -m "Infer declaration types and add the Add Type Annotations command"
```

---

### Task 10: Docstring generation, command and code action

**Files:**
- Create: `src/extension/core/docstring.ts`, `src/extension/commands/generate-docstring.ts`, `src/extension/providers/code-action.ts`, `tests/core/docstring.test.ts`
- Modify: `src/extension/extension.ts`, `package.json`

**Interfaces:**
- Consumes: `DeclSymbol`, `declarationAt`, `annotationsAbove`, `LineRange` (Task 5).
- Produces:
  ```ts
  function annotationBlockRange(lines: string[], declLine: number): LineRange | null; // contiguous // block directly above, or null
  function docstringLines(symbol: DeclSymbol, existing: string[], indent: string): string[]; // full replacement block, merged
  function needsDocstring(symbol: DeclSymbol): boolean;
  ```

- [ ] **Step 1: Write the failing test `tests/core/docstring.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import { annotationBlockRange, docstringLines, needsDocstring } from '../../src/extension/core/docstring';

describe('docstring', () => {
  it('generates a function block', () => {
    const m = buildModel('f(float a, b = 1) =>\n    a + b\n');
    expect(docstringLines(m.functions[0]!, [], '')).toEqual(['//@function f', '//@param a ', '//@param b ', '//@returns ']);
  });

  it('omits @returns for void bodies', () => {
    const m = buildModel('show(x) =>\n    plot(x)\n');
    expect(docstringLines(m.functions[0]!, [], '')).toEqual(['//@function show', '//@param x ']);
  });

  it('merges with an existing block, keeping text and order', () => {
    const src = '//@param b Second.\n//@function Adds.\nf(a, b) =>\n    a + b\n';
    const lines = src.split('\n');
    const m = buildModel(src);
    const range = annotationBlockRange(lines, 2);
    expect(range).toEqual({ start: 0, end: 1 });
    expect(docstringLines(m.functions[0]!, lines.slice(0, 2), '')).toEqual(['//@function Adds.', '//@param a ', '//@param b Second.', '//@returns ']);
  });

  it('generates type and enum blocks with indentation', () => {
    const m = buildModel('export type P\n    float x\n    int y = 0\nenum S\n    a = "A"\n    b\n');
    expect(docstringLines(m.types[0]!, [], '')).toEqual(['//@type P', '//@field x ', '//@field y ']);
    expect(docstringLines(m.enums[0]!, [], '  ')).toEqual(['  //@enum S', '  //@field a ', '  //@field b ']);
  });

  it('reports whether a symbol still needs docs', () => {
    const documented = buildModel('//@function Adds.\n//@param a A.\n//@returns Sum.\nf(a) =>\n    a\n');
    expect(needsDocstring(documented.functions[0]!)).toBe(false);
    const partial = buildModel('//@function Adds.\nf(a) =>\n    a\n');
    expect(needsDocstring(partial.functions[0]!)).toBe(true);
  });

  it('returns null when there is no block above', () => {
    expect(annotationBlockRange(['x = 1', 'f(a) =>'], 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/docstring.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/docstring.ts`**

```ts
import type { DeclSymbol, FunctionSymbol, LineRange } from './document-model';

const VOID_CALLS = /^(?:plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor|fill|hline|alert|alertcondition|log\.\w+|runtime\.error|strategy\.(?:entry|exit|close|close_all|order|cancel|cancel_all|risk\.\w+)|label\.set_\w+|line\.set_\w+|box\.set_\w+|table\.(?:cell|set_\w+|clear|merge_cells)|array\.(?:push|set|unshift|clear|insert|fill|sort|reverse)|matrix\.(?:set|fill|add_row|add_col|remove_row|remove_col)|map\.(?:put|remove|clear))\s*\(/;

export function annotationBlockRange(lines: string[], declLine: number): LineRange | null {
  let start = declLine;
  while (start > 0 && /^\s*\/\//.test(lines[start - 1]!)) start--;
  if (start === declLine) return null;
  // Only count the block if it contains at least one annotation; plain comments are left alone.
  const block = lines.slice(start, declLine);
  if (!block.some((l) => /^\s*\/\/\s*@\w+/.test(l))) return null;
  return { start, end: declLine - 1 };
}

function tagOf(line: string): { tag: string; name: string | null } | null {
  const m = line.match(/^\s*\/\/\s*@(\w+)\s*(\w+)?/);
  if (!m) return null;
  const named = m[1] === 'param' || m[1] === 'field';
  return { tag: m[1]!, name: named ? (m[2] ?? null) : null };
}

function bodyReturnsValue(fn: FunctionSymbol, lines?: string[]): boolean {
  void lines;
  return !fn.lastLine || !VOID_CALLS.test(fn.lastLine.trim());
}

export function docstringLines(symbol: DeclSymbol, existing: string[], indent: string): string[] {
  const wanted: { tag: string; name: string | null }[] = [];
  if (symbol.kind === 'function') {
    wanted.push({ tag: 'function', name: null });
    for (const p of symbol.params) wanted.push({ tag: 'param', name: p.name });
    if (bodyReturnsValue(symbol)) wanted.push({ tag: 'returns', name: null });
  } else if (symbol.kind === 'type') {
    wanted.push({ tag: 'type', name: null });
    for (const f of symbol.fields) wanted.push({ tag: 'field', name: f.name });
  } else {
    wanted.push({ tag: 'enum', name: null });
    for (const m of symbol.members) wanted.push({ tag: 'field', name: m.name });
  }

  const remaining = existing.map((l) => ({ line: l, key: tagOf(l) }));
  const out: string[] = [];
  for (const w of wanted) {
    const idx = remaining.findIndex((r) => r.key && r.key.tag === w.tag && r.key.name === w.name);
    if (idx >= 0) {
      out.push(indent + remaining[idx]!.line.trim());
      remaining.splice(idx, 1);
    } else {
      const label = w.tag === 'function' || w.tag === 'type' || w.tag === 'enum' ? symbol.name : w.name!;
      out.push(`${indent}//@${w.tag} ${label}${w.tag === 'returns' ? '' : ' '}`.replace(/\s+$/, ' '));
    }
  }
  // Keep anything else the author wrote (descriptions, unknown tags, continuation lines) after the generated block.
  for (const r of remaining) out.push(indent + r.line.trim());
  return out.map((l) => (l.endsWith('//@returns ') ? l.trimEnd() + ' ' : l));
}

export function needsDocstring(symbol: DeclSymbol): boolean {
  if (symbol.kind === 'function') {
    if (!symbol.docs.function && !symbol.docs.description) return true;
    if (symbol.params.some((p) => !symbol.docs.params[p.name])) return true;
    return bodyReturnsValue(symbol) && !symbol.docs.returns;
  }
  if (symbol.kind === 'type') return !symbol.docs.type || symbol.fields.some((f) => !symbol.docs.fields[f.name]);
  return !symbol.docs.enum || symbol.members.some((m) => !symbol.docs.fields[m.name]);
}
```

`bodyReturnsValue` needs the last non-blank body line. Add `lastLine: string | null` to `FunctionSymbol` in `document-model.ts`: when constructing the function symbol set `lastLine` to the trimmed text of the last non-blank line in `range` after the header (or `null` when the body is empty). Update the Task 5 interface block mentally: `FunctionSymbol` gains `lastLine`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/docstring.test.ts tests/core/document-model.test.ts`
Expected: PASS. The generated `//@returns ` line keeps one trailing space so the cursor lands after it; the expected arrays above include that space.

- [ ] **Step 5: Create `src/extension/commands/generate-docstring.ts`**

```ts
import * as vscode from 'vscode';
import { annotationBlockRange, docstringLines } from '../core/docstring';
import { declarationAt, type DeclSymbol } from '../core/document-model';
import { analyze } from '../vscode/document-cache';

export function docstringEdit(document: vscode.TextDocument, symbol: DeclSymbol): vscode.TextEdit {
  const { lines } = analyze(document);
  const indent = lines[symbol.line]!.match(/^\s*/)![0];
  const block = annotationBlockRange(lines, symbol.line);
  const existing = block ? lines.slice(block.start, block.end + 1) : [];
  const text = docstringLines(symbol, existing, indent).join('\n') + '\n';
  return block
    ? vscode.TextEdit.replace(new vscode.Range(block.start, 0, block.end + 1, 0), text)
    : vscode.TextEdit.insert(new vscode.Position(symbol.line, 0), text);
}

export function registerGenerateDocstring(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.generateDocstring', async (line?: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pinescript') return;
      const { model } = analyze(editor.document);
      const from = line ?? editor.selection.start.line;
      const to = line ?? editor.selection.end.line;
      const targets: DeclSymbol[] = [];
      for (let l = from; l <= to; l++) {
        const d = declarationAt(model, l);
        if (d) targets.push(d);
      }
      if (!targets.length) {
        // Cursor inside a body: use the enclosing declaration.
        const enclosing = [...model.functions, ...model.types, ...model.enums].find((s) => s.range.start <= from && from <= s.range.end);
        if (enclosing) targets.push(enclosing);
      }
      if (!targets.length) {
        void vscode.window.showInformationMessage('Place the cursor on a function, method, type or enum declaration.');
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const t of targets.sort((a, b) => b.line - a.line)) edit.set(editor.document.uri, [docstringEdit(editor.document, t)]);
      await vscode.workspace.applyEdit(edit);
    }),
  );
}
```

Note: `edit.set` replaces previous edits for the same uri; collect all `TextEdit`s into one array and call `edit.set(uri, edits)` once. Write it that way.

- [ ] **Step 6: Create `src/extension/providers/code-action.ts`**

```ts
import * as vscode from 'vscode';
import { needsDocstring } from '../core/docstring';
import { declarationAt } from '../core/document-model';
import { analyze } from '../vscode/document-cache';

export class PineCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] };

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const { model } = analyze(document);
    const decl = declarationAt(model, range.start.line);
    if (!decl || !needsDocstring(decl)) return [];
    const action = new vscode.CodeAction(`Generate docstring for ${decl.name}`, vscode.CodeActionKind.Refactor);
    action.command = { command: 'pinescript.generateDocstring', title: 'Generate docstring', arguments: [decl.line] };
    return [action];
  }
}
```

- [ ] **Step 7: Contribute and register**

`package.json` `contributes.commands` add:

```json
{ "command": "pinescript.generateDocstring", "title": "Pine Script: Generate Docstring", "enablement": "editorLangId == pinescript" }
```

`contributes.menus["editor/context"]` add:

```json
{ "command": "pinescript.generateDocstring", "when": "editorLangId == pinescript", "group": "1_pinescript@1" }
```

`extension.ts`: import `registerGenerateDocstring` and `PineCodeActionProvider`; in `activate` add:

```ts
registerGenerateDocstring(context);
context.subscriptions.push(vscode.languages.registerCodeActionsProvider(SELECTOR, new PineCodeActionProvider(), PineCodeActionProvider.metadata));
```

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run build:extension && npm run test:core`. In the Extension Development Host, put the cursor on `internal(x) =>` in `library.pine`, use the lightbulb: a block with `//@function internal`, `//@param x `, `//@returns ` appears above.

```bash
npm run format
git add -A
git commit -m "Generate and merge annotation docstrings from a command and a code action"
```

---

### Task 11: Templates, new-file commands, and Open Reference

**Files:**
- Create: `src/extension/core/templates.ts`, `src/extension/commands/new-file.ts`, `src/extension/commands/open-reference.ts`, `tests/core/templates.test.ts`
- Modify: `src/extension/extension.ts`, `package.json`

**Interfaces:**
- Produces:
  ```ts
  type TemplateKind = 'indicator' | 'strategy' | 'library';
  function renderTemplate(kind: TemplateKind, opts: { title: string; date: string }): string;
  ```

- [ ] **Step 1: Write the failing test `tests/core/templates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/extension/core/templates';

describe('renderTemplate', () => {
  it('renders an indicator with the title and date', () => {
    const t = renderTemplate('indicator', { title: 'My Indicator', date: '2026-09-07' });
    expect(t.startsWith('//@version=6\n')).toBe(true);
    expect(t).toContain('indicator("My Indicator"');
    expect(t).toContain('2026-09-07');
    expect(t).toContain('plot(');
  });

  it('renders a strategy with entries and exits', () => {
    const t = renderTemplate('strategy', { title: 'S', date: '2026-09-07' });
    expect(t).toContain('strategy("S"');
    expect(t).toContain('strategy.entry(');
    expect(t).toContain('strategy.close(');
  });

  it('renders a library with an exported function and docs', () => {
    const t = renderTemplate('library', { title: 'Lib', date: '2026-09-07' });
    expect(t).toContain('library("Lib")');
    expect(t).toContain('//@function');
    expect(t).toContain('export ');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/templates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/extension/core/templates.ts`**

```ts
export type TemplateKind = 'indicator' | 'strategy' | 'library';

export function renderTemplate(kind: TemplateKind, opts: { title: string; date: string }): string {
  const title = opts.title.replace(/"/g, '\\"');
  const header = `//@version=6\n// ${title}\n// Created ${opts.date}\n\n`;
  switch (kind) {
    case 'indicator':
      return (
        header +
        `indicator("${title}", overlay = true)

// Inputs
lengthInput = input.int(20, "Length", minval = 1)
sourceInput = input.source(close, "Source")

// Calculations
float ma = ta.sma(sourceInput, lengthInput)

// Plots
plot(ma, "MA", color = color.blue, linewidth = 2)
`
      );
    case 'strategy':
      return (
        header +
        `strategy("${title}", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 10)

// Inputs
fastInput = input.int(9, "Fast length", minval = 1)
slowInput = input.int(21, "Slow length", minval = 1)

// Calculations
float fast = ta.ema(close, fastInput)
float slow = ta.ema(close, slowInput)
bool longCondition = ta.crossover(fast, slow)
bool exitCondition = ta.crossunder(fast, slow)

// Orders
if longCondition
    strategy.entry("Long", strategy.long)
if exitCondition
    strategy.close("Long")

// Plots
plot(fast, "Fast", color = color.teal)
plot(slow, "Slow", color = color.orange)
`
      );
    case 'library':
      return (
        header +
        `//@description ${title}: describe what this library offers.
library("${title}")

//@function Returns the arithmetic mean of two values.
//@param a First value.
//@param b Second value.
//@returns The mean of \`a\` and \`b\`.
export mean(float a, float b) =>
    (a + b) / 2
`
      );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/templates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/extension/commands/new-file.ts`**

```ts
import * as vscode from 'vscode';
import { renderTemplate, type TemplateKind } from '../core/templates';

const TITLES: Record<TemplateKind, string> = { indicator: 'My Indicator', strategy: 'My Strategy', library: 'MyLibrary' };

export function registerNewFileCommands(context: vscode.ExtensionContext): void {
  for (const kind of ['indicator', 'strategy', 'library'] as const) {
    const id = `pinescript.new${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        const title = await vscode.window.showInputBox({ prompt: `${kind[0]!.toUpperCase()}${kind.slice(1)} title`, value: TITLES[kind] });
        if (title === undefined) return;
        const content = renderTemplate(kind, { title: title || TITLES[kind], date: new Date().toISOString().slice(0, 10) });
        const doc = await vscode.workspace.openTextDocument({ language: 'pinescript', content });
        await vscode.window.showTextDocument(doc);
      }),
    );
  }
}
```

- [ ] **Step 6: Create `src/extension/commands/open-reference.ts`**

```ts
import * as vscode from 'vscode';
import { REFERENCE_URL, loadReference } from '../core/reference';
import { wordAt } from '../core/tokenizer';

export function registerOpenReference(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.openReference', async () => {
      const editor = vscode.window.activeTextEditor;
      let url = REFERENCE_URL;
      if (editor && editor.document.languageId === 'pinescript') {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const word = wordAt(line, editor.selection.active.character);
        const ref = loadReference();
        const candidates = word ? [word.text, ...word.text.split('.').map((_, i, a) => a.slice(0, a.length - i - 1).join('.')).filter(Boolean)] : [];
        for (const c of candidates) {
          const entry = ref.get(c);
          if (entry) {
            url = ref.url(entry);
            break;
          }
        }
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );
}
```

- [ ] **Step 7: Contribute and register**

`package.json` `contributes.commands` add:

```json
{ "command": "pinescript.newIndicator", "title": "Pine Script: New Indicator" },
{ "command": "pinescript.newStrategy", "title": "Pine Script: New Strategy" },
{ "command": "pinescript.newLibrary", "title": "Pine Script: New Library" },
{ "command": "pinescript.openReference", "title": "Pine Script: Open Reference" }
```

`contributes.menus["editor/context"]` add:

```json
{ "command": "pinescript.openReference", "when": "editorLangId == pinescript", "group": "1_pinescript@3" }
```

`extension.ts`: import and call `registerNewFileCommands(context)` and `registerOpenReference(context)` in `activate`.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run build:extension && npm run test:core`. In the Extension Development Host: command palette → "Pine Script: New Strategy" opens an untitled Pine document; right-click on `ta.sma` → Open Reference opens the anchor in the browser.

```bash
npm run format
git add -A
git commit -m "Add file templates, new-file commands and Open Reference"
```

---

### Task 12: TradingView client, library parsing and the library index

**Files:**
- Create: `src/extension/core/pine-facade.ts`, `src/extension/providers/library-index.ts`, `tests/core/pine-facade.test.ts`, `tests/core/libraries.test.ts`
- Modify: `src/extension/core/libraries.ts`, `src/extension/extension.ts`

**Interfaces:**
- Consumes: `buildModel` (Task 5), `LibraryInfo`, `LibraryLookup` (Task 8), `getSettings` (Task 8), `log` (Task 1).
- Produces:
  ```ts
  // pine-facade.ts
  interface RemoteLibrary { libId: string; user: string; lib: string; version: string; scriptIdPart: string; docs: string }
  interface RawIssue { code?: string; message: string; ctx?: Record<string, string>; start?: { line: number; column: number }; end?: { line: number; column: number } }
  interface CompileResult {
    success: boolean; reason?: string;
    errors: RawIssue[]; warnings: RawIssue[];
    variables: { name: string; type: string }[];
    functions: { name: string; syntax: string; desc?: string; args: { name: string; type: string; info?: string }[] }[];
  }
  interface FacadeOptions { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; log?: (m: string) => void }
  class PineFacade {
    constructor(options?: FacadeOptions);
    libList(prefix: string): Promise<RemoteLibrary[]>;
    getScript(scriptIdPart: string, version: string): Promise<string | null>;
    translateLight(source: string): Promise<CompileResult | null>;
    readonly disabledUntil: number;   // 0 when healthy
  }
  // libraries.ts
  function parseLibrary(text: string, id: string, source: 'local' | 'remote', meta?: { owner?: string; version?: string; description?: string }): LibraryInfo | null;
  // library-index.ts
  class LibraryIndex implements LibraryLookup { constructor(facade: PineFacade, settings: () => Settings); start(context): void; }
  ```

- [ ] **Step 1: Write the failing tests**

`tests/core/pine-facade.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PineFacade } from '../../src/extension/core/pine-facade';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PineFacade', () => {
  it('lists libraries and caches by prefix', async () => {
    const fetch = vi.fn(async () => json([{ libId: 'TradingView/ta/14', user: 'TradingView', lib: 'ta', version: '14.0', scriptIdPart: 'PUB;1', docs: '' }]));
    const f = new PineFacade({ fetch: fetch as unknown as typeof globalThis.fetch });
    const a = await f.libList('TradingView/t');
    const b = await f.libList('TradingView/t');
    expect(a[0]?.libId).toBe('TradingView/ta/14');
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toContain('lib_list/?lib_id_prefix=TradingView%2Ft&ignore_case=true');
  });

  it('returns library source', async () => {
    const fetch = vi.fn(async () => json({ source: '//@version=6\nlibrary("ta")\n' }));
    const f = new PineFacade({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await f.getScript('PUB;abc', '14.0')).toContain('library("ta")');
    expect(String(fetch.mock.calls[0]![0])).toContain('/get/PUB%3Babc/14.0?no_4xx=true');
  });

  it('posts source to translate_light and normalizes the result', async () => {
    const fetch = vi.fn(async () => json({ success: true, result: { errors2: [{ code: 'CE1', message: 'Undeclared identifier "{identifier}"', ctx: { identifier: 'x' }, start: { line: 3, column: 6 }, end: { line: 3, column: 7 } }], variables2: [{ docs: [{ name: 'a', type: 'series float' }] }], functions2: [] } }));
    const f = new PineFacade({ fetch: fetch as unknown as typeof globalThis.fetch });
    const r = await f.translateLight('//@version=6\nindicator("x")\nplot(x)');
    expect(r?.errors[0]?.code).toBe('CE1');
    expect(r?.variables).toEqual([{ name: 'a', type: 'series float' }]);
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('source=');
  });

  it('backs off after three failures', async () => {
    let now = 1_000_000;
    const fetch = vi.fn(async () => json({}, 500));
    const log = vi.fn();
    const f = new PineFacade({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => now, log });
    for (let i = 0; i < 3; i++) expect(await f.libList(`p${i}`)).toEqual([]);
    expect(f.disabledUntil).toBeGreaterThan(now);
    await f.libList('p9');
    expect(fetch).toHaveBeenCalledTimes(3);
    now += 5 * 60 * 1000 + 1;
    await f.libList('p9');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalled();
  });
});
```

`tests/core/libraries.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLibrary } from '../../src/extension/core/libraries';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseLibrary', () => {
  it('keeps only exports and reads the description', () => {
    const lib = parseLibrary(fixture('library.pine'), 'yankikucuk/MaHelpers/2', 'local', { owner: 'yankikucuk', version: '2' })!;
    expect(lib.title).toBe('MaHelpers');
    expect(lib.description).toBe('Helpers for moving averages.');
    expect(lib.functions.map((f) => f.name)).toEqual(['weighted']);
    expect(lib.types.map((t) => t.name)).toEqual(['Level']);
    expect(lib.enums.map((e) => e.name)).toEqual(['Side']);
  });

  it('returns null for non-libraries', () => {
    expect(parseLibrary(fixture('consumer.pine'), 'x', 'local')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/pine-facade.test.ts tests/core/libraries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/extension/core/pine-facade.ts`**

```ts
export interface RemoteLibrary {
  libId: string;
  user: string;
  lib: string;
  version: string;
  scriptIdPart: string;
  docs: string;
}

export interface RawIssue {
  code?: string;
  message: string;
  ctx?: Record<string, string>;
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}

export interface CompileResult {
  success: boolean;
  reason?: string;
  errors: RawIssue[];
  warnings: RawIssue[];
  variables: { name: string; type: string }[];
  functions: { name: string; syntax: string; desc?: string; args: { name: string; type: string; info?: string }[] }[];
}

export interface FacadeOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  log?: (message: string) => void;
}

const BASE = 'https://pine-facade.tradingview.com/pine-facade/';
const LIB_TTL = 10 * 60 * 1000;
const BACKOFF = 5 * 60 * 1000;
const FAILURES_BEFORE_BACKOFF = 3;
const COMPILE_CACHE_SIZE = 100;

export class PineFacade {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly log: (m: string) => void;
  private failures = 0;
  disabledUntil = 0;
  private readonly libCache = new Map<string, { at: number; value: RemoteLibrary[] }>();
  private readonly scriptCache = new Map<string, string | null>();
  private readonly compileCache = new Map<string, CompileResult | null>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: FacadeOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.log = options.log ?? (() => {});
  }

  async libList(prefix: string): Promise<RemoteLibrary[]> {
    const hit = this.libCache.get(prefix);
    if (hit && this.now() - hit.at < LIB_TTL) return hit.value;
    const data = await this.request<unknown>('GET', `lib_list/?lib_id_prefix=${encodeURIComponent(prefix)}&ignore_case=true`);
    const value = Array.isArray(data) ? (data as RemoteLibrary[]).filter((l) => typeof l.libId === 'string') : [];
    this.libCache.set(prefix, { at: this.now(), value });
    return value;
  }

  async getScript(scriptIdPart: string, version: string): Promise<string | null> {
    const key = `${scriptIdPart}@${version}`;
    if (this.scriptCache.has(key)) return this.scriptCache.get(key)!;
    const data = await this.request<{ source?: string }>('GET', `get/${encodeURIComponent(scriptIdPart)}/${encodeURIComponent(version)}?no_4xx=true`);
    const source = typeof data?.source === 'string' ? data.source : null;
    this.scriptCache.set(key, source);
    return source;
  }

  async translateLight(source: string): Promise<CompileResult | null> {
    const key = hash(source);
    if (this.compileCache.has(key)) return this.compileCache.get(key)!;
    const body = new URLSearchParams({ source });
    const data = await this.request<{ success?: boolean; reason?: string; result?: Record<string, unknown> }>(
      'POST',
      'translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
      body,
    );
    const result = data ? normalize(data) : null;
    this.compileCache.set(key, result);
    if (this.compileCache.size > COMPILE_CACHE_SIZE) this.compileCache.delete(this.compileCache.keys().next().value!);
    return result;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<T | null> {
    if (this.now() < this.disabledUntil) return null;
    const key = `${method} ${path} ${body?.toString() ?? ''}`;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T | null>;
    const p = this.doRequest<T>(method, path, body).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRequest<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(BASE + path, {
        method,
        headers: { Accept: 'application/json', Referer: 'https://www.tradingview.com/' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.failures = 0;
      return (await res.json()) as T;
    } catch (err) {
      this.failures++;
      this.log(`TradingView request failed (${method} ${path.split('?')[0]}): ${err instanceof Error ? err.message : String(err)}`);
      if (this.failures >= FAILURES_BEFORE_BACKOFF) {
        this.disabledUntil = this.now() + BACKOFF;
        this.failures = 0;
        this.log('Remote features paused for five minutes after repeated failures.');
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalize(data: { success?: boolean; reason?: string; result?: Record<string, unknown> }): CompileResult {
  const r = data.result ?? {};
  const docsOf = (key: string): unknown[] => {
    const groups = r[key];
    return Array.isArray(groups) ? groups.flatMap((g) => (Array.isArray((g as { docs?: unknown[] }).docs) ? (g as { docs: unknown[] }).docs : [])) : [];
  };
  return {
    success: data.success !== false,
    reason: data.reason,
    errors: Array.isArray(r.errors2) ? (r.errors2 as RawIssue[]) : [],
    warnings: Array.isArray(r.warnings2) ? (r.warnings2 as RawIssue[]) : [],
    variables: docsOf('variables2') as CompileResult['variables'],
    functions: docsOf('functions2') as CompileResult['functions'],
  };
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16) + ':' + text.length;
}
```

- [ ] **Step 4: Add `parseLibrary` to `src/extension/core/libraries.ts`**

Append:

```ts
import { buildModel } from './document-model';

export function parseLibrary(
  text: string,
  id: string,
  source: 'local' | 'remote',
  meta: { owner?: string; version?: string; description?: string } = {},
): LibraryInfo | null {
  const model = buildModel(text);
  if (model.scriptKind !== 'library') return null;
  const descriptionLine = text.split(/\r?\n/).find((l) => /^\/\/\s*@description\b/.test(l));
  return {
    id,
    title: model.libraryTitle ?? id,
    owner: meta.owner ?? null,
    version: meta.version ?? null,
    description: meta.description || (descriptionLine ? descriptionLine.replace(/^\/\/\s*@description\s*/, '').trim() : null),
    functions: model.functions.filter((f) => f.isExport),
    types: model.types.filter((t) => t.isExport),
    enums: model.enums.filter((e) => e.isExport),
    source,
  };
}
```

(Move the `import` to the top of the file with the existing type import.)

- [ ] **Step 5: Create `src/extension/providers/library-index.ts`**

```ts
import * as vscode from 'vscode';
import type { ImportDecl } from '../core/document-model';
import { parseLibrary, type LibraryInfo, type LibraryLookup } from '../core/libraries';
import type { PineFacade } from '../core/pine-facade';
import type { Settings } from '../vscode/settings';

export class LibraryIndex implements LibraryLookup {
  private readonly localByUri = new Map<string, LibraryInfo>();
  private readonly remote = new Map<string, Promise<LibraryInfo | null>>();
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly facade: PineFacade,
    private readonly settings: () => Settings,
  ) {}

  start(context: vscode.ExtensionContext): void {
    void this.scan();
    this.watch(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pinescript.libraries.local.include')) {
          this.localByUri.clear();
          void this.scan();
          this.watch(context);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d.languageId === 'pinescript') this.index(d.uri, d.getText());
      }),
    );
  }

  local(): LibraryInfo[] {
    return [...this.localByUri.values()];
  }

  async search(prefix: string): Promise<LibraryInfo[]> {
    if (!this.settings().librariesRemote || prefix.length < 2) return [];
    const list = await this.facade.libList(prefix);
    return list.map((l) => ({
      id: l.libId,
      title: l.lib,
      owner: l.user,
      version: l.libId.split('/')[2] ?? l.version,
      description: l.docs || null,
      functions: [],
      types: [],
      enums: [],
      source: 'remote' as const,
    }));
  }

  forImport(imp: ImportDecl): Promise<LibraryInfo | null> {
    const id = `${imp.owner}/${imp.name}/${imp.version}`;
    const local = this.local().find((l) => l.title === imp.name || l.id === id);
    if (local) return Promise.resolve(local);
    if (!this.settings().librariesRemote) return Promise.resolve(null);
    if (!this.remote.has(id)) this.remote.set(id, this.fetchRemote(imp, id));
    return this.remote.get(id)!;
  }

  private async fetchRemote(imp: ImportDecl, id: string): Promise<LibraryInfo | null> {
    const list = await this.facade.libList(`${imp.owner}/${imp.name}/`);
    const match = list.find((l) => l.libId === id) ?? list.find((l) => l.user === imp.owner && l.lib === imp.name);
    if (!match) return null;
    const source = await this.facade.getScript(match.scriptIdPart, match.version);
    if (!source) return null;
    const lib = parseLibrary(source, id, 'remote', { owner: imp.owner, version: imp.version, description: match.docs });
    if (!lib) this.remote.delete(id);
    return lib;
  }

  private async scan(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    const files = await vscode.workspace.findFiles(this.settings().librariesInclude, '**/node_modules/**', 500);
    for (const uri of files) {
      if (uri.scheme !== 'file') continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        this.index(uri, Buffer.from(bytes).toString('utf8'));
      } catch {
        // unreadable file: skip
      }
    }
  }

  private index(uri: vscode.Uri, text: string): void {
    if (!/\blibrary\s*\(/.test(text)) {
      this.localByUri.delete(uri.toString());
      return;
    }
    const lib = parseLibrary(text, vscode.workspace.asRelativePath(uri), 'local');
    if (lib) this.localByUri.set(uri.toString(), lib);
    else this.localByUri.delete(uri.toString());
  }

  private watch(context: vscode.ExtensionContext): void {
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(this.settings().librariesInclude);
    this.watcher.onDidDelete((uri) => this.localByUri.delete(uri.toString()));
    this.watcher.onDidCreate(async (uri) => this.index(uri, Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')));
    context.subscriptions.push(this.watcher);
  }
}
```

- [ ] **Step 6: Wire into `extension.ts`**

Replace the `noLibraries` line in `activate` with:

```ts
const facade = new PineFacade({ log });
const libraries = new LibraryIndex(facade, getSettings);
libraries.start(context);
```

Keep `facade` in module scope (`let facade: PineFacade`) so Task 13 can reuse it. Remove the `noLibraries` import if unused (keep the export in `libraries.ts` for tests).

- [ ] **Step 7: Run and verify**

Run: `npx vitest run && npm run typecheck && npm run build:extension`
Expected: all green. In the Extension Development Host with `tests/core/fixtures` opened as the workspace: in `consumer.pine`, hover `import yankikucuk/MaHelpers/2 as ma` shows the local library card; `ma.` completes `weighted`, `Level`, `Side`; typing `import Tradi` lists TradingView libraries (needs network).

- [ ] **Step 8: Commit**

```bash
npm run format
git add -A
git commit -m "Index workspace libraries and look up published TradingView libraries"
```

---

### Task 13: Compiler diagnostics (opt-in)

**Files:**
- Create: `src/extension/core/diagnostics.ts`, `src/extension/providers/diagnostics-controller.ts`, `tests/core/diagnostics.test.ts`
- Modify: `src/extension/extension.ts`, `src/extension/commands/add-type-annotations.ts` wiring

**Interfaces:**
- Consumes: `PineFacade`, `CompileResult`, `RawIssue` (Task 12); `CompilerTypesLookup` (Task 9).
- Produces:
  ```ts
  interface CompileDiagnostic { line: number; startCol: number; endCol: number; message: string; severity: 'error' | 'warning'; code: string | null }
  function toDiagnostics(result: CompileResult, lineCount: number): CompileDiagnostic[];
  function compilerVariableTypes(result: CompileResult): Map<string, string>;
  class DiagnosticsController { constructor(facade, settings); start(context): void; typesFor(uri): ReadonlyMap<string, string> | undefined }
  ```

- [ ] **Step 1: Write the failing test `tests/core/diagnostics.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { compilerVariableTypes, toDiagnostics } from '../../src/extension/core/diagnostics';

describe('toDiagnostics', () => {
  it('maps compiler issues to zero-based ranges with substituted messages', () => {
    const d = toDiagnostics(
      {
        success: true,
        errors: [{ code: 'CE10272', ctx: { identifier: 'closee' }, message: 'Undeclared identifier "{identifier}"', start: { line: 3, column: 6 }, end: { line: 3, column: 11 } }],
        warnings: [{ message: 'Unused variable', start: { line: 5, column: 1 }, end: { line: 5, column: 4 } }],
        variables: [],
        functions: [],
      },
      10,
    );
    expect(d).toEqual([
      { line: 2, startCol: 5, endCol: 10, message: 'Undeclared identifier "closee"', severity: 'error', code: 'CE10272' },
      { line: 4, startCol: 0, endCol: 3, message: 'Unused variable', severity: 'warning', code: null },
    ]);
  });

  it('reports a failure without positions on the first line', () => {
    expect(toDiagnostics({ success: false, reason: 'Script too large', errors: [], warnings: [], variables: [], functions: [] }, 3)).toEqual([
      { line: 0, startCol: 0, endCol: 0, message: 'Script too large', severity: 'error', code: null },
    ]);
  });

  it('clamps lines beyond the document', () => {
    const d = toDiagnostics({ success: true, errors: [{ message: 'x', start: { line: 99, column: 1 }, end: { line: 99, column: 2 } }], warnings: [], variables: [], functions: [] }, 3);
    expect(d[0]?.line).toBe(2);
  });

  it('collects variable types', () => {
    const t = compilerVariableTypes({ success: true, errors: [], warnings: [], variables: [{ name: 'a', type: 'series float' }], functions: [] });
    expect(t.get('a')).toBe('series float');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/diagnostics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/extension/core/diagnostics.ts`**

```ts
import type { CompileResult, RawIssue } from './pine-facade';

export interface CompileDiagnostic {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: 'error' | 'warning';
  code: string | null;
}

function render(issue: RawIssue): string {
  return issue.message.replace(/\{(\w+)\}/g, (_, key: string) => issue.ctx?.[key] ?? `{${key}}`);
}

function one(issue: RawIssue, severity: 'error' | 'warning', lineCount: number): CompileDiagnostic {
  const maxLine = Math.max(0, lineCount - 1);
  const line = Math.min(maxLine, Math.max(0, (issue.start?.line ?? 1) - 1));
  const startCol = Math.max(0, (issue.start?.column ?? 1) - 1);
  const endLine = Math.min(maxLine, Math.max(0, (issue.end?.line ?? issue.start?.line ?? 1) - 1));
  const endCol = endLine === line ? Math.max(startCol, (issue.end?.column ?? issue.start?.column ?? 1) - 1) : startCol;
  return { line, startCol, endCol, message: render(issue), severity, code: issue.code ?? null };
}

export function toDiagnostics(result: CompileResult, lineCount: number): CompileDiagnostic[] {
  const out = [...result.errors.map((e) => one(e, 'error', lineCount)), ...result.warnings.map((w) => one(w, 'warning', lineCount))];
  if (!result.success && !out.length) {
    out.push({ line: 0, startCol: 0, endCol: 0, message: result.reason ?? 'The TradingView compiler rejected the script.', severity: 'error', code: null });
  }
  return out;
}

export function compilerVariableTypes(result: CompileResult): Map<string, string> {
  return new Map(result.variables.map((v) => [v.name, v.type]));
}
```

- [ ] **Step 4: Implement `src/extension/providers/diagnostics-controller.ts`**

```ts
import * as vscode from 'vscode';
import { compilerVariableTypes, toDiagnostics } from '../core/diagnostics';
import type { PineFacade } from '../core/pine-facade';
import type { Settings } from '../vscode/settings';

const DEBOUNCE_MS = 600;

export class DiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection('pinescript');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly types = new Map<string, ReadonlyMap<string, string>>();

  constructor(
    private readonly facade: PineFacade,
    private readonly settings: () => Settings,
  ) {}

  start(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, DEBOUNCE_MS)),
      vscode.workspace.onDidSaveTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.collection.delete(d.uri);
        this.types.delete(d.uri.toString());
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('pinescript.diagnostics.remote')) return;
        if (this.settings().diagnosticsRemote) vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
        else this.collection.clear();
      }),
    );
    vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
  }

  typesFor(uri: vscode.Uri): ReadonlyMap<string, string> | undefined {
    return this.types.get(uri.toString());
  }

  private schedule(document: vscode.TextDocument, delay: number): void {
    if (document.languageId !== 'pinescript' || !this.settings().diagnosticsRemote) return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => void this.run(document), delay));
  }

  private async run(document: vscode.TextDocument): Promise<void> {
    const version = document.version;
    const result = await this.facade.translateLight(document.getText());
    if (!result || document.isClosed || document.version !== version) return;
    this.types.set(document.uri.toString(), compilerVariableTypes(result));
    this.collection.set(
      document.uri,
      toDiagnostics(result, document.lineCount).map((d) => {
        const diag = new vscode.Diagnostic(new vscode.Range(d.line, d.startCol, d.line, d.endCol), d.message, d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        diag.source = 'TradingView compiler';
        if (d.code) diag.code = d.code;
        return diag;
      }),
    );
  }
}
```

- [ ] **Step 5: Wire into `extension.ts`**

After creating `facade`:

```ts
const diagnostics = new DiagnosticsController(facade, getSettings);
diagnostics.start(context);
```

and change the type-annotation registration to `registerAddTypeAnnotations(context, (uri) => diagnostics.typesFor(uri));`.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run && npm run typecheck && npm run build:extension`. In the Extension Development Host set `"pinescript.diagnostics.remote": true`, type `plot(closee)`: a red squiggle with "Undeclared identifier "closee"" appears within a second; turn the setting off: it disappears.

```bash
npm run format
git add -A
git commit -m "Show TradingView compiler diagnostics when remote diagnostics are enabled"
```

---

### Task 14: Pine Dark and Pine Light themes

**Files:**
- Create: `themes/pine-dark-color-theme.json`, `themes/pine-light-color-theme.json`, `scripts/check-themes.mjs`
- Modify: `package.json` (`contributes.themes`), `scripts/build-grammar.mjs` (call the theme check in `--check` mode)

**Interfaces:**
- Produces: two theme files whose `tokenColors` cover every scope emitted by the grammar (checked by `scripts/check-themes.mjs`).

- [ ] **Step 1: Write the theme coverage check `scripts/check-themes.mjs`**

```js
// Fails when a scope emitted by the grammar has no rule in a theme.
import { readFileSync } from 'node:fs';

const grammar = JSON.parse(readFileSync('syntaxes/pinescript.tmLanguage.json', 'utf8'));
const scopes = new Set();
JSON.stringify(grammar, (key, value) => {
  if ((key === 'name' || key === 'contentName') && typeof value === 'string') value.split(' ').forEach((s) => scopes.add(s));
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
```

Add `"check:themes": "node scripts/check-themes.mjs"` to `package.json` scripts and append `&& npm run check:themes` to the `test` script after `build:grammar:check`.

- [ ] **Step 2: Create `themes/pine-dark-color-theme.json`**

```json
{
  "$schema": "vscode://schemas/color-theme",
  "name": "Pine Dark",
  "type": "dark",
  "semanticHighlighting": false,
  "colors": {
    "editor.background": "#131722",
    "editor.foreground": "#d1d4dc",
    "editor.lineHighlightBackground": "#1e222d",
    "editor.selectionBackground": "#2962ff55",
    "editor.inactiveSelectionBackground": "#2962ff33",
    "editor.selectionHighlightBackground": "#2962ff22",
    "editor.wordHighlightBackground": "#2962ff33",
    "editor.findMatchBackground": "#ff980066",
    "editor.findMatchHighlightBackground": "#ff980033",
    "editorCursor.foreground": "#d1d4dc",
    "editorLineNumber.foreground": "#50535e",
    "editorLineNumber.activeForeground": "#b2b5be",
    "editorIndentGuide.background1": "#2a2e39",
    "editorIndentGuide.activeBackground1": "#434651",
    "editorWhitespace.foreground": "#2a2e39",
    "editorBracketMatch.background": "#2962ff33",
    "editorBracketMatch.border": "#2962ff",
    "editorGutter.background": "#131722",
    "editorWidget.background": "#1e222d",
    "editorWidget.border": "#2a2e39",
    "editorSuggestWidget.background": "#1e222d",
    "editorSuggestWidget.selectedBackground": "#2962ff44",
    "editorHoverWidget.background": "#1e222d",
    "editorHoverWidget.border": "#2a2e39",
    "editorError.foreground": "#f23645",
    "editorWarning.foreground": "#ff9800",
    "editorInfo.foreground": "#2962ff",
    "sideBar.background": "#131722",
    "sideBar.foreground": "#b2b5be",
    "sideBar.border": "#2a2e39",
    "sideBarSectionHeader.background": "#1e222d",
    "activityBar.background": "#131722",
    "activityBar.foreground": "#d1d4dc",
    "activityBar.inactiveForeground": "#787b86",
    "activityBarBadge.background": "#2962ff",
    "activityBarBadge.foreground": "#ffffff",
    "statusBar.background": "#1e222d",
    "statusBar.foreground": "#b2b5be",
    "statusBar.noFolderBackground": "#1e222d",
    "statusBar.debuggingBackground": "#2962ff",
    "titleBar.activeBackground": "#131722",
    "titleBar.activeForeground": "#d1d4dc",
    "titleBar.inactiveBackground": "#131722",
    "tab.activeBackground": "#131722",
    "tab.inactiveBackground": "#1e222d",
    "tab.activeForeground": "#d1d4dc",
    "tab.inactiveForeground": "#787b86",
    "tab.border": "#2a2e39",
    "tab.activeBorderTop": "#2962ff",
    "editorGroupHeader.tabsBackground": "#1e222d",
    "panel.background": "#131722",
    "panel.border": "#2a2e39",
    "input.background": "#1e222d",
    "input.border": "#2a2e39",
    "input.foreground": "#d1d4dc",
    "dropdown.background": "#1e222d",
    "list.activeSelectionBackground": "#2962ff44",
    "list.hoverBackground": "#1e222d",
    "list.inactiveSelectionBackground": "#2a2e39",
    "focusBorder": "#2962ff",
    "button.background": "#2962ff",
    "button.foreground": "#ffffff",
    "badge.background": "#2962ff",
    "badge.foreground": "#ffffff",
    "scrollbarSlider.background": "#434651aa",
    "scrollbarSlider.hoverBackground": "#50535eaa",
    "peekView.border": "#2962ff",
    "terminal.background": "#131722",
    "terminal.foreground": "#d1d4dc"
  },
  "tokenColors": [
    { "name": "Comments", "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#5d606b", "fontStyle": "italic" } },
    { "name": "Annotations", "scope": ["storage.type.annotation", "storage.type.annotation.version"], "settings": { "foreground": "#787b86", "fontStyle": "bold italic" } },
    { "name": "Raw text in comments", "scope": "markup.inline.raw", "settings": { "foreground": "#9598a1" } },
    { "name": "Strings", "scope": ["string", "punctuation.definition.string"], "settings": { "foreground": "#4caf50" } },
    { "name": "String escapes", "scope": "constant.character.escape", "settings": { "foreground": "#81c784" } },
    { "name": "Format placeholders", "scope": "constant.other.placeholder", "settings": { "foreground": "#ffb74d" } },
    { "name": "Numbers", "scope": ["constant.numeric", "constant.numeric.integer", "constant.numeric.float"], "settings": { "foreground": "#ff9800" } },
    { "name": "Hex colors", "scope": "constant.other.color.hex", "settings": { "foreground": "#ff9800", "fontStyle": "underline" } },
    { "name": "Language constants (true, false, na)", "scope": "constant.language", "settings": { "foreground": "#ff5252" } },
    { "name": "Control keywords", "scope": ["keyword.control", "keyword.control.loop", "keyword.control.import", "keyword.control.import.as"], "settings": { "foreground": "#c792ea" } },
    { "name": "Declarations (type, enum, method, export, var, varip)", "scope": ["storage.type.declaration", "storage.type.declaration.enum", "storage.modifier", "storage.modifier.export", "storage.modifier.method"], "settings": { "foreground": "#c792ea", "fontStyle": "italic" } },
    { "name": "Type qualifiers", "scope": "storage.modifier.qualifier", "settings": { "foreground": "#b39ddb", "fontStyle": "italic" } },
    { "name": "Word operators (and, or, not)", "scope": "keyword.operator.logical", "settings": { "foreground": "#c792ea" } },
    { "name": "Operators", "scope": ["keyword.operator", "keyword.operator.arithmetic", "keyword.operator.assignment", "keyword.operator.comparison", "keyword.operator.ternary"], "settings": { "foreground": "#89ddff" } },
    { "name": "Arrow", "scope": "keyword.operator.arrow", "settings": { "foreground": "#89ddff", "fontStyle": "bold" } },
    { "name": "Types", "scope": ["support.type", "entity.name.type", "entity.name.type.enum", "meta.generic"], "settings": { "foreground": "#ffcb6b" } },
    { "name": "Built-in namespaces", "scope": "support.class", "settings": { "foreground": "#82aaff" } },
    { "name": "Built-in functions", "scope": ["support.function", "support.function.constructor"], "settings": { "foreground": "#2196f3" } },
    { "name": "Built-in variables", "scope": "support.variable", "settings": { "foreground": "#26a69a" } },
    { "name": "Built-in constants", "scope": "support.constant", "settings": { "foreground": "#f78c6c" } },
    { "name": "User functions and calls", "scope": ["entity.name.function", "entity.name.function.call", "entity.name.function.member"], "settings": { "foreground": "#82b1ff" } },
    { "name": "Import namespaces", "scope": ["entity.name.namespace.import", "entity.name.namespace.alias"], "settings": { "foreground": "#ffcb6b" } },
    { "name": "Parameters", "scope": "variable.parameter", "settings": { "foreground": "#eeffff", "fontStyle": "italic" } },
    { "name": "Variables", "scope": ["variable.other", "variable.other.assignment", "variable.other.member"], "settings": { "foreground": "#d1d4dc" } },
    { "name": "Punctuation", "scope": ["punctuation", "punctuation.accessor", "punctuation.separator.comma", "punctuation.section.parens.begin", "punctuation.section.parens.end", "punctuation.section.brackets.begin", "punctuation.section.brackets.end", "punctuation.definition.generic.begin", "punctuation.definition.generic.end", "punctuation.definition.tuple.begin", "punctuation.definition.tuple.end", "meta.parens", "meta.tuple.destructuring"], "settings": { "foreground": "#9598a1" } }
  ]
}
```

- [ ] **Step 3: Create `themes/pine-light-color-theme.json`**

Same structure with `"name": "Pine Light"`, `"type": "light"`, and these palettes:

```json
"colors": {
  "editor.background": "#ffffff",
  "editor.foreground": "#131722",
  "editor.lineHighlightBackground": "#f0f3fa",
  "editor.selectionBackground": "#2962ff33",
  "editor.inactiveSelectionBackground": "#2962ff1a",
  "editor.selectionHighlightBackground": "#2962ff14",
  "editor.wordHighlightBackground": "#2962ff22",
  "editor.findMatchBackground": "#ff980066",
  "editor.findMatchHighlightBackground": "#ff980033",
  "editorCursor.foreground": "#131722",
  "editorLineNumber.foreground": "#b2b5be",
  "editorLineNumber.activeForeground": "#434651",
  "editorIndentGuide.background1": "#e0e3eb",
  "editorIndentGuide.activeBackground1": "#b2b5be",
  "editorWhitespace.foreground": "#e0e3eb",
  "editorBracketMatch.background": "#2962ff22",
  "editorBracketMatch.border": "#2962ff",
  "editorGutter.background": "#ffffff",
  "editorWidget.background": "#f0f3fa",
  "editorWidget.border": "#e0e3eb",
  "editorSuggestWidget.background": "#ffffff",
  "editorSuggestWidget.selectedBackground": "#2962ff22",
  "editorHoverWidget.background": "#ffffff",
  "editorHoverWidget.border": "#e0e3eb",
  "editorError.foreground": "#f23645",
  "editorWarning.foreground": "#ff9800",
  "editorInfo.foreground": "#2962ff",
  "sideBar.background": "#f8f9fd",
  "sideBar.foreground": "#434651",
  "sideBar.border": "#e0e3eb",
  "sideBarSectionHeader.background": "#f0f3fa",
  "activityBar.background": "#f0f3fa",
  "activityBar.foreground": "#131722",
  "activityBar.inactiveForeground": "#787b86",
  "activityBarBadge.background": "#2962ff",
  "activityBarBadge.foreground": "#ffffff",
  "statusBar.background": "#f0f3fa",
  "statusBar.foreground": "#434651",
  "statusBar.noFolderBackground": "#f0f3fa",
  "statusBar.debuggingBackground": "#2962ff",
  "titleBar.activeBackground": "#f8f9fd",
  "titleBar.activeForeground": "#131722",
  "titleBar.inactiveBackground": "#f8f9fd",
  "tab.activeBackground": "#ffffff",
  "tab.inactiveBackground": "#f0f3fa",
  "tab.activeForeground": "#131722",
  "tab.inactiveForeground": "#787b86",
  "tab.border": "#e0e3eb",
  "tab.activeBorderTop": "#2962ff",
  "editorGroupHeader.tabsBackground": "#f0f3fa",
  "panel.background": "#ffffff",
  "panel.border": "#e0e3eb",
  "input.background": "#ffffff",
  "input.border": "#e0e3eb",
  "input.foreground": "#131722",
  "dropdown.background": "#ffffff",
  "list.activeSelectionBackground": "#2962ff22",
  "list.hoverBackground": "#f0f3fa",
  "list.inactiveSelectionBackground": "#e0e3eb",
  "focusBorder": "#2962ff",
  "button.background": "#2962ff",
  "button.foreground": "#ffffff",
  "badge.background": "#2962ff",
  "badge.foreground": "#ffffff",
  "scrollbarSlider.background": "#b2b5be80",
  "scrollbarSlider.hoverBackground": "#787b8680",
  "peekView.border": "#2962ff",
  "terminal.background": "#ffffff",
  "terminal.foreground": "#131722"
}
```

and the same `tokenColors` list with these foregrounds: comments `#9598a1`; annotations `#787b86`; raw `#5d606b`; strings `#089981`; escapes `#0b7a5b`; placeholders `#b26a00`; numbers and hex `#e65100`; language constants `#d32f2f`; control keywords, declarations, logical operators `#7e57c2`; qualifiers `#9575cd`; operators and arrow `#0277bd`; types and import namespaces `#b26a00`; namespaces `#1565c0`; built-in functions `#2962ff`; built-in variables `#00897b`; built-in constants `#c2410c`; user functions `#1e88e5`; parameters `#37474f`; variables `#131722`; punctuation `#5d606b`. Font styles unchanged.

- [ ] **Step 4: Contribute themes**

`package.json` `contributes.themes`:

```json
"themes": [
  { "label": "Pine Dark", "uiTheme": "vs-dark", "path": "./themes/pine-dark-color-theme.json" },
  { "label": "Pine Light", "uiTheme": "vs", "path": "./themes/pine-light-color-theme.json" }
]
```

- [ ] **Step 5: Verify**

Run: `npm run check:themes`
Expected: `Themes cover every grammar scope.` Then in the Extension Development Host switch to Pine Dark and Pine Light with `tests/snapshots/strategy-v6.pine` open and check that comments, annotations, strings, numbers, built-ins per category, keywords and user functions are visibly distinct in both.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "Add Pine Dark and Pine Light color themes with a scope coverage check"
```

---

### Task 15: Documentation, metadata, CI and the 3.0.0 release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.github/CONTRIBUTING.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json`

- [ ] **Step 1: Rewrite `README.md`**

Keep the header, badges and the screenshot. Replace the `## Features` section and everything after it with:

```markdown
## Features

- **Completion.** Built-in functions, variables and constants from every v6 namespace, keywords, types, your own functions, types, enums and variables, named arguments inside calls, `//@` annotations, and `import` paths. Function items insert a call and open parameter hints.
- **Hover documentation.** Signature, description, parameters, return value and a link to the reference entry for built-ins; declaration and `//@` docs for your own symbols; a library card on `import` lines.
- **Signature help.** Overloads and the active parameter, including named arguments.
- **Outline.** Functions, methods, types with fields, enums with members and top-level variables in the Outline view and breadcrumbs.
- **Libraries.** Workspace files that call `library()` are indexed: their exports complete after the import alias and show up on hover. With `pinescript.libraries.remote` on, `import` completion also lists published TradingView libraries and hover shows their exports.
- **Compiler diagnostics (opt-in).** Set `pinescript.diagnostics.remote` to `true` to send the document to the TradingView compiler and see its errors and warnings inline.
- **Commands.** New Indicator / Strategy / Library from a template, Generate Docstring (also a lightbulb on declarations), Add Type Annotations, Open Reference for the built-in under the cursor.
- **Themes.** Pine Dark and Pine Light, tuned for every scope the grammar produces.
- **Highlighting, snippets and editor support** as before: the full v6 vocabulary, annotations, triple-quoted strings, format placeholders, hex colors, folding, auto-closing pairs and four-space indentation for `.pine` files.

Files ending in `.pine` or `.pinescript`, or starting with `//@version=`, are recognized automatically.

### Pine Script v6 compatibility

The grammar and the documentation data are generated from the v6 reference, so v6 behaviors such as dynamic `request.*()` calls with `series string` arguments, short-circuit `and`/`or`, point-based text sizes, `text.format_bold` / `text.format_italic`, order trimming and negative array indices are covered wherever they have syntax to highlight or document. They are compiler behaviors; the extension does not emulate them.

## Commands

| Command | What it does |
|---------|--------------|
| Pine Script: New Indicator | Opens an untitled document from the indicator template |
| Pine Script: New Strategy | Opens an untitled document from the strategy template |
| Pine Script: New Library | Opens an untitled document from the library template |
| Pine Script: Generate Docstring | Inserts or completes `//@function`, `//@param`, `//@returns`, `//@type`, `//@field`, `//@enum` for the declaration at the cursor |
| Pine Script: Add Type Annotations | Prefixes untyped declarations with their inferred type in the selection or the whole file |
| Pine Script: Open Reference | Opens the v6 reference at the built-in under the cursor |

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `pinescript.completion.enabled` | `true` | Completion provider |
| `pinescript.hover.enabled` | `true` | Hover provider |
| `pinescript.signatureHelp.enabled` | `true` | Parameter hints |
| `pinescript.libraries.local.include` | `**/*.pine` | Glob for workspace library discovery |
| `pinescript.libraries.remote` | `true` | Look up published libraries on TradingView for `import` completion and hover |
| `pinescript.diagnostics.remote` | `false` | Send the document to the TradingView compiler for diagnostics |

## Privacy

Everything works offline. Two features talk to TradingView, both through undocumented endpoints that may change:

- With `pinescript.libraries.remote` on, the prefix you type after `import` and the ids of imported libraries are sent to fetch library metadata and source.
- With `pinescript.diagnostics.remote` on, the **full text** of each open Pine document is sent to the compiler on open, on save and 600 ms after you stop typing.

Nothing else leaves your machine. When a request fails, the feature is paused for five minutes and the reason is written to the "Pine Script" output channel.

## Recommended companions

- [vscode-icons](https://marketplace.visualstudio.com/items?itemName=vscode-icons-team.vscode-icons) for a `.pine` file icon.

## How it works

```
src/
  grammar.mjs           grammar rules, expressed as data
  data/
    functions.json      built-in functions, grouped by namespace (grammar source)
    variables.json      built-in variables, grouped by namespace (grammar source)
    constants.json      built-in constants, grouped by namespace (grammar source)
    annotations.json    compiler annotations
    reference.json      full v6 documentation, generated by scripts/scrape-reference.mjs
  extension/
    core/               pure TypeScript: tokenizer, document model, completion context,
                        type inference, docstrings, templates, TradingView client
    providers/          VS Code adapters: completion, hover, signature help, symbols,
                        code actions, diagnostics, library index
    commands/           command implementations
scripts/
  build-grammar.mjs     compiles src/ into syntaxes/pinescript.tmLanguage.json and
                        checks it against reference.json
  build-extension.mjs   bundles src/extension into dist/extension.cjs with esbuild
  scrape-reference.mjs  regenerates src/data/reference.json (maintainers, needs network)
  check-themes.mjs      verifies both themes cover every grammar scope
themes/                 Pine Dark and Pine Light
tests/
  core/                 vitest suites for src/extension/core
  unit/                 scope assertions (vscode-tmgrammar-test)
  snapshots/            full-file snapshots (vscode-tmgrammar-snap)
```

`syntaxes/pinescript.tmLanguage.json`, `src/data/reference.json` and `dist/` are generated. Do not edit them by hand.

## Development

```sh
git clone https://github.com/yankikucuk/pine-script-syntax-highlighter.git
cd pine-script-syntax-highlighter
npm install
npm run build        # grammar + extension bundle
npm run watch        # rebuild the bundle on change
npm test             # grammar check, type check, core tests, grammar tests
npm run package      # build the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded. Use **Developer: Inspect Editor Tokens and Scopes** to see which scope a token receives.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the pull request checklist and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © Yankı Küçük

Pine Script® is a registered trademark of TradingView, Inc. This project is not affiliated with TradingView.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Add above `[2.0.1]`:

```markdown
## [3.0.0] - 2026-09-07

### Added

- Completion for built-ins, keywords, types, user symbols, named arguments, annotations and import paths, with documentation and signatures.
- Hover documentation for built-ins, user functions, types, enums, variables and imports.
- Signature help with overloads and named-argument awareness.
- Document outline (functions, methods, types, enums, top-level variables).
- Workspace library indexing and published TradingView library lookup for `import` completion and hover.
- Opt-in diagnostics from the TradingView compiler (`pinescript.diagnostics.remote`).
- Commands: New Indicator, New Strategy, New Library, Generate Docstring (with a code action), Add Type Annotations, Open Reference.
- Pine Dark and Pine Light color themes.
- `src/data/reference.json`, generated from the v6 reference, and a build check that keeps it in step with the grammar data.

### Changed

- Minimum VS Code version is 1.96.
- The package now ships a bundled extension entry point (`dist/extension.cjs`) built with esbuild.
- `npm run build` now builds both the grammar and the extension; grammar-only scripts are `build:grammar` and `build:grammar:check`.
```

Add the compare link `[3.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v2.0.1...v3.0.0` and point `[Unreleased]` at `v3.0.0...HEAD`.

- [ ] **Step 3: Update `.github/CONTRIBUTING.md`**

Add sections:

```markdown
## Layout

- `src/grammar.mjs` and `src/data/*.json` produce the grammar. `src/data/reference.json` is scraped, not edited.
- `src/extension/core` holds all logic and never imports `vscode`; put tests for it in `tests/core`.
- `src/extension/providers` and `src/extension/commands` only translate between VS Code and `core`.

## Working on the extension

```sh
npm run watch      # rebuild dist/extension.cjs on change
```

Press F5, then reload the Extension Development Host after each rebuild.

## Refreshing the reference data

```sh
npm install --no-save playwright-core
npx playwright-core install chromium
npm run scrape:reference
npm run build:grammar:check   # lists built-ins to add to or remove from src/data/*.json
```

## Manual checklist before a release

- Completion after `ta.`, inside `plot(`, after `//@`, after `import `
- Hover on `close`, `ta.sma`, a user function, an import line
- Signature help through all parameters of `plot(`
- Outline shows functions, types, enums, variables
- Generate Docstring on a function, a type and an enum
- Add Type Annotations on the strategy snapshot fixture
- Both themes on `tests/snapshots/strategy-v6.pine`
- With `pinescript.diagnostics.remote` on: an undeclared identifier is underlined
```

Update the pull request checklist item about tests to mention `tests/core` for extension logic.

- [ ] **Step 4: Finalize CI and release workflows**

`ci.yml` job steps in order: checkout, setup-node (22), `npm ci`, `npm run format:check`, `npm run build:grammar:check`, `npm run check:themes`, `npm run typecheck`, `npm run test:core`, `npm run test:unit`, `npm run test:snap`, `npm run build:extension`, `npx vsce package`, verify bundle in package, upload artifact. `release.yml`: same build steps before `vsce package`, then the existing tag/version check, GitHub release and gated publish.

- [ ] **Step 5: Bump the version and verify the package**

```bash
npm version 3.0.0 --no-git-tag-version
npm run format
npm test
npm run build:extension
npx vsce package
unzip -l pine-script-syntax-highlighter-3.0.0.vsix
```

Expected in the listing: `extension/dist/extension.cjs`, `extension/themes/*.json`, `extension/syntaxes/pinescript.tmLanguage.json`, `extension/snippets/*`, `extension/language-configuration.json`, `extension/images/*`, `extension/README.md`, `extension/CHANGELOG.md`, `extension/LICENSE`, and nothing under `extension/src`, `extension/tests`, `extension/scripts` or `extension/docs`. Install the vsix locally (`code --install-extension pine-script-syntax-highlighter-3.0.0.vsix`) and run the manual checklist from CONTRIBUTING.

- [ ] **Step 6: Grep for forbidden words**

```bash
grep -rniE "claude|anthropic|copilot|\bai\b|artificial intelligence|co-authored" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude=package-lock.json . ; echo "exit $?"
```

Expected: no matches (exit 1). The reference JSON may legitimately contain "ai" inside words; the `\bai\b` pattern avoids those. Fix any hit before committing.

- [ ] **Step 7: Commit, tag, push**

```bash
git add -A
git commit -m "Release 3.0.0: language features, themes and compiler diagnostics"
git tag -a v3.0.0 -m "3.0.0"
git push origin master --tags
```

Watch the Release workflow (`gh run watch`), then confirm the Marketplace shows 3.0.0:

```bash
curl -s -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.1-preview.1' -d '{"filters":[{"criteria":[{"filterType":7,"value":"ex-codes.pine-script-syntax-highlighter"}]}],"flags":103}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).results[0].extensions[0].versions[0].version))'
```

---

## Self-review notes

- Spec §4.3 consistency check → Task 2. §5.1–5.11 → Tasks 4, 5, 6, 6, 7, 9, 10, 12, 12, 13, 11. §6.1–6.8 → Tasks 8, 8, 8, 8, 13, 10, 9/10/11, 8. §7 → Task 14. §8 → each task's tests plus the CONTRIBUTING checklist in Task 15. §9 → Task 15. §10 privacy/robustness → Tasks 12, 13, 15 (README).
- `FunctionSymbol.lastLine` is introduced in Task 10 and must be added to the Task 5 implementation when Task 10 runs; Task 5's tests do not assert it.
- `LibraryLookup`/`LibraryInfo` are defined in Task 8 and implemented in Task 12; Task 8 wires `noLibraries` so the extension runs in between.
- `CompilerTypesLookup` from Task 9 is fed by `DiagnosticsController.typesFor` in Task 13.
