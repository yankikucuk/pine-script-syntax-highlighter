# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.2.0] - 2026-09-08

### Added

- A formatter behind **Format Document** and **Format Selection**. It indents local blocks with the four spaces the compiler requires, repairs two space and mixed tab indentation, keeps wrapped lines aligned while moving them off a block indent, spaces operators and arguments, and leaves strings, comments and import paths untouched. Lines are never joined or split.
- `pinescript.format.enabled`, and `editor.defaultFormatter` for `[pinescript]`, so formatting works without picking a formatter.
- Quick fixes on compiler diagnostics: move a v4 built-in into its namespace, rename `study` to `indicator`, correct a misspelt name against the reference or the document, correct or remove a named argument, add the type keyword an `na` initialiser needs, widen a declared type, rename a variable that shadows a built-in throughout the file, and add a missing `//@version=6`.
- Tests for the formatter and the quick fixes, and a check that every snippet and fixture survives a formatting round trip unchanged.

### Changed

- Compiler diagnostics keep the placeholder values the compiler sends, which is what the quick fixes read.

## [3.1.0] - 2026-09-08

### Added

- 78 new snippets, for a total of 97. They cover script headers and full `indicator()` / `strategy()` declarations, library `import` / `export`, tuples, types with methods, enums with `input.enum()`, `var` / `varip`, condition `switch`, stepped and breaking loops, `runtime.error()` and `log.*()`; section, divider, notes, date and TODO comments plus `//@` documentation blocks; every `input.*()` function, inline and grouped inputs; `plotshape`, `plotchar`, `plotarrow`, `plotcandle`, `plotbar`, `bgcolor`, `barcolor`, `hline`, band fills, gradient plots, labels, lines, boxes, tables, polylines and a debug label; `alert()` with plain and JSON messages; higher timeframe tuples, non-repainting `request.security()`, `request.security_lower_tf()`, a security wrapper, sessions, timeframe changes, backtest windows and last-bar blocks; strategy orders, position flags, percent stop loss / take profit and an ATR trailing stop; crossover signals, a selectable moving average, Bollinger Bands, RSI with bands, ATR stops and breakout levels; arrays, maps and matrices.
- A test that checks every snippet for unique prefixes, well-formed placeholders and v6 pragmas.

### Changed

- The function tuple snippet no longer suggests names that shadow built-in variables.
- README documents the snippet catalogue and walks through the editor features in more detail.

## [3.0.0] - 2026-09-07

The extension becomes a full language extension. Highlighting is unchanged; everything below is new.

### Added

- Completion for built-ins, keywords, types, user symbols, named arguments, annotations and import paths, with documentation and signatures.
- Hover documentation for built-ins, user functions, types, enums, variables and imports.
- Signature help with overloads and named-argument awareness.
- Document outline (functions, methods, types, enums, top-level variables).
- Workspace library indexing and published TradingView library lookup for `import` completion and hover.
- Opt-in diagnostics from the TradingView compiler (`pinescript.diagnostics.remote`, off by default).
- Commands: New Indicator, New Strategy, New Library, Generate Docstring (with a code action), Add Type Annotations, Open Reference.
- Pine Dark and Pine Light color themes.
- `src/data/reference.json`, generated from the v6 reference, and a build check that keeps it in step with the grammar data.

### Changed

- Minimum VS Code version is 1.96.
- The package now ships a bundled extension entry point (`dist/extension.cjs`) built with esbuild.
- `npm run build` builds both the grammar and the extension; grammar-only scripts are `build:grammar` and `build:grammar:check`.
- `line.set_xy` was removed from the grammar data; it is not part of Pine Script v6.

## [2.0.1] - 2026-09-06

### Fixed

- README badges for Marketplace version, installs and rating. The shields.io Marketplace badges were retired and rendered as "retired badge".

## [2.0.0] - 2026-09-06

Complete rewrite targeting Pine Script v6. The grammar is now generated from data files, so keeping up with new built-ins is a one-line change.

### Added

- Full Pine Script v6 vocabulary extracted from the official language reference: 470+ built-in functions, 160+ built-in variables and 230+ constants across every namespace (`ta`, `math`, `str`, `array`, `matrix`, `map`, `request`, `strategy`, `input`, `label`, `line`, `box`, `table`, `polyline`, `linefill`, `log`, `runtime`, `chart`, `ticker`, `timeframe`, `syminfo`, `barstate`, `session`, `dividends`, `earnings`, `splits`, `footprint`, `volume_row`, and more).
- Keywords introduced since v4: `switch`, `while`, `once`, `for ... in`, `method`, `type`, `enum`, `import`, `export`, `varip`, and the `to` / `by` / `in` loop keywords.
- Type qualifiers (`series`, `simple`, `const`, `input`), built-in types and generics (`array<float>`, `map<string, Point>`, `matrix<int>`).
- Compiler annotations inside comments: `//@version=6`, `//@description`, `//@function`, `//@param`, `//@returns`, `//@type`, `//@field`, `//@variable`, `//@enum`, `//@strategy_alert_message`. Backtick spans inside doc comments are highlighted as inline code.
- Triple-quoted multiline strings (`"""..."""`, `'''...'''`) added in Pine v6.
- `str.format` placeholders (`{0}`, `{1,number,#.##}`) inside strings.
- Floating point and exponent literals, hex colors with alpha (`#RRGGBBAA`).
- User-defined function and method definitions, named arguments (`length = 14`), tuple destructuring (`[a, b] = f()`), user-defined type constructors (`Point.new()`), `import user/lib/1 as alias`.
- Snippets for indicators, strategies, libraries, functions, methods, types, enums, control flow and common built-in calls.
- Language configuration: indentation-based folding, `// region` markers, auto-closing for both quote styles, indentation rules for `=>` blocks and control structures, four-space defaults for `.pine` files.
- `.pinescript` file extension and first-line detection via `//@version=`.
- Grammar build pipeline (`npm run build`), scope assertion tests and snapshot tests (`npm test`), Prettier formatting, GitHub Actions CI and a tag-triggered release workflow.

### Changed

- Minimum VS Code version raised from 1.37 to 1.90.
- Scope names now follow TextMate conventions consistently: `support.function`, `support.variable`, `support.constant`, `support.class` (namespaces), `support.type`, `storage.modifier`, `entity.name.function`, `entity.name.type`, `variable.parameter`.
- Repository, homepage and issue tracker URLs updated to `github.com/yankikucuk/pine-script-syntax-highlighter`.
- Marketplace categories corrected to `Programming Languages` and `Snippets`.

### Fixed

- Hex colors used the misspelled scope `contstant.other.pine`, so no theme colored them.
- `acros` in the built-in function list was a typo for `acos`.
- Only integer literals were recognized; `1.5` and `2e3` were split into several tokens.
- Unterminated single-line strings no longer bleed into the rest of the file.
- The `bugs` field was nested inside `repository` in `package.json` and the repository URL pointed to a misspelled path.
- Trailing comma in `language-configuration.json` made it invalid JSON.
- Short, common words (`n`, `tr`, `len`, `period`) were highlighted as constants even when used as user variables.

### Removed

- Pine v3 era identifiers that no longer exist in v6 (`study`, `security`, `tickerid`, `input.resolution`, bare `sma`, `ema`, `rsi` and friends). Use the namespaced v6 equivalents.

## [1.0.5] - 2020-05-06

### Added

- `:=` reassignment operator and variable declarations.

## [1.0.0] - 2019-08-25

### Added

- Language operators, built-in variables and built-in functions for Pine Script v3/v4.

[Unreleased]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v2.0.1...v3.0.0
[2.0.1]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v1.0.5...v2.0.0
[1.0.5]: https://github.com/yankikucuk/pine-script-syntax-highlighter/releases/tag/v1.0.5
[1.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/releases/tag/v1.0.0
