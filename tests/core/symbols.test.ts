import { describe, expect, it } from 'vitest';

import { buildModel } from '../../src/extension/core/document-model';
import { isUserSymbol, occurrencesOf, resolveSymbolAt, type SymbolSource } from '../../src/extension/core/symbols';
import { tokenize } from '../../src/extension/core/tokenizer';

const script = [
  '//@version=6', //                                             0
  'import someone/utils/3 as helper', //                         1
  'indicator("Demo", overlay = true)', //                        2
  '', //                                                         3
  'type Point', //                                               4
  '    float price', //                                          5
  '    int index', //                                            6
  '', //                                                         7
  'enum Regime', //                                              8
  '    bull = "Bull"', //                                        9
  '    bear = "Bear"', //                                       10
  '', //                                                        11
  'length = input.int(14, title = "Length")', //                12
  'price = close', //                                           13
  '', //                                                        14
  'mean(source, length) =>', //                                 15
  '    ta.sma(source, length)', //                              16
  '', //                                                        17
  'method label(Point this) =>', //                             18
  '    str.tostring(this.price)', //                            19
  '', //                                                        20
  'value = mean(close, length)', //                             21
  'current = Regime.bull', //                                   22
  'plot(value, title = "Value")', //                            23
  'plot(helper.smooth(price), title = "Smoothed")', //          24
].join('\n');

const source: SymbolSource = { model: buildModel(script), tokens: tokenize(script) };
const at = (line: number, column: number) => resolveSymbolAt(source, line, column);
const places = (line: number, column: number) => {
  const target = at(line, column);
  return target ? occurrencesOf(source, target).map((o) => `${o.line}:${o.startCol}`) : null;
};

describe('resolving the symbol under the cursor', () => {
  it('finds a user function at its call site', () => {
    const target = at(21, 8)!;
    expect(target.kind).toBe('function');
    expect(target.declaration).toMatchObject({ line: 15, startCol: 0 });
  });

  it('finds a method declaration', () => {
    expect(at(18, 7)).toMatchObject({ name: 'label', kind: 'method' });
  });

  it('finds a type and an enum', () => {
    expect(at(4, 5)).toMatchObject({ name: 'Point', kind: 'type' });
    expect(at(8, 5)).toMatchObject({ name: 'Regime', kind: 'enum' });
  });

  it('finds an enum member through its qualified name', () => {
    const target = at(22, 17)!;
    expect(target).toMatchObject({ name: 'Regime.bull', kind: 'enumMember' });
    expect(target.declaration).toMatchObject({ line: 9, startCol: 4 });
  });

  it('finds an import alias, not the path around it', () => {
    expect(at(1, 26)).toMatchObject({ name: 'helper', kind: 'import' });
    expect(at(1, 8)).toMatchObject({ kind: 'builtin' });
  });

  it('prefers the parameter over the global of the same name inside a function', () => {
    const target = at(16, 19)!;
    expect(target).toMatchObject({ kind: 'parameter', name: 'length', owner: 'mean' });
    expect(target.scope).toMatchObject({ start: 15 });
  });

  it('treats a built-in as a symbol without a declaration', () => {
    const target = at(21, 13)!;
    expect(target).toMatchObject({ name: 'close', kind: 'builtin', declaration: null });
    expect(isUserSymbol(target)).toBe(false);
  });

  it('resolves a namespaced built-in as a whole', () => {
    expect(at(16, 8)).toMatchObject({ name: 'ta.sma', kind: 'builtin' });
  });

  it('ignores a position that is not an identifier', () => {
    expect(at(23, 11)).toBeNull();
  });
});

describe('finding every occurrence', () => {
  it('collects a function declaration and its calls', () => {
    expect(places(15, 0)).toEqual(['15:0', '21:8']);
  });

  it('keeps a global out of the function that redeclares its name', () => {
    // `length` is global on line 12, but a parameter of `mean`, so lines 15 and 16 are not the global.
    expect(places(12, 0)).toEqual(['12:0', '21:20']);
  });

  it('keeps a parameter inside its own function', () => {
    expect(places(16, 19)).toEqual(['15:13', '16:19']);
  });

  it('skips a named argument that happens to share the name', () => {
    // `price` is a variable and also a field of Point; neither is the `title` argument.
    expect(places(13, 0)).toEqual(['13:0', '24:19']);
  });

  it('skips the field declared inside a type block', () => {
    expect(places(13, 0)).not.toContain('5:10');
  });

  it('rewrites only the first segment of a qualified name', () => {
    expect(places(8, 5)).toEqual(['8:5', '22:10']);
    const target = at(8, 5)!;
    const [, use] = occurrencesOf(source, target);
    expect(use).toMatchObject({ line: 22, startCol: 10, endCol: 16 });
  });

  it('collects an enum member declaration together with its uses', () => {
    expect(places(22, 17)).toEqual(['9:4', '22:10']);
  });

  it('leaves the import path alone while following the alias', () => {
    expect(places(1, 26)).toEqual(['1:26', '24:5']);
  });

  it('finds every use of a built-in in the document', () => {
    expect(places(21, 13)).toEqual(['13:8', '21:13']);
  });
});
