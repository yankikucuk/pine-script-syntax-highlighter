# Contributing

Thanks for helping keep Pine Script support accurate. This document covers the workflow; the README explains what the extension does and how the pieces fit together.

## Setup

```sh
git clone https://github.com/yankikucuk/pine-script-syntax-highlighter.git
cd pine-script-syntax-highlighter
npm install
npm test
```

Node 20 or newer is required.

## Where things live

| Change you want to make                 | Edit this                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Add or remove a built-in function       | `src/data/functions.json`                                                                                     |
| Add or remove a built-in variable       | `src/data/variables.json`                                                                                     |
| Add or remove a built-in constant       | `src/data/constants.json`                                                                                     |
| Add a compiler annotation (`//@...`)    | `src/data/annotations.json`                                                                                   |
| Add a keyword, type or change a scope   | `src/grammar.mjs`                                                                                             |
| Change folding, brackets or indentation | `language-configuration.json`                                                                                 |
| Add a snippet                           | `snippets/pinescript.code-snippets`                                                                           |
| Completion, hover, commands, inference  | `src/extension/core/*` (logic) and `src/extension/providers/*`, `src/extension/commands/*` (VS Code glue)     |
| Change how a document is formatted      | `src/extension/core/formatter.ts`                                                                             |
| Add or change an offline rule           | `src/extension/core/lint.ts`, and list the rule in the `pinescript.lint.disabledRules` enum in `package.json` |
| Change a quick fix                      | `src/extension/core/quick-fix.ts`                                                                             |
| Definition, references, rename          | `src/extension/core/symbols.ts`                                                                               |
| Colour swatches, semantic tokens        | `src/extension/core/colors.ts`, `src/extension/core/semantic.ts`                                              |
| Change a theme color                    | `themes/*.json` (`tokenColors` for the grammar, `semanticTokenColors` for declared names)                     |
| Never                                   | `syntaxes/pinescript.tmLanguage.json`, `src/data/reference.json`, `dist/` (generated)                         |

The data files are grouped by namespace. A function `ta.sma` goes under the `"ta"` key as `"sma"`. Identifiers without a namespace go under the `""` key. Nested namespaces such as `strategy.closedtrades` are their own key.

`src/extension/core` never imports `vscode`; that is what makes it testable with vitest. Providers and commands only translate between VS Code types and core types.

Everything a provider needs from a document goes through `analyze()` in `src/extension/vscode/document-cache.ts`, which parses each document once per version. Anything that walks every identifier of a file should go through `sourceIndex()` in `src/extension/core/symbols.ts` rather than rescanning the token stream: that is what keeps the offline checks linear instead of quadratic on long scripts.

## Working on the extension

```sh
npm run watch      # rebuild dist/extension.cjs on change
```

Press F5 to launch an Extension Development Host, then reload it after each rebuild. Tests for extension logic go in `tests/core`; `tests/core/fake-vscode.ts` stands in for the `vscode` module so providers can run under vitest too.

## Refreshing the reference data

```sh
npm install --no-save playwright-core
npx playwright-core install chromium
npm run scrape:reference
npm run build:grammar:check   # lists built-ins to add to or remove from src/data/*.json
```

## Workflow

1. Make your change in `src/`.
2. Run `npm run build` to regenerate the grammar.
3. Add or update a test:
   - `tests/core/*.test.ts` for extension logic.
   - `tests/unit/*.pine` for a targeted scope assertion (see the existing files for the syntax; `^` markers under a token followed by the expected scopes).
   - `tests/snapshots/*.pine` for a realistic script. Run `npm run test:snap:update` after intentional changes and review the `.snap` diff.
4. Run `npm test`. CI runs the same command and also fails if the generated grammar is out of date.
5. Run `npm run format`.
6. Open a pull request. Describe what was wrong before and what the highlighting looks like now. A screenshot from **Developer: Inspect Editor Tokens and Scopes** helps.

## Source of truth

Built-in identifiers come from the [Pine Script v6 reference](https://www.tradingview.com/pine-script-reference/v6/). Please link the reference entry when adding one. Identifiers that were removed from the language are removed from the grammar too; we do not keep deprecated v3/v4 names.

## Manual checklist before a release

- Completion after `ta.`, inside `plot(`, after `//@`, after `import `
- Hover on `close`, `ta.sma`, a user function, a function parameter, an import line
- Signature help through all parameters of `plot(`
- Outline shows functions, types with fields, enums with members, top-level variables
- Go to Definition, Find All References and Rename on a user function, a variable and an enum member
- Format Document on a file with two space indentation and on one with wrapped calls
- Colour swatch and picker on `#FF9800`, `color.red` and `color.new(color.blue, 25)`
- Offline checks flag an old pragma and a bare `sma`; Convert to v6 fixes them
- Generate Docstring on a function, a type and an enum
- Add Type Annotations on `tests/snapshots/strategy-v6.pine` and on `var a = 1`
- Both themes on `tests/snapshots/strategy-v6.pine`, with semantic highlighting on
- With `pinescript.diagnostics.remote` on: an undeclared identifier is underlined and the lightbulb offers a fix

## Releasing

Maintainers only.

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Commit, then tag: `git tag -a v3.x.y -m 3.x.y && git push origin v3.x.y`.
3. The release workflow builds the `.vsix`, attaches it to a GitHub release and publishes to the Marketplace when the `VSCE_PAT` secret is configured.
