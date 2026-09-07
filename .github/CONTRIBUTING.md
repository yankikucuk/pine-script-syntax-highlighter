# Contributing

Thanks for helping keep Pine Script highlighting accurate. This document covers the workflow; the README explains how the grammar is put together.

## Setup

```sh
git clone https://github.com/yankikucuk/pine-script-syntax-highlighter.git
cd pine-script-syntax-highlighter
npm install
npm test
```

Node 20 or newer is required.

## Where things live

| Change you want to make                 | Edit this                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Add or remove a built-in function       | `src/data/functions.json`                                                                                 |
| Add or remove a built-in variable       | `src/data/variables.json`                                                                                 |
| Add or remove a built-in constant       | `src/data/constants.json`                                                                                 |
| Add a compiler annotation (`//@...`)    | `src/data/annotations.json`                                                                               |
| Add a keyword, type or change a scope   | `src/grammar.mjs`                                                                                         |
| Change folding, brackets or indentation | `language-configuration.json`                                                                             |
| Add a snippet                           | `snippets/pinescript.code-snippets`                                                                       |
| Completion, hover, commands, inference  | `src/extension/core/*` (logic) and `src/extension/providers/*`, `src/extension/commands/*` (VS Code glue) |
| Change a theme color                    | `themes/*.json`                                                                                           |
| Never                                   | `syntaxes/pinescript.tmLanguage.json`, `src/data/reference.json`, `dist/` (generated)                     |

The data files are grouped by namespace. A function `ta.sma` goes under the `"ta"` key as `"sma"`. Identifiers without a namespace go under the `""` key. Nested namespaces such as `strategy.closedtrades` are their own key.

`src/extension/core` never imports `vscode`; that is what makes it testable with vitest. Providers and commands only translate between VS Code types and core types.

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
- Hover on `close`, `ta.sma`, a user function, an import line
- Signature help through all parameters of `plot(`
- Outline shows functions, types, enums, variables
- Generate Docstring on a function, a type and an enum
- Add Type Annotations on `tests/snapshots/strategy-v6.pine`
- Both themes on `tests/snapshots/strategy-v6.pine`
- With `pinescript.diagnostics.remote` on: an undeclared identifier is underlined

## Releasing

Maintainers only.

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Commit, then tag: `git tag v3.x.y && git push --tags`.
3. The release workflow builds the `.vsix`, attaches it to a GitHub release and publishes to the Marketplace when the `VSCE_PAT` secret is configured.
