import { describe, expect, it } from 'vitest';
import { ReferenceIndex, loadReference } from '../../src/extension/core/reference';

describe('ReferenceIndex', () => {
  const ref = loadReference();

  it('finds a function with its overloads', () => {
    const e = ref.get('ta.sma');
    expect(e?.kind).toBe('function');
    expect(e?.overloads[0]?.params.map((p) => p.name)).toEqual(['source', 'length']);
    expect(e?.overloads[0]?.returns?.type).toBe('series float');
  });

  it('prefers the function when a name is both function and variable', () => {
    expect(ref.get('time')?.kind).toBe('function');
    expect(ref.get('time', 'variable')?.kind).toBe('variable');
    expect(
      ref
        .getAll('time')
        .map((e) => e.kind)
        .sort(),
    ).toEqual(['function', 'variable']);
  });

  it('lists namespace members and child namespaces', () => {
    expect(ref.members('ta').some((e) => e.name === 'ta.ema')).toBe(true);
    expect(ref.members('ta').every((e) => e.namespace === 'ta')).toBe(true);
    expect(ref.childNamespaces('chart')).toContain('point');
    expect(ref.childNamespaces('')).toContain('ta');
    expect(ref.childNamespaces('')).not.toContain('');
  });

  it('exposes bare built-ins and urls', () => {
    expect(ref.bare().some((e) => e.name === 'close')).toBe(true);
    expect(ref.url(ref.get('close')!)).toBe('https://www.tradingview.com/pine-script-reference/v6/#var_close');
  });

  it('strips qualifiers from types', () => {
    expect(ReferenceIndex.baseType('series float')).toBe('float');
    expect(ReferenceIndex.baseType('series int/float')).toBe('float');
    expect(ReferenceIndex.baseType('const string')).toBe('string');
    expect(ReferenceIndex.baseType('array<float>')).toBe('array<float>');
  });
});
