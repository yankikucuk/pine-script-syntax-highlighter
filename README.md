<h1 align="center">
  <br>
  <img src="images/pinescript.png" alt="Pine Script" width="96">
  <br>
  Pine Script Syntax Highlighter
  <br>
</h1>

<h4 align="center">Syntax highlighting, snippets and editor support for TradingView Pine Script® v6 in Visual Studio Code.</h4>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=ex-codes.pine-script-syntax-highlighter"><img src="https://img.shields.io/visual-studio-marketplace/v/ex-codes.pine-script-syntax-highlighter?style=flat-square&label=marketplace" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ex-codes.pine-script-syntax-highlighter"><img src="https://img.shields.io/visual-studio-marketplace/i/ex-codes.pine-script-syntax-highlighter?style=flat-square" alt="Installs"></a>
  <a href="https://github.com/yankikucuk/pine-script-syntax-highlighter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yankikucuk/pine-script-syntax-highlighter/ci.yml?style=flat-square&label=ci" alt="CI"></a>
  <a href="https://github.com/yankikucuk/pine-script-syntax-highlighter/issues"><img src="https://img.shields.io/github/issues/yankikucuk/pine-script-syntax-highlighter?style=flat-square" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/yankikucuk/pine-script-syntax-highlighter?style=flat-square" alt="License"></a>
</p>

![Example](images/example.png)

## Features

- **Pine Script v6 coverage.** Every namespace from the official language reference: `ta`, `math`, `str`, `array`, `matrix`, `map`, `request`, `strategy`, `input`, `label`, `line`, `box`, `table`, `polyline`, `log`, `runtime`, `chart`, `footprint` and the rest. Built-in functions, variables and constants are highlighted with distinct scopes.
- **Modern language constructs.** `switch`, `while`, `once`, `for ... in`, `method`, `type`, `enum`, `import ... as`, `export`, `varip`, type qualifiers (`series`, `simple`, `const`, `input`) and generics such as `array<float>` or `map<string, Point>`.
- **Compiler annotations.** `//@version=6`, `//@description`, `//@function`, `//@param`, `//@returns`, `//@type`, `//@field`, `//@variable`, `//@enum` and `//@strategy_alert_message` are highlighted inside comments.
- **Strings done right.** Single, double and the v6 triple-quoted multiline strings, escape sequences and `str.format` placeholders like `{0,number,#.##}`.
- **Numbers and colors.** Integers, floats, exponents and hex colors with optional alpha (`#RRGGBBAA`).
- **User code.** Function and method definitions, named arguments, tuple destructuring (`[a, b] = f()`), user-defined type constructors (`Point.new()`) and member access.
- **Editor support.** Indentation-based folding, auto-closing quotes and brackets, `// region` / `// endregion` markers, four-space indentation defaults for `.pine` files.
- **Snippets.** `indicator`, `strategy`, `library`, `fn`, `method`, `type`, `enum`, `if`, `switch`, `for`, `forin`, `while`, `once`, `input.int`, `input.float`, `request.security`, `plot`, `alertcondition` and more.

Files ending in `.pine` or `.pinescript`, or starting with `//@version=`, are recognized automatically.

## Recommended companions

- [vscode-icons](https://marketplace.visualstudio.com/items?itemName=vscode-icons-team.vscode-icons) for a `.pine` file icon.
- [One Dark Pro](https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme) for the colors shown in the screenshot.

## How it works

The TextMate grammar in `syntaxes/pinescript.tmLanguage.json` is **generated**. Do not edit it by hand.

```
src/
  grammar.mjs        grammar rules, expressed as data
  data/
    functions.json   built-in functions, grouped by namespace
    variables.json   built-in variables, grouped by namespace
    constants.json   built-in constants, grouped by namespace
    annotations.json compiler annotations
scripts/
  build-grammar.mjs  compiles src/ into syntaxes/pinescript.tmLanguage.json
tests/
  unit/              scope assertions (vscode-tmgrammar-test)
  snapshots/         full-file snapshots (vscode-tmgrammar-snap)
```

The identifier lists are extracted from the [Pine Script v6 reference](https://www.tradingview.com/pine-script-reference/v6/). When TradingView adds a built-in, add it to the matching JSON file, run the build, and the grammar picks it up.

## Development

```sh
git clone https://github.com/yankikucuk/pine-script-syntax-highlighter.git
cd pine-script-syntax-highlighter
npm install
npm run build        # regenerate the grammar
npm test             # grammar freshness + unit + snapshot tests
npm run package      # build the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded. Use **Developer: Inspect Editor Tokens and Scopes** from the command palette to see which scope a token receives.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the pull request checklist and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © Yankı Küçük

Pine Script® is a registered trademark of TradingView, Inc. This project is not affiliated with TradingView.
