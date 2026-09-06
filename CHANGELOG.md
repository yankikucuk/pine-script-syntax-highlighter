# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/compare/v1.0.5...v2.0.0
[1.0.5]: https://github.com/yankikucuk/pine-script-syntax-highlighter/releases/tag/v1.0.5
[1.0.0]: https://github.com/yankikucuk/pine-script-syntax-highlighter/releases/tag/v1.0.0
