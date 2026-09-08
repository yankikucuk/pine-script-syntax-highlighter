import { describe, expect, it } from 'vitest';

import { buildModel } from '../../src/extension/core/document-model';
import { semanticTokens } from '../../src/extension/core/semantic';
import { tokenize } from '../../src/extension/core/tokenizer';

const script = [
  '//@version=6', //                        0
  'import someone/utils/3 as helper', //    1
  'indicator("Demo")', //                   2
  'type Point', //                          3
  '    float price', //                     4
  'enum Regime', //                         5
  '    bull = "Bull"', //                   6
  'length = input.int(14, title = "L")', // 7
  'mean(source) =>', //                     8
  '    ta.sma(source, length)', //          9
  'value = mean(close)', //                10
  'mode = Regime.bull', //                 11
  'plot(value, title = "V")', //           12
  'p = helper.wrap(close)', //             13
].join('\n');

const tokens = semanticTokens({ model: buildModel(script), tokens: tokenize(script) });
const at = (line: number, startCol: number) => tokens.find((t) => t.line === line && t.startCol === startCol);

describe('semantic tokens', () => {
  it('marks the author’s own declarations', () => {
    expect(at(3, 5)).toMatchObject({ kind: 'type', isDeclaration: true });
    expect(at(5, 5)).toMatchObject({ kind: 'enum', isDeclaration: true });
    expect(at(8, 0)).toMatchObject({ kind: 'function', isDeclaration: true });
    expect(at(7, 0)).toMatchObject({ kind: 'variable', isDeclaration: true });
  });

  it('marks fields and enum members', () => {
    expect(at(4, 10)).toMatchObject({ kind: 'property', isDeclaration: true });
    expect(at(6, 4)).toMatchObject({ kind: 'enumMember', isDeclaration: true });
  });

  it('marks a parameter apart from a global of another name', () => {
    expect(at(8, 5)).toMatchObject({ kind: 'parameter', isDeclaration: true });
    expect(at(9, 11)).toMatchObject({ kind: 'parameter', isDeclaration: false });
    expect(at(9, 19)).toMatchObject({ kind: 'variable', isDeclaration: false });
  });

  it('covers a qualified enum member in one token', () => {
    expect(at(11, 7)).toMatchObject({ kind: 'enumMember', length: 11 });
  });

  it('marks an import alias as a namespace and leaves the path alone', () => {
    expect(at(1, 26)).toMatchObject({ kind: 'namespace', isDeclaration: true });
    expect(at(1, 7)).toBeUndefined();
    expect(at(13, 4)).toMatchObject({ kind: 'namespace', length: 6 });
  });

  it('leaves built-ins and named arguments to the grammar', () => {
    expect(at(9, 4)).toBeUndefined(); // ta.sma
    expect(at(12, 0)).toBeUndefined(); // plot
    expect(at(12, 12)).toBeUndefined(); // title =
    expect(at(7, 23)).toBeUndefined(); // title = inside input.int
  });

  it('marks a call to a user function', () => {
    expect(at(10, 8)).toMatchObject({ kind: 'function', isDeclaration: false, length: 4 });
  });
});
