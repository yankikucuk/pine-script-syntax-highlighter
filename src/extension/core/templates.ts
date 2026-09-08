/** The three script kinds the New File commands can start from. */
export type TemplateKind = 'indicator' | 'strategy' | 'library';

/** A ready-to-edit v6 script of the given kind. */
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
