import { describe, expect, it } from 'vitest';

import type { CompileDiagnostic } from '../../src/extension/core/diagnostics';
import { buildModel } from '../../src/extension/core/document-model';
import { quickFixes, type QuickFix } from '../../src/extension/core/quick-fix';
import { loadReference } from '../../src/extension/core/reference';

const ref = loadReference();

/** Builds the diagnostic the TradingView compiler returns, with the placeholder values it sends. */
function issue(partial: Partial<CompileDiagnostic> & Pick<CompileDiagnostic, 'line' | 'startCol'>): CompileDiagnostic {
  return {
    endCol: partial.startCol,
    message: '',
    severity: 'error',
    code: null,
    ctx: undefined,
    ...partial,
  };
}

function fixesFor(source: string, diagnostic: CompileDiagnostic): QuickFix[] {
  const lines = source.split('\n');
  return quickFixes(diagnostic, lines, buildModel(source), ref);
}

/** Applies one fix to the source so the test can assert on the resulting document. */
function apply(source: string, fix: QuickFix): string {
  const lines = source.split('\n');
  for (const edit of [...fix.edits].sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)) {
    const line = lines[edit.startLine]!;
    lines[edit.startLine] = line.slice(0, edit.startCol) + edit.newText + line.slice(edit.endCol);
  }
  return lines.join('\n');
}

describe('quick fixes: names the compiler does not know', () => {
  it('moves a bare v4 built-in into its namespace', () => {
    const source = '//@version=6\nindicator("t")\nplot(sma(close, 14))';
    const fixes = fixesFor(
      source,
      issue({ line: 2, startCol: 5, code: 'CE10271', ctx: { fullName: 'sma', kind: 'function' } }),
    );
    expect(fixes[0]!.title).toBe('Change to `ta.sma`');
    expect(apply(source, fixes[0]!)).toContain('plot(ta.sma(close, 14))');
  });

  it('renames a function that changed name between versions', () => {
    const source = '//@version=6\nstudy("t")';
    const fixes = fixesFor(source, issue({ line: 1, startCol: 0, code: 'CE10271', ctx: { fullName: 'study' } }));
    expect(fixes[0]!.title).toBe('Change to `indicator`');
    expect(apply(source, fixes[0]!)).toBe('//@version=6\nindicator("t")');
  });

  it('corrects a typo inside a namespace', () => {
    const source = '//@version=6\nplot(ta.smaa(close, 14))';
    const fixes = fixesFor(source, issue({ line: 1, startCol: 5, code: 'CE10271', ctx: { fullName: 'ta.smaa' } }));
    expect(fixes.map((f) => f.title)).toContain('Change to `ta.sma`');
    expect(apply(source, fixes[0]!)).toContain('ta.sma(close, 14)');
  });

  it('corrects a typo in a built-in variable', () => {
    const source = '//@version=6\nplot(clsoe)';
    const fixes = fixesFor(source, issue({ line: 1, startCol: 5, code: 'CE10272', ctx: { identifier: 'clsoe' } }));
    expect(fixes[0]!.title).toBe('Change to `close`');
  });

  it('suggests a name declared in the document', () => {
    const source = '//@version=6\nlengthInput = 14\nplot(ta.sma(close, lengthInpt))';
    const fixes = fixesFor(
      source,
      issue({ line: 2, startCol: 19, code: 'CE10272', ctx: { identifier: 'lengthInpt' } }),
    );
    expect(fixes[0]!.title).toBe('Change to `lengthInput`');
  });

  it('offers nothing when no name is close enough', () => {
    const source = '//@version=6\nplot(zzzzqqqq)';
    const fixes = fixesFor(source, issue({ line: 1, startCol: 5, code: 'CE10272', ctx: { identifier: 'zzzzqqqq' } }));
    expect(fixes).toEqual([]);
  });
});

describe('quick fixes: declarations', () => {
  it('adds a type keyword to a variable initialised with na', () => {
    const source = 'x = na';
    const fixes = fixesFor(source, issue({ line: 0, startCol: 0, code: 'CE10097' }));
    expect(fixes.map((f) => f.title)).toEqual([
      'Declare `x` as float',
      'Declare `x` as int',
      'Declare `x` as bool',
      'Declare `x` as string',
      'Declare `x` as color',
    ]);
    expect(apply(source, fixes[0]!)).toBe('float x = na');
  });

  it('keeps the var keyword in front of the type', () => {
    const source = 'var x = na';
    const fixes = fixesFor(source, issue({ line: 0, startCol: 0, code: 'CE10097' }));
    expect(apply(source, fixes[0]!)).toBe('var float x = na');
  });

  it('widens a declared type to the type being assigned', () => {
    const source = 'int x = close';
    const fixes = fixesFor(
      source,
      issue({
        line: 0,
        startCol: 0,
        code: 'CE10173',
        ctx: { assignedValueType: 'series float', ownValueType: 'const int', variableName: 'x' },
      }),
    );
    expect(fixes[0]!.title).toBe('Change the declared type to `float`');
    expect(apply(source, fixes[0]!)).toBe('float x = close');
  });
});

describe('quick fixes: arguments', () => {
  it('corrects a misspelt argument name', () => {
    const source = 'plot(close, titel = "x")';
    const fixes = fixesFor(
      source,
      issue({ line: 0, startCol: 12, code: 'CE10120', ctx: { name: 'titel', signature: 'plot' } }),
    );
    expect(fixes[0]!.title).toBe('Rename the argument to `title`');
    expect(apply(source, fixes[0]!)).toBe('plot(close, title = "x")');
  });

  it('removes an argument the function dropped', () => {
    const source = 'plot(close, transp = 50)';
    const fixes = fixesFor(
      source,
      issue({ line: 0, startCol: 12, code: 'CE10120', ctx: { name: 'transp', signature: 'plot' } }),
    );
    expect(fixes.map((f) => f.title)).toContain('Remove the `transp` argument');
    const removal = fixes.find((f) => f.title.startsWith('Remove'))!;
    expect(apply(source, removal)).toBe('plot(close)');
  });

  it('removes an argument that is followed by another', () => {
    const source = 'plot(close, transp = 50, linewidth = 2)';
    const fixes = fixesFor(
      source,
      issue({ line: 0, startCol: 12, code: 'CE10120', ctx: { name: 'transp', signature: 'plot' } }),
    );
    const removal = fixes.find((f) => f.title.startsWith('Remove'))!;
    expect(apply(source, removal)).toBe('plot(close, linewidth = 2)');
  });
});

describe('quick fixes: warnings and the pragma', () => {
  it('renames a variable that hides a built-in everywhere it is used', () => {
    const source = '//@version=6\nindicator("t")\nopen = 1\nplot(open + open)';
    const fixes = fixesFor(source, issue({ line: 2, startCol: 0, code: 'CW10011', ctx: { variableName: 'open' } }));
    expect(fixes[0]!.title).toBe('Rename `open` to `openValue`');
    expect(apply(source, fixes[0]!)).toBe('//@version=6\nindicator("t")\nopenValue = 1\nplot(openValue + openValue)');
  });

  it('adds the version pragma when the compiler asks for one', () => {
    const source = 'indicator("t")\nplot(close)';
    const fixes = fixesFor(source, issue({ line: 0, startCol: 0, message: 'Supported versions are >= 5' }));
    expect(fixes[0]!.title).toBe('Add `//@version=6`');
    expect(apply(source, fixes[0]!)).toBe('//@version=6\nindicator("t")\nplot(close)');
  });

  it('does not offer the pragma twice', () => {
    const source = '//@version=6\nindicator("t")';
    expect(fixesFor(source, issue({ line: 0, startCol: 0, message: 'Supported versions are >= 5' }))).toEqual([]);
  });

  it('ignores a diagnostic it has no fix for', () => {
    expect(fixesFor('x = 1', issue({ line: 0, startCol: 0, code: 'CE10156' }))).toEqual([]);
  });
});
