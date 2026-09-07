import { describe, expect, it } from 'vitest';
import { completionContext } from '../../src/extension/core/context';
import { tokenize } from '../../src/extension/core/tokenizer';

const ctx = (text: string) => {
  const lines = text.split('\n');
  const line = lines.length - 1;
  return completionContext(tokenize(text), lines[line]!, line, lines[line]!.length);
};

describe('completionContext', () => {
  it('is silent inside strings and plain comments', () => {
    expect(ctx('x = "ab')).toEqual({ kind: 'none' });
    expect(ctx('// hello wo')).toEqual({ kind: 'none' });
  });

  it('detects annotations', () => {
    expect(ctx('//@par')).toEqual({ kind: 'annotation', prefix: 'par' });
    expect(ctx('// @')).toEqual({ kind: 'annotation', prefix: '' });
  });

  it('detects import paths', () => {
    expect(ctx('import Trad')).toEqual({ kind: 'import-path', prefix: 'Trad' });
    expect(ctx('import TradingView/ta/')).toEqual({ kind: 'import-path', prefix: 'TradingView/ta/' });
    expect(ctx('import TradingView/ta/14 as ')).toEqual({ kind: 'none' });
  });

  it('detects member access', () => {
    expect(ctx('x = ta.')).toEqual({ kind: 'member', receiver: 'ta', prefix: '' });
    expect(ctx('x = ta.sm')).toEqual({ kind: 'member', receiver: 'ta', prefix: 'sm' });
    expect(ctx('chart.point.')).toEqual({ kind: 'member', receiver: 'chart.point', prefix: '' });
  });

  it('detects named-argument position inside calls', () => {
    expect(ctx('plot(close, ')).toMatchObject({ kind: 'named-arg', prefix: '', call: { name: 'plot', argIndex: 1 } });
    expect(ctx('plot(close, ti')).toMatchObject({ kind: 'named-arg', prefix: 'ti' });
    expect(ctx('plot(close, title = ')).toEqual({ kind: 'identifier', prefix: '' });
  });

  it('falls back to identifiers', () => {
    expect(ctx('x = clo')).toEqual({ kind: 'identifier', prefix: 'clo' });
    expect(ctx('')).toEqual({ kind: 'identifier', prefix: '' });
  });
});
