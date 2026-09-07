import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import { loadReference } from '../../src/extension/core/reference';
import { inferType, planTypeAnnotations } from '../../src/extension/core/type-inference';

const ref = loadReference();
const scopeFor = (text: string, line = 99) => ({ ref, model: buildModel(text), line });

describe('inferType', () => {
  const s = scopeFor('');
  it.each([
    ['1', 'int'],
    ['1.5', 'float'],
    ['"x"', 'string'],
    ['true', 'bool'],
    ['#ff0000', 'color'],
    ['na', null],
    ['close', 'float'],
    ['bar_index', 'int'],
    ['color.red', 'color'],
    ['ta.sma(close, 14)', 'float'],
    ['input.int(14)', 'int'],
    ['input.string("a")', 'string'],
    ['input.source(close)', 'float'],
    ['label.new(bar_index, high)', 'label'],
    ['array.new<float>()', 'array<float>'],
    ['close > open', 'bool'],
    ['a and b', 'bool'],
    ['not x', 'bool'],
    ['1 + 2', 'int'],
    ['1 + 2.0', 'float'],
    ['"a" + str.tostring(1)', 'string'],
    ['close > open ? 1 : 0', 'int'],
    ['close > open ? 1 : 0.5', 'float'],
    ['close > open ? 1 : "x"', null],
    ['unknown_fn(1)', null],
  ])('%s → %s', (expr, expected) => {
    expect(inferType(expr, s)).toBe(expected);
  });

  it('uses declared types of earlier variables and user types', () => {
    const text = 'type Point\n    float x\nfloat a = 1\np = Point.new(1)\nb = a * 2\n';
    const s = scopeFor(text, 4);
    expect(inferType('a', s)).toBe('float');
    expect(inferType('Point.new(1)', s)).toBe('Point');
    expect(inferType('a + p.x', s)).toBe(null); // field access is not inferred
  });

  it('prefers compiler-provided types', () => {
    const model = buildModel('x = mystery()');
    const compilerTypes = new Map([['x', 'series string']]);
    expect(inferType('mystery()', { ref, model, line: 0, compilerTypes })).toBe(null);
    const plan = planTypeAnnotations(model, ref, null, compilerTypes);
    expect(plan.edits).toEqual([{ line: 0, column: 0, insert: 'string ' }]);
  });
});

describe('planTypeAnnotations', () => {
  it('annotates inferable declarations and reports the rest', () => {
    const text = 'length = input.int(14)\nvar acc = 0.0\nfloat done = 1\nsrc = close\nweird = foo(1)\n';
    const plan = planTypeAnnotations(buildModel(text), ref, null);
    expect(plan.edits).toEqual([
      { line: 0, column: 0, insert: 'int ' },
      { line: 1, column: 4, insert: 'float ' },
      { line: 3, column: 0, insert: 'float ' },
    ]);
    expect(plan.skipped).toEqual(['weird']);
  });

  it('respects a line range', () => {
    const text = 'a = 1\nb = 2\nc = 3\n';
    const plan = planTypeAnnotations(buildModel(text), ref, [1, 1]);
    expect(plan.edits.map((e) => e.line)).toEqual([1]);
  });
});
