import { describe, expect, it } from 'vitest';
import { enclosingCall } from '../../src/extension/core/call-resolver';
import { tokenize } from '../../src/extension/core/tokenizer';

const at = (text: string) => {
  const lines = text.split('\n');
  const line = lines.length - 1;
  const col = lines[line]!.length;
  return enclosingCall(tokenize(text), line, col);
};

describe('enclosingCall', () => {
  it('finds the callee and argument index', () => {
    expect(at('plot(close, ')).toMatchObject({ name: 'plot', argIndex: 1, namedArg: null });
    expect(at('plot(ta.sma(close, ')).toMatchObject({ name: 'ta.sma', argIndex: 1 });
    expect(at('plot(ta.sma(close, 14), ')).toMatchObject({ name: 'plot', argIndex: 1 });
  });

  it('detects named arguments and remembers used ones', () => {
    expect(at('plot(close, title = "x", color = ')).toMatchObject({
      name: 'plot',
      argIndex: 2,
      namedArg: 'color',
      usedNamedArgs: ['title', 'color'],
    });
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
