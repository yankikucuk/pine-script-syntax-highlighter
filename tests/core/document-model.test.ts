import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, declarationAt, visibleVariables } from '../../src/extension/core/document-model';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('buildModel on a library', () => {
  const m = buildModel(fixture('library.pine'));

  it('reads the header', () => {
    expect(m.version).toBe(6);
    expect(m.scriptKind).toBe('library');
    expect(m.libraryTitle).toBe('MaHelpers');
  });

  it('parses exported functions with multi-line params and docs', () => {
    const f = m.functions.find((f) => f.name === 'weighted')!;
    expect(f.isExport).toBe(true);
    expect(f.isMethod).toBe(false);
    expect(f.params).toEqual([
      { name: 'a', type: 'float', default: null },
      { name: 'b', type: 'float', default: null },
      { name: 'w', type: 'float', default: '0.5' },
    ]);
    expect(f.docs.function).toBe('Weighted average of two series.');
    expect(f.docs.params.w).toBe('Weight of `a`, between 0 and 1.');
    expect(f.docs.returns).toBe('The weighted average.');
    expect(f.range).toEqual({ start: 9, end: 11 });
    expect(f.lastLine).toBe('a * w + b * (1 - w)');
  });

  it('parses types and enums', () => {
    const t = m.types.find((t) => t.name === 'Level')!;
    expect(t.fields).toEqual([
      { name: 'price', type: 'float', default: null, line: 17 },
      { name: 'name', type: 'string', default: '"level"', line: 18 },
    ]);
    expect(t.docs.fields.price).toBe('The level.');
    const e = m.enums.find((e) => e.name === 'Side')!;
    expect(e.members).toEqual([
      { name: 'long', title: '"Long"', line: 22 },
      { name: 'short', title: null, line: 23 },
    ]);
    expect(e.docs.enum).toBe('Trade direction.');
  });

  it('parses methods and private functions', () => {
    const d = m.functions.find((f) => f.name === 'describe')!;
    expect(d.isMethod).toBe(true);
    expect(d.params[0]).toEqual({ name: 'this', type: 'Level', default: null });
    const i = m.functions.find((f) => f.name === 'internal')!;
    expect(i.isExport).toBe(false);
    expect(i.params).toEqual([{ name: 'x', type: null, default: null }]);
  });

  it('scopes local variables to their function', () => {
    const y = m.variables.find((v) => v.name === 'y')!;
    expect(y.scope).toEqual({ start: 29, end: 30 });
    expect(visibleVariables(m, 30).map((v) => v.name)).toContain('y');
    expect(visibleVariables(m, 3).map((v) => v.name)).not.toContain('y');
  });

  it('finds declarations by header line', () => {
    expect(declarationAt(m, 9)?.name).toBe('weighted');
    expect(declarationAt(m, 10)).toBeNull();
    expect(declarationAt(m, 16)?.kind).toBe('type');
  });
});

describe('buildModel on a consumer script', () => {
  const m = buildModel(fixture('consumer.pine'));

  it('reads imports', () => {
    expect(m.scriptKind).toBe('indicator');
    expect(m.imports).toEqual([
      { owner: 'yankikucuk', name: 'MaHelpers', version: '2', alias: 'ma', line: 2 },
      { owner: 'TradingView', name: 'ta', version: '14', alias: null, line: 3 },
    ]);
  });

  it('reads variable declarations with types, qualifiers and tuples', () => {
    const byName = Object.fromEntries(m.variables.map((v) => [v.name, v]));
    expect(byName.length).toMatchObject({
      declaredType: null,
      qualifier: null,
      initializer: 'input.int(14, "Length")',
    });
    expect(byName.acc).toMatchObject({ declaredType: 'float', qualifier: 'var', initializer: 'na' });
    expect(byName.dc).toMatchObject({ initializer: null });
    expect(byName.up).toMatchObject({ initializer: null });
    expect(byName.fast?.initializer).toBe('ta.ema(src, length)');
  });

  it('does not treat named arguments on continuation lines as variables', () => {
    expect(m.variables.some((v) => v.name === 'color')).toBe(false);
  });
});

describe('buildModel: declaration positions and loop variables', () => {
  it('reports the column of the name, not a letter inside a keyword', () => {
    const m = buildModel('var a = 1\nvarip r = 2\nfloat t = 3\n');
    const byName = Object.fromEntries(m.variables.map((v) => [v.name, v]));
    expect(byName.a?.column).toBe(4);
    expect(byName.r?.column).toBe(6);
    expect(byName.t?.column).toBe(6);
  });

  it('declares the counter of a for loop as an int scoped to the loop', () => {
    const m = buildModel('total = 0\nfor i = 0 to 10\n    total += i\nplot(total)\n');
    const counter = m.variables.find((v) => v.name === 'i')!;
    expect(counter).toMatchObject({ declaredType: 'int', line: 1, column: 4 });
    expect(counter.scope).toEqual({ start: 1, end: 2 });
  });

  it('declares the element, and the index, of a for in loop', () => {
    const single = buildModel('for value in prices\n    x = value\n');
    expect(single.variables.find((v) => v.name === 'value')).toMatchObject({ declaredType: null, column: 4 });

    const pair = buildModel('for [idx, el] in prices\n    x = el\n');
    expect(pair.variables.find((v) => v.name === 'idx')).toMatchObject({ declaredType: 'int', column: 5 });
    expect(pair.variables.find((v) => v.name === 'el')).toMatchObject({ declaredType: null, column: 10 });
  });

  it('keeps a loop scope narrower than the function around it', () => {
    const m = buildModel('f() =>\n    for i = 0 to 2\n        x = i\n    0\n');
    expect(m.variables.find((v) => v.name === 'i')?.scope).toEqual({ start: 1, end: 2 });
  });
});

describe('buildModel: members among comments', () => {
  it('records the line each field and member is written on', () => {
    const m = buildModel(
      [
        'type Point',
        '    // the price',
        '    float price',
        '',
        '    int index',
        'enum Mode',
        '    // fast',
        '    fast = "F"',
      ].join('\n'),
    );
    expect(m.types[0]?.fields.map((f) => f.line)).toEqual([2, 4]);
    expect(m.enums[0]?.members.map((mem) => mem.line)).toEqual([7]);
  });
});
