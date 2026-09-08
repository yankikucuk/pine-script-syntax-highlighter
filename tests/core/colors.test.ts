import { describe, expect, it } from 'vitest';

import { colorPresentations, findColors, type Rgba } from '../../src/extension/core/colors';
import { loadReference } from '../../src/extension/core/reference';
import { tokenize } from '../../src/extension/core/tokenizer';

const ref = loadReference();
const spots = (text: string) => findColors(tokenize(text), ref);
const hex = (color: Rgba) =>
  [color.red, color.green, color.blue]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase(),
    )
    .join('');

describe('finding colours', () => {
  it('reads a hex literal', () => {
    const [spot] = spots('c = #FF9800');
    expect(spot).toMatchObject({ line: 0, startCol: 4, endCol: 11 });
    expect(hex(spot!.color)).toBe('FF9800');
    expect(spot!.color.alpha).toBe(1);
  });

  it('reads the alpha pair of a hex literal', () => {
    const [spot] = spots('c = #FF980080');
    expect(spot!.color.alpha).toBeCloseTo(128 / 255, 3);
  });

  it('reads a built-in colour constant from the reference', () => {
    const [spot] = spots('plot(close, color = color.red)');
    expect(hex(spot!.color)).toBe('F23645');
    expect(spot).toMatchObject({ startCol: 20, endCol: 29 });
  });

  it('applies the transparency of color.new', () => {
    const [spot] = spots('c = color.new(color.blue, 25)');
    expect(hex(spot!.color)).toBe('2962FF');
    expect(spot!.color.alpha).toBeCloseTo(0.75, 5);
    expect(spot).toMatchObject({ startCol: 4, endCol: 29 });
  });

  it('accepts named arguments in color.new', () => {
    const [spot] = spots('c = color.new(color = color.lime, transp = 50)');
    expect(hex(spot!.color)).toBe('00E676');
    expect(spot!.color.alpha).toBeCloseTo(0.5, 5);
  });

  it('reads color.rgb with and without transparency', () => {
    expect(hex(spots('c = color.rgb(255, 152, 0)')[0]!.color)).toBe('FF9800');
    expect(spots('c = color.rgb(255, 152, 0, 40)')[0]!.color.alpha).toBeCloseTo(0.6, 5);
  });

  it('reports one swatch for a call, not one per argument', () => {
    expect(spots('c = color.new(color.red, 50)')).toHaveLength(1);
  });

  it('falls back to the inner constant when the call is not literal', () => {
    const found = spots('c = color.new(color.red, transparency)');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ startCol: 14, endCol: 23 });
  });

  it('ignores colours inside strings and comments', () => {
    expect(spots('s = "#FF9800" // color.red')).toEqual([]);
  });

  it('finds colours on every line', () => {
    expect(spots('a = #FFFFFF\nb = color.teal').map((s) => s.line)).toEqual([0, 1]);
  });
});

describe('writing a picked colour back', () => {
  it('offers a hex literal and an rgb call', () => {
    expect(colorPresentations({ red: 1, green: 0.596, blue: 0, alpha: 1 })).toEqual([
      '#FF9800',
      'color.rgb(255, 152, 0)',
    ]);
  });

  it('carries transparency into both forms', () => {
    expect(colorPresentations({ red: 1, green: 0, blue: 0, alpha: 0.5 })).toEqual([
      '#FF000080',
      'color.rgb(255, 0, 0, 50)',
    ]);
  });
});
