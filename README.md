<h1 align="center">
  <br>
  <img src="images/pinescript.png" alt="Pine Script" width="96">
  <br>
  Pine Script Syntax Highlighter
  <br>
</h1>

<h4 align="center">Syntax highlighting, snippets and editor support for TradingView Pine Script® v6 in Visual Studio Code.</h4>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=ex-codes.pine-script-syntax-highlighter"><img src="https://vsmarketplacebadges.dev/version-short/ex-codes.pine-script-syntax-highlighter.svg?style=flat-square&label=marketplace&color=blue" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ex-codes.pine-script-syntax-highlighter"><img src="https://vsmarketplacebadges.dev/installs-short/ex-codes.pine-script-syntax-highlighter.svg?style=flat-square&color=green" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ex-codes.pine-script-syntax-highlighter&ssr=false#review-details"><img src="https://vsmarketplacebadges.dev/rating-short/ex-codes.pine-script-syntax-highlighter.svg?style=flat-square&color=orange" alt="Rating"></a>
  <a href="https://github.com/yankikucuk/pine-script-syntax-highlighter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yankikucuk/pine-script-syntax-highlighter/ci.yml?style=flat-square&label=ci" alt="CI"></a>
  <a href="https://github.com/yankikucuk/pine-script-syntax-highlighter/issues"><img src="https://img.shields.io/github/issues/yankikucuk/pine-script-syntax-highlighter?style=flat-square" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/yankikucuk/pine-script-syntax-highlighter?style=flat-square" alt="License"></a>
</p>

![Example](images/example.png)

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

| Command                           | What it does                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pine Script: New Indicator        | Opens an untitled document from the indicator template                                                                           |
| Pine Script: New Strategy         | Opens an untitled document from the strategy template                                                                            |
| Pine Script: New Library          | Opens an untitled document from the library template                                                                             |
| Pine Script: Generate Docstring   | Inserts or completes `//@function`, `//@param`, `//@returns`, `//@type`, `//@field`, `//@enum` for the declaration at the cursor |
| Pine Script: Add Type Annotations | Prefixes untyped declarations with their inferred type in the selection or the whole file                                        |
| Pine Script: Open Reference       | Opens the v6 reference at the built-in under the cursor                                                                          |

## Settings

| Setting                              | Default     | Meaning                                                                      |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| `pinescript.completion.enabled`      | `true`      | Completion provider                                                          |
| `pinescript.hover.enabled`           | `true`      | Hover provider                                                               |
| `pinescript.signatureHelp.enabled`   | `true`      | Parameter hints                                                              |
| `pinescript.libraries.local.include` | `**/*.pine` | Glob for workspace library discovery                                         |
| `pinescript.libraries.remote`        | `true`      | Look up published libraries on TradingView for `import` completion and hover |
| `pinescript.diagnostics.remote`      | `false`     | Send the document to the TradingView compiler for diagnostics                |

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
  core/                 vitest suites for src/extension
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
npm test             # grammar and theme checks, type check, core and grammar tests
npm run package      # build the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded. Use **Developer: Inspect Editor Tokens and Scopes** to see which scope a token receives.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the pull request checklist and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © Yankı Küçük

Pine Script® is a registered trademark of TradingView, Inc. This project is not affiliated with TradingView.
