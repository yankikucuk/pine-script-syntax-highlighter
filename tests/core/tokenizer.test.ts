import { describe, expect, it } from 'vitest';
import { isInStringOrComment, tokenAt, tokenize, wordAt } from '../../src/extension/core/tokenizer';

const kinds = (line: string) =>
  tokenize(line)[0]!
    .tokens.filter((t) => t.kind !== 'ws')
    .map((t) => `${t.kind}:${t.text}`);

describe('tokenize', () => {
  it('splits a plot call', () => {
    expect(kinds('plot(ta.sma(close, 14), color = #ff0000aa)')).toEqual([
      'ident:plot',
      'open:(',
      'ident:ta.sma',
      'open:(',
      'ident:close',
      'comma:,',
      'number:14',
      'close:)',
      'comma:,',
      'ident:color',
      'op:=',
      'number:#ff0000aa',
      'close:)',
    ]);
  });

  it('keeps strings and comments whole', () => {
    expect(kinds('x = "a // not comment" // real')).toEqual([
      'ident:x',
      'op:=',
      'string:"a // not comment"',
      'comment:// real',
    ]);
    expect(kinds("s = 'it\\'s'")).toEqual(['ident:s', 'op:=', "string:'it\\'s'"]);
  });

  it('carries triple-quoted strings across lines', () => {
    const lines = tokenize('t = """first\nsecond""" + x');
    expect(lines[0]!.tokens.at(-1)?.kind).toBe('string');
    expect(lines[0]!.continuesString).toBe(true);
    expect(lines[1]!.tokens.map((t) => t.kind)).toEqual(['string', 'ws', 'op', 'ws', 'ident']);
  });

  it('tracks bracket depth across lines', () => {
    const lines = tokenize('f(a,\n  b)\nc = 1');
    expect(lines.map((l) => l.depthAtStart)).toEqual([0, 1, 0]);
  });

  it('recognizes multi-character operators', () => {
    expect(kinds('a := b == c ? d => e')).toEqual([
      'ident:a',
      'op::=',
      'ident:b',
      'op:==',
      'ident:c',
      'op:?',
      'ident:d',
      'op:=>',
      'ident:e',
    ]);
  });

  it('tells strings and comments apart from code', () => {
    const line = tokenize('x = "abc" // c')[0]!;
    expect(isInStringOrComment(line, 0)).toBe(false);
    expect(isInStringOrComment(line, 6)).toBe(true);
    expect(isInStringOrComment(line, 12)).toBe(true);
  });

  it('finds tokens and words at a column', () => {
    const line = tokenize('ta.sma(close)')[0]!;
    expect(tokenAt(line.tokens, 3)?.text).toBe('ta.sma');
    expect(tokenAt(line.tokens, 6)?.text).toBe('ta.sma');
    expect(wordAt('ta.sma(close)', 4)).toEqual({ text: 'ta.sma', start: 0, end: 6 });
    expect(wordAt('ta.sma(close)', 9)).toEqual({ text: 'close', start: 7, end: 12 });
    expect(wordAt('ta.sma(close)', 6)).toEqual({ text: 'ta.sma', start: 0, end: 6 });
  });
});
