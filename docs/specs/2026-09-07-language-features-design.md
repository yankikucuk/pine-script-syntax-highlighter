# Language features for Pine Script v6 (3.0.0)

Date: 2026-09-07
Status: approved design, pending implementation plan

## 1. Goal

Turn the extension from a grammar-only package into a full language extension for
Pine Script v6 while keeping the existing grammar pipeline untouched. The release is
3.0.0 and adds:

- Completion with signatures and documentation
- Hover documentation and signature help
- Document outline (symbols)
- Library integration: local workspace libraries and TradingView published libraries
- Diagnostics from the TradingView compiler (opt-in)
- Commands: new indicator/strategy/library, generate docstring, add type annotations,
  open reference
- Two color themes: Pine Dark and Pine Light

Non-goals for 3.0.0: formatting, rename, go-to-definition across files, semantic
tokens, a language server, running or backtesting scripts, TradingView account login.

The "Pine Script v6 specific features" from the competing extension's README
(dynamic requests, short-circuit `and`/`or`, typographic text sizes, bold/italic text,
order trimming, negative array indices) are compiler behaviors. The grammar already
covers their surface syntax (`request.*`, `size.*`, `text.format_*`). README gains a
short "v6 compatibility" note; no code is written for them.

## 2. Architecture

Single extension, direct VS Code API, no language server.

```
src/
  grammar.mjs                 unchanged
  data/
    functions.json            unchanged, grammar source
    variables.json            unchanged, grammar source
    constants.json            unchanged, grammar source
    annotations.json          unchanged, grammar source
    reference.json            NEW, generated, full v6 documentation
  extension/
    extension.ts              activate(): wires providers, commands, diagnostics
    core/                     pure TypeScript, never imports "vscode"
      reference.ts            load + index reference.json
      tokenizer.ts            line tokenizer (comments, strings, idents, numbers, brackets)
      document-model.ts       symbols of one document, cached by version
      context.ts              what is being typed at a position
      call-resolver.ts        enclosing call, active parameter
      markdown.ts             hover / completion documentation strings
      type-inference.ts       static type of an initializer expression
      docstring.ts            annotation block generator
      libraries.ts            library export parsing, local + remote models
      pine-facade.ts          HTTP client for TradingView endpoints
      diagnostics.ts          compiler response -> neutral diagnostics
      templates.ts            new-file templates
    providers/                thin adapters over core
      completion.ts
      hover.ts
      signature-help.ts
      document-symbol.ts
      code-action.ts
      diagnostics-controller.ts
    commands/
      new-file.ts
      generate-docstring.ts
      add-type-annotations.ts
      open-reference.ts
    vscode/
      settings.ts             typed access to configuration
      output.ts               "Pine Script" output channel
scripts/
  build-grammar.mjs           unchanged
  scrape-reference.mjs        NEW, produces src/data/reference.json
  build-extension.mjs         NEW, esbuild bundle
themes/
  pine-dark-color-theme.json  NEW
  pine-light-color-theme.json NEW
tests/
  unit/, snapshots/           unchanged grammar tests
  core/                       NEW, vitest tests for src/extension/core
    fixtures/*.pine
```

Rules:

- `core/` has no dependency on `vscode`; it works on strings, line arrays and plain
  offsets. Everything testable lives there.
- `providers/` and `commands/` translate between VS Code types and core types and
  contain no logic beyond that translation.
- `reference.json` is the only documentation source at runtime. It is loaded lazily on
  first use and kept in memory.

## 3. Build and packaging

- TypeScript 5.x, `tsconfig.json` with `strict`, `module: ESNext`, `moduleResolution:
Bundler`, `target: ES2022`, `noEmit` (esbuild emits).
- esbuild bundles `src/extension/extension.ts` to `dist/extension.cjs`, format `cjs`,
  platform `node`, target `node20`, `external: ["vscode"]`, minified for release, with
  a source map in development. `reference.json` is bundled by JSON import.
- `package.json`: `"main": "./dist/extension.cjs"`, `"type": "module"` stays.
  `activationEvents` is empty; VS Code derives `onLanguage:pinescript` and `onCommand`
  from `contributes`. `engines.vscode` becomes `^1.96.0`.
- New dev dependencies: `typescript`, `esbuild`, `@types/vscode`, `@types/node`,
  `vitest`. No runtime dependencies.
- Scripts:
  - `build:grammar`, `build:grammar:check` (renamed from `build`, `build:check`)
  - `build:extension` (esbuild release), `watch` (esbuild watch)
  - `scrape:reference` (network, maintainers only)
  - `typecheck` (`tsc --noEmit`)
  - `test:core` (vitest), `test:unit`, `test:snap` unchanged
  - `test` = `build:grammar:check && typecheck && test:core && test:unit && test:snap`
  - `vscode:prepublish` = `npm test && npm run build:extension`
- `.vscodeignore` additionally excludes `src/extension/**`, `tests/**`, `docs/**`,
  `tsconfig.json`, `vitest.config.*`. `dist/` and `themes/` are included.
- CI adds `typecheck` and `test:core`; the package step verifies the vsix contains
  `dist/extension.cjs`.

## 4. Reference data

### 4.1 Source and scraper

`scripts/scrape-reference.mjs` produces `src/data/reference.json` from
https://www.tradingview.com/pine-script-reference/v6/. The page is a client-rendered
application. The scraper first tries to locate the documentation payload inside the
page's JavaScript bundles (plain `fetch`, no browser). If that is not possible, it
falls back to a headless Chromium via an optional `playwright-core` dev dependency
(installed on demand, never part of `npm test` or CI).

The scraper is idempotent and deterministic: entries sorted by id, stable key order,
so diffs stay reviewable. It is run by maintainers when TradingView updates the
reference; the result is committed.

### 4.2 Schema

```jsonc
{
  "version": "6",
  "generatedAt": "2026-09-07",
  "entries": [
    {
      "id": "fun_ta.sma", // anchor on the reference page
      "kind": "function", // function | variable | constant | keyword | type | annotation | operator
      "name": "ta.sma",
      "namespace": "ta", // "" for bare names
      "description": "…markdown…",
      "overloads": [
        // functions only; one entry per syntax line
        {
          "syntax": "ta.sma(source, length) → series float",
          "params": [
            { "name": "source", "type": "series int/float", "description": "…", "optional": false, "default": null },
          ],
          "returns": { "type": "series float", "description": "…" },
        },
      ],
      "type": "series float", // variables and constants only
      "remarks": "…markdown…",
      "example": "//@version=6\n…",
      "seeAlso": ["fun_ta.ema", "fun_ta.rma"],
    },
  ],
}
```

Markdown fields keep inline code and links; links to other entries are rewritten to
`https://www.tradingview.com/pine-script-reference/v6/#<id>`.

### 4.3 Consistency check

`build:grammar:check` additionally verifies that every identifier in
`functions.json`, `variables.json` and `constants.json` has an entry in
`reference.json` with the matching kind, and that every function/variable/constant in
`reference.json` appears in the grammar data. A mismatch fails the build with the list
of offending names. This keeps highlighting and documentation in lock-step.

## 5. Core modules

### 5.1 tokenizer.ts

Input: full text. Output: per line, an array of tokens `{ kind, start, end, text }`
with kinds `comment`, `string`, `number`, `ident`, `op`, `open`, `close`, `comma`,
`ws`. Handles `//` comments, `'…'`, `"…"` with escapes, triple-quoted strings spanning
lines (state carried between lines), dotted identifiers as a single `ident` token
(`ta.sma`, `syminfo.mincontract`). Returns also `inString(line, col)` and
`inComment(line, col)` helpers used by every provider to stay silent inside strings and
comments.

### 5.2 document-model.ts

`buildModel(text): DocumentModel`, cached by `(uri, version)` in the provider layer.

```ts
interface DocumentModel {
  version: number | null; // from //@version=N, null if missing
  scriptKind: 'indicator' | 'strategy' | 'library' | null;
  libraryTitle: string | null; // library("Title")
  imports: ImportDecl[]; // { owner, name, version, alias, line }
  functions: FunctionSymbol[]; // user functions and methods
  types: TypeSymbol[]; // type Name + fields
  enums: EnumSymbol[]; // enum Name + members
  variables: VariableSymbol[]; // top-level and nested declarations
}
interface FunctionSymbol {
  name: string;
  isMethod: boolean;
  isExport: boolean;
  params: { name: string; type: string | null; default: string | null }[];
  docs: Annotations; // parsed //@function, //@param, //@returns
  range: LineRange; // header line to last indented body line
}
interface VariableSymbol {
  name: string;
  declaredType: string | null;
  qualifier: 'var' | 'varip' | null;
  initializer: string | null;
  line: number;
  column: number;
  scope: LineRange;
}
```

Parsing is line-based and indentation-aware. A function is a line matching
`[export] [method] name(params) =>`; its body is the following lines with deeper
indentation. Multi-line parameter lists (closing paren on a later line) are joined
before parsing. Annotations are the contiguous `//@…` comment block directly above
the declaration.

### 5.3 context.ts

`completionContext(model, tokensOfLine, line, col)` returns one of:

- `{ kind: 'none' }` inside a string or comment (except annotation context)
- `{ kind: 'annotation', prefix }` after `//@`
- `{ kind: 'import-path', prefix }` on a line starting with `import`, before ` as`
- `{ kind: 'member', receiver, prefix }` after `ident.` where receiver is a built-in
  namespace, an import alias, a user type name, or an enum name
- `{ kind: 'named-arg', call, prefix }` inside a call's parentheses where the cursor is
  at the start of an argument
- `{ kind: 'identifier', prefix }` otherwise

### 5.4 call-resolver.ts

`enclosingCall(tokensUpToCursor)` walks back over balanced brackets and strings and
returns `{ name, argIndex, namedArg: string | null, usedNamedArgs: string[] }` or
`null`. Used by signature help and named-argument completion.

### 5.5 markdown.ts

Builds the documentation strings. For a reference entry: fenced `pine` block with the
syntax line(s), description, parameter list (`name` — type — description), returns,
remarks, and a "Reference" link. For a user symbol: syntax reconstructed from the
declaration and the parsed annotations. For a library: title, description, and its
exported symbols.

### 5.6 type-inference.ts

`inferType(expr: string, scope: Scope): string | null` where `Scope` gives access to
the reference index, the document model and optional compiler-provided types.

Resolution order:

1. Compiler types from the last successful `translate_light` response for this
   document version (`variables2`), when remote diagnostics are enabled.
2. Literals: int, float, string, bool, `na` (null), `#RRGGBB` (color).
3. Built-in variables and constants: their `type` from the reference.
4. Built-in function calls: `returns.type` of the first overload whose arity matches;
   `input.*` functions map to their value type.
5. `Name.new(...)`: `Name` for user types and built-in drawing types.
6. Identifiers declared earlier in the document with an explicit type.
7. Operators: comparison and logical operators yield `bool`; `+` yields `string` when
   either side is a string, else the numeric promotion of both sides; `?:` yields the
   type when both branches agree.

Qualifiers (`series`, `simple`, …) are stripped; only the base type is inserted. Anything
else returns `null` and the variable is skipped.

### 5.7 docstring.ts

`generateDocstring(symbol): string[]` returns the comment lines to insert above:

- function/method: `//@function <name>`, one `//@param <p> ` per parameter,
  `//@returns ` (omitted when the body's last expression is a call to a void built-in
  such as `plot`, `strategy.entry`, `alert`, `runtime.error`, `log.*`).
- type: `//@type <Name>`, one `//@field <f> ` per field.
- enum: `//@enum <Name>`, one `//@field <m> ` per member.

Existing annotations above the declaration are merged: lines already present are kept,
missing ones are added in canonical order, nothing is deleted.

### 5.8 libraries.ts

```ts
interface LibraryInfo {
  id: string; // "owner/Name/version" for remote, file path for local
  title: string;
  owner: string | null;
  version: string | null;
  description: string | null; // //@description or library docs
  exports: FunctionSymbol[] | TypeSymbol[] | EnumSymbol[];
  source: 'local' | 'remote';
}
```

`parseLibrary(text, id, source)` uses `document-model.ts` and keeps only `export`
symbols. Local libraries: every workspace file matching
`pinescript.libraries.local.include` whose model has `scriptKind === 'library'`.
Remote libraries: `pine-facade.ts` `libList(prefix)` for completion and
`getScript(scriptIdPart, version)` for exports, parsed with the same function.

### 5.9 pine-facade.ts

```ts
interface PineFacade {
  libList(prefix: string): Promise<RemoteLibrary[]>;
  getScript(scriptIdPart: string, version: string): Promise<string | null>; // source
  translateLight(source: string): Promise<CompileResult | null>;
}
```

- Base URL `https://pine-facade.tradingview.com/pine-facade/`. Requests send
  `Accept: application/json` and `Referer: https://www.tradingview.com/`. `fetch` is
  injected so tests never touch the network.
- `translateLight` POSTs `source` as `application/x-www-form-urlencoded` to
  `translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000`.
- Caching: `libList` results 10 minutes per prefix; `getScript` results for the session;
  `translateLight` keyed by a hash of the source, 100 entries LRU.
- Failure policy: any non-2xx or network error is logged to the output channel. After
  three consecutive failures the client backs off for five minutes and every call
  resolves to `null`/`[]` immediately. No popups, ever.
- Timeouts: 8 seconds per request via `AbortController`.

### 5.10 diagnostics.ts

Maps `result.errors2` and `result.warnings2` to
`{ line, startCol, endCol, message, severity, code }`. Messages are rendered by
substituting `{key}` placeholders from `ctx`. Compiler positions are 1-based; the
mapping converts to 0-based. When the compiler returns `success: false` without
positions, a single diagnostic on line 0 is produced with the returned reason.

### 5.11 templates.ts

Three templates following the Pine Script style guide section order (version, header
comment, declaration, imports, constants, inputs, functions, calculations, plots,
alerts). Placeholders use the current date and a title derived from the file name when
one exists.

## 6. Providers and commands

### 6.1 Completion (`.`, `/`, `@`, `(`, `,` and identifiers)

| Context     | Items                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| identifier  | built-in namespaces and bare built-ins, keywords, types, user symbols, import aliases |
| member      | members of the namespace, alias exports, type fields/`new`, enum members              |
| named-arg   | remaining parameter names of the enclosing call as `name=`                            |
| annotation  | annotation names                                                                      |
| import-path | local libraries, then remote `libList(prefix)` results as `owner/Name/version`        |

Function items insert `name($1)` as a snippet and trigger signature help. `detail` is the
syntax line, `documentation` the markdown from `markdown.ts`. Deprecated or
version-mismatched suggestions are not a concern: the data is v6 only.

### 6.2 Hover

Word under cursor resolved in this order: import alias member, user symbol in scope,
reference entry (longest dotted match first, so `ta.sma` wins over `ta`), import line
(library card), keyword. Returns `null` inside strings and non-annotation comments.

### 6.3 Signature help (`(`, `,`)

Uses `call-resolver.ts`. Built-in overloads become separate signatures; the active
signature is the first whose parameter count fits, the active parameter is the named
argument when present, else `argIndex`. User functions and library exports produce one
signature from their declaration and annotations.

### 6.4 Document symbols

Functions, methods, types (with fields as children), enums (with members as children),
top-level variables, and the `indicator/strategy/library` declaration as the root.

### 6.5 Diagnostics controller

Active only when `pinescript.diagnostics.remote` is `true`. On open, on change
(debounced 600 ms) and on save, the full document text is sent to `translateLight` and
the result mapped into a `DiagnosticCollection` named `pinescript`. Responses that
arrive for an outdated document version are dropped. Successful responses are also
stored per document for `type-inference.ts` and for hover on user functions (compiler
syntax wins over reconstructed syntax when available). Disabling the setting clears all
diagnostics.

### 6.6 Code actions

On a line that declares a function, method, type or enum without a complete annotation
block: "Generate docstring" (kind `refactor`). It calls the same core function as the
command.

### 6.7 Commands

| Command id                      | Title                             | Behavior                                                                                        |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pinescript.newIndicator`       | Pine Script: New Indicator        | Opens an untitled `pinescript` document with the template                                       |
| `pinescript.newStrategy`        | Pine Script: New Strategy         | Same, strategy template                                                                         |
| `pinescript.newLibrary`         | Pine Script: New Library          | Same, library template                                                                          |
| `pinescript.generateDocstring`  | Pine Script: Generate Docstring   | For the declaration at the cursor (or every declaration in the selection), inserts/merges docs  |
| `pinescript.addTypeAnnotations` | Pine Script: Add Type Annotations | For the selection (or whole document), prefixes inferable untyped declarations; shows a summary |
| `pinescript.openReference`      | Pine Script: Open Reference       | Opens the v6 reference at the anchor of the built-in under the cursor, or the reference root    |

Editor context menu group "Pine Script" shows generateDocstring, addTypeAnnotations and
openReference for `pinescript` documents. The three "New …" commands are in the command
palette only.

### 6.8 Configuration

| Setting                              | Type    | Default     | Meaning                                                                |
| ------------------------------------ | ------- | ----------- | ---------------------------------------------------------------------- |
| `pinescript.completion.enabled`      | boolean | `true`      | Register the completion provider                                       |
| `pinescript.hover.enabled`           | boolean | `true`      | Register the hover provider                                            |
| `pinescript.signatureHelp.enabled`   | boolean | `true`      | Register signature help                                                |
| `pinescript.libraries.local.include` | string  | `**/*.pine` | Glob for workspace library discovery                                   |
| `pinescript.libraries.remote`        | boolean | `true`      | Query TradingView for published libraries in `import` completion/hover |
| `pinescript.diagnostics.remote`      | boolean | `false`     | Send the document to the TradingView compiler for diagnostics          |

Changing a setting re-registers providers without reload.

## 7. Themes

`themes/pine-dark-color-theme.json` (`uiTheme: vs-dark`, label "Pine Dark") and
`themes/pine-light-color-theme.json` (`uiTheme: vs`, label "Pine Light"). Both define:

- Workbench colors for editor background/foreground, line highlight, selection,
  cursor, gutter, sidebar, status bar, tabs and widgets. Dark background `#131722`
  (matches the gallery banner), light background `#ffffff`.
- Token colors for every scope the grammar emits: comments, annotations, keywords
  (control, declaration, operator words, qualifiers), storage types, generics,
  built-in functions per namespace, built-in variables, built-in constants, language
  constants, user functions, parameters, variables, strings and escapes, format
  placeholders, numbers, hex colors, operators, punctuation.
- Semantic highlighting disabled (no semantic token provider exists).

## 8. Testing

- `tests/core/*.test.ts` with vitest: tokenizer (strings, triple quotes, comments,
  dotted identifiers), document model (functions with defaults and multi-line params,
  methods, types, enums, imports, annotations, scopes), context detection at many
  cursor positions, call resolver with nested calls and named args, type inference
  table-driven cases, docstring generation and merging, library parsing, pine-facade
  client with a fake `fetch` (caching, backoff, timeout), diagnostics mapping from a
  recorded compiler response, template rendering.
- Fixtures under `tests/core/fixtures/` are real v6 scripts, including a library and a
  script importing it.
- Grammar tests unchanged. Reference consistency check covered by `build:grammar:check`.
- Manual verification in the Extension Development Host before release, following a
  checklist added to `CONTRIBUTING.md`.

## 9. Documentation and release

- README rewritten around the new capabilities, with a privacy note for the two
  remote features and how to disable them, the themes, the commands table, and the
  "v6 compatibility" note.
- `CHANGELOG.md` gets `[3.0.0]` with Added/Changed sections; `engines.vscode` bump is a
  breaking change and is listed.
- `CONTRIBUTING.md` documents the directory layout, `npm run watch`, F5 debugging,
  the scrape script and the manual checklist.
- Marketplace categories add "Themes" and "Linters". Keywords add "completion",
  "hover", "themes".
- Version 3.0.0 released through the existing tag-triggered workflow.

## 10. Privacy, robustness, performance

- Nothing leaves the machine unless `pinescript.libraries.remote` (import prefix and
  library ids only) or `pinescript.diagnostics.remote` (full document text) is on.
  The latter is off by default and described in README and in the setting description.
- The endpoints are undocumented. Every remote path degrades to "feature silently
  unavailable" and logs to the output channel. The extension must keep working fully
  offline.
- `untrustedWorkspaces.supported: true` and `virtualWorkspaces: limited` (local
  library discovery needs `file` URIs; everything else works).
- Activation budget: under 100 ms on a warm machine; reference data parsed lazily on
  first provider call. Document models are cached per version; completion and hover run
  synchronously on cached models.
