import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import { annotationBlockRange, docstringLines, needsDocstring } from '../../src/extension/core/docstring';

describe('docstring', () => {
  it('generates a function block', () => {
    const m = buildModel('f(float a, b = 1) =>\n    a + b\n');
    expect(docstringLines(m.functions[0]!, [], '')).toEqual([
      '//@function f ',
      '//@param a ',
      '//@param b ',
      '//@returns ',
    ]);
  });

  it('omits @returns for void bodies', () => {
    const m = buildModel('show(x) =>\n    plot(x)\n');
    expect(docstringLines(m.functions[0]!, [], '')).toEqual(['//@function show ', '//@param x ']);
  });

  it('merges with an existing block, keeping text and order', () => {
    const src = '//@param b Second.\n//@function Adds.\nf(a, b) =>\n    a + b\n';
    const lines = src.split('\n');
    const m = buildModel(src);
    const range = annotationBlockRange(lines, 2);
    expect(range).toEqual({ start: 0, end: 1 });
    expect(docstringLines(m.functions[0]!, lines.slice(0, 2), '')).toEqual([
      '//@function Adds.',
      '//@param a ',
      '//@param b Second.',
      '//@returns ',
    ]);
  });

  it('generates type and enum blocks with indentation', () => {
    const m = buildModel('export type P\n    float x\n    int y = 0\nenum S\n    a = "A"\n    b\n');
    expect(docstringLines(m.types[0]!, [], '')).toEqual(['//@type P ', '//@field x ', '//@field y ']);
    expect(docstringLines(m.enums[0]!, [], '  ')).toEqual(['  //@enum S ', '  //@field a ', '  //@field b ']);
  });

  it('reports whether a symbol still needs docs', () => {
    const documented = buildModel('//@function Adds.\n//@param a A.\n//@returns Sum.\nf(a) =>\n    a\n');
    expect(needsDocstring(documented.functions[0]!)).toBe(false);
    const partial = buildModel('//@function Adds.\nf(a) =>\n    a\n');
    expect(needsDocstring(partial.functions[0]!)).toBe(true);
  });

  it('returns null when there is no block above', () => {
    expect(annotationBlockRange(['x = 1', 'f(a) =>'], 1)).toBeNull();
  });
});
