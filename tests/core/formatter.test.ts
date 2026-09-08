import { describe, expect, it } from 'vitest';

import { formatDocument, formatRange } from '../../src/extension/core/formatter';

const format = (text: string): string => formatDocument(text);

describe('formatter: indentation', () => {
  it('rewrites a two space block to the four spaces Pine requires', () => {
    expect(format('//@version=6\nif close > open\n  x = 1\n')).toBe('//@version=6\nif close > open\n    x = 1\n');
  });

  it('rewrites tabs to four spaces per level', () => {
    expect(format('if a\n\tif b\n\t\tx = 1\n')).toBe('if a\n    if b\n        x = 1\n');
  });

  it('keeps nested blocks and dedents at the right level', () => {
    const input = 'if a\n    if b\n        x = 1\n    y = 2\nz = 3\n';
    expect(format(input)).toBe(input);
  });

  it('normalises an over indented block to a single level', () => {
    expect(format('if a\n        x = 1\n')).toBe('if a\n    x = 1\n');
  });

  it('indents switch cases and their bodies', () => {
    const input = 'x = switch kind\n  "a" => 1\n  =>\n    2\n';
    expect(format(input)).toBe('x = switch kind\n    "a" => 1\n    =>\n        2\n');
  });

  it('indents the body of a function declaration', () => {
    expect(format('f(x) =>\n  x * 2\n')).toBe('f(x) =>\n    x * 2\n');
  });

  it('indents type fields and enum members', () => {
    expect(format('type Point\n  float x\n  float y\n')).toBe('type Point\n    float x\n    float y\n');
    expect(format('enum Mode\n  fast = "F"\n')).toBe('enum Mode\n    fast = "F"\n');
  });

  it('indents with tabs when asked to', () => {
    expect(formatDocument('if a\n  x = 1\n', { useTabs: true })).toBe('if a\n\tx = 1\n');
  });
});

describe('formatter: wrapped lines', () => {
  it('leaves a bracketed continuation where the author aligned it', () => {
    const input = 'plot(close,\n     color = color.red)\n';
    expect(format(input)).toBe(input);
  });

  it('keeps a bracketed continuation inside a block relative to its statement', () => {
    const input = 'if a\n  f(close,\n       open)\n';
    expect(format(input)).toBe('if a\n    f(close,\n         open)\n');
  });

  it('never lets an unbracketed continuation land on a block indent', () => {
    const out = format('x = close\n     + open\n');
    expect(out).toBe('x = close\n     + open\n');
    for (const line of out.split('\n').slice(1, 2)) expect(line.search(/\S/) % 4).not.toBe(0);
  });

  it('repairs a wrapped line the compiler would read as a block', () => {
    // Pine rejects a wrapped line indented by a multiple of four; the formatter shifts it off.
    expect(format('x = close +\n    open\n')).toBe('x = close +\n     open\n');
  });

  it('keeps a unary sign at the start of a wrapped argument list', () => {
    const input = 'f(close,\n  -1)\n';
    expect(format(input)).toBe(input);
  });

  it('does not mistake a block body for a continuation', () => {
    expect(format('for i = 0 to 9\n  x := i\n')).toBe('for i = 0 to 9\n    x := i\n');
  });
});

describe('formatter: spacing', () => {
  const line = (text: string): string => format(text).trimEnd();

  it('puts single spaces around binary operators', () => {
    expect(line('x=a+b*c')).toBe('x = a + b * c');
    expect(line('x   =   a   ==   b')).toBe('x = a == b');
    expect(line('x:=a>=b')).toBe('x := a >= b');
  });

  it('keeps unary signs attached to their operand', () => {
    expect(line('x = -1')).toBe('x = -1');
    expect(line('x = a * -1')).toBe('x = a * -1');
    expect(line('x = f(-1, -2)')).toBe('x = f(-1, -2)');
    expect(line('x = (-1)')).toBe('x = (-1)');
    expect(line('x = a - -b')).toBe('x = a - -b');
  });

  it('spaces commas and calls the usual way', () => {
    expect(line('plot( close ,  open )')).toBe('plot(close, open)');
    expect(line('x = ta.sma( close,14 )')).toBe('x = ta.sma(close, 14)');
  });

  it('leaves history references and field access tight', () => {
    expect(line('x = close [1]')).toBe('x = close[1]');
    expect(line('x = f(a) [1]')).toBe('x = f(a)[1]');
  });

  it('separates a control keyword from its parenthesis', () => {
    expect(line('if(close > open)')).toBe('if (close > open)');
    expect(line('x = not(a)')).toBe('x = not (a)');
  });

  it('does not separate a conversion function from its parenthesis', () => {
    expect(line('x = float(close)')).toBe('x = float(close)');
    expect(line('x = na(close)')).toBe('x = na(close)');
  });

  it('spaces a ternary and an arrow', () => {
    expect(line('x=a?b:c')).toBe('x = a ? b : c');
    expect(line('f(x)=>x')).toBe('f(x) => x');
  });

  it('keeps type parameters tight and comparisons spaced', () => {
    expect(line('a = array.new<float>()')).toBe('a = array.new<float>()');
    expect(line('var array<float> v = na')).toBe('var array<float> v = na');
    expect(line('m = map.new<string,float>()')).toBe('m = map.new<string, float>()');
    expect(line('b = matrix.new<array<int>>(2, 2)')).toBe('b = matrix.new<array<int>>(2, 2)');
    expect(line('c = a<b')).toBe('c = a < b');
    expect(line('d = array.size(x)<5')).toBe('d = array.size(x) < 5');
  });

  it('keeps an import path together', () => {
    expect(line('import someone/utils/3 as u')).toBe('import someone/utils/3 as u');
    expect(line('import  someone/utils/3  as  u')).toBe('import someone/utils/3 as u');
  });

  it('still spaces division outside an import', () => {
    expect(line('x = a/b')).toBe('x = a / b');
  });

  it('collapses padding used to align assignments', () => {
    expect(line('int   wins  = 0')).toBe('int wins = 0');
  });

  it('leaves string and comment contents alone', () => {
    expect(line('x = "a  +  b"')).toBe('x = "a  +  b"');
    expect(line('//@version=6')).toBe('//@version=6');
    expect(line('//   spaced   comment')).toBe('//   spaced   comment');
  });

  it('keeps the gap before a trailing comment', () => {
    expect(line('x = 1    // note')).toBe('x = 1    // note');
    expect(line('x = 1// note')).toBe('x = 1 // note');
  });

  it('preserves a multi line string exactly', () => {
    const input = 'x = """\n  keep   this\n"""\n';
    expect(format(input)).toBe(input);
  });
});

describe('formatter: whitespace hygiene', () => {
  it('strips trailing whitespace and adds a final newline', () => {
    expect(format('x = 1   \ny = 2')).toBe('x = 1\ny = 2\n');
  });

  it('collapses long runs of blank lines and trims the edges', () => {
    expect(format('\n\nx = 1\n\n\n\n\ny = 2\n\n\n')).toBe('x = 1\n\n\ny = 2\n');
  });

  it('keeps blank lines inside a multi line string', () => {
    const input = 'x = """\n\n\n\n\n"""\n';
    expect(format(input)).toBe(input);
  });

  it('keeps windows line endings', () => {
    expect(format('x=1\r\ny=2\r\n')).toBe('x = 1\r\ny = 2\r\n');
  });
});

describe('formatter: comments', () => {
  it('moves a comment down to the block it introduces', () => {
    expect(format('if a\n// note\n    x = 1\n')).toBe('if a\n    // note\n    x = 1\n');
  });

  it('leaves a section comment at the top level', () => {
    const input = '// Inputs\nlength = input.int(14)\n';
    expect(format(input)).toBe(input);
  });

  it('keeps a trailing comment inside the block it was written in', () => {
    const input = 'if a\n    x = 1\n    // end of block\ny = 2\n';
    expect(format(input)).toBe(input);
  });
});

describe('formatter: whole documents', () => {
  const script = [
    '//@version=6',
    'indicator("Demo",overlay=true)',
    '',
    'length=input.int(14,"Length",minval=1)',
    'src   = input.source(close,"Source")',
    '',
    'ma(source,len)=>',
    '  ta.sma(source,len)',
    '',
    'value=ma(src,length)',
    'if value>close',
    '  label.new(bar_index,high,"up")',
    '',
    'plot(value,"MA",color=color.blue)',
  ].join('\n');

  it('formats a whole script', () => {
    expect(format(script)).toBe(
      [
        '//@version=6',
        'indicator("Demo", overlay = true)',
        '',
        'length = input.int(14, "Length", minval = 1)',
        'src = input.source(close, "Source")',
        '',
        'ma(source, len) =>',
        '    ta.sma(source, len)',
        '',
        'value = ma(src, length)',
        'if value > close',
        '    label.new(bar_index, high, "up")',
        '',
        'plot(value, "MA", color = color.blue)',
        '',
      ].join('\n'),
    );
  });

  it('is idempotent', () => {
    const once = format(script);
    expect(format(once)).toBe(once);
  });

  it('formats a range without touching the rest', () => {
    expect(formatRange(script, 3, 4)).toBe(
      'length = input.int(14, "Length", minval = 1)\nsrc = input.source(close, "Source")',
    );
  });
});
