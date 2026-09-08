import { describe, expect, it } from 'vitest';

import { buildModel } from '../../src/extension/core/document-model';
import { lint, type LintIssue } from '../../src/extension/core/lint';
import { loadReference } from '../../src/extension/core/reference';
import { tokenize } from '../../src/extension/core/tokenizer';

const ref = loadReference();

function check(text: string): LintIssue[] {
  return lint({ model: buildModel(text), tokens: tokenize(text), lines: text.split('\n') }, ref);
}

const rules = (text: string) => check(text).map((i) => i.rule);
const only = (text: string, rule: string) => check(text).filter((i) => i.rule === rule);

/** Applies an issue's fix so the test can assert on the resulting line. */
function applyFix(text: string, issue: LintIssue): string {
  const lines = text.split('\n');
  for (const edit of [...issue.fix!.edits].sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)) {
    const line = lines[edit.startLine]!;
    lines[edit.startLine] = line.slice(0, edit.startCol) + edit.newText + line.slice(edit.endCol);
  }
  return lines.join('\n');
}

describe('version rules', () => {
  it('asks for a pragma when there is none', () => {
    const [issue] = only('indicator("t")\nplot(close)', 'missing-version');
    expect(issue!.severity).toBe('warning');
    expect(applyFix('indicator("t")\nplot(close)', issue!)).toBe('//@version=6\nindicator("t")\nplot(close)');
  });

  it('flags an older pragma and offers to raise it', () => {
    const source = '//@version=5\nindicator("t")\nplot(close)';
    const [issue] = only(source, 'old-version');
    expect(issue!.message).toContain('v5');
    expect(applyFix(source, issue!)).toContain('//@version=6');
  });

  it('says nothing about a current pragma', () => {
    expect(rules('//@version=6\nindicator("t")\nplot(close)')).not.toContain('old-version');
  });
});

describe('names left over from older versions', () => {
  const header = '//@version=6\nindicator("t")\n';

  it('points a bare v4 built-in at its namespace', () => {
    const source = `${header}plot(sma(close, 14))`;
    const [issue] = only(source, 'legacy-name');
    expect(issue!.message).toContain('ta.sma');
    expect(applyFix(source, issue!)).toContain('plot(ta.sma(close, 14))');
  });

  it('leaves current names, namespaced names and keywords alone', () => {
    expect(rules(`${header}plot(ta.sma(close, 14))`)).not.toContain('legacy-name');
    expect(rules(`${header}plot(close)`)).not.toContain('legacy-name');
    expect(rules(`${header}if close > open\n    x = 1\nplot(close)`)).not.toContain('legacy-name');
  });

  it('leaves a name the document declares alone', () => {
    expect(rules(`${header}sma = 1\nplot(sma)`)).not.toContain('legacy-name');
  });

  it('leaves a loop variable alone', () => {
    expect(
      rules(`${header}total = 0.0\nfor security in array.from(close)\n    total += security\nplot(total)`),
    ).not.toContain('legacy-name');
  });
});

describe('calls in the wrong place', () => {
  const header = '//@version=6\nindicator("t")\n';

  it('flags a plot inside a local block', () => {
    const [issue] = only(`${header}if close > open\n    plot(close)`, 'local-scope-call');
    expect(issue!.severity).toBe('error');
    expect(issue!.message).toContain('top level');
  });

  it('accepts a plot at the top level, wrapped or not', () => {
    expect(rules(`${header}plot(close)`)).not.toContain('local-scope-call');
    expect(rules(`${header}plot(close,\n     color = color.red)`)).not.toContain('local-scope-call');
  });

  it('accepts calls that are allowed in a local block', () => {
    expect(rules(`${header}if close > open\n    alert("hi")\nplot(close)`)).not.toContain('local-scope-call');
  });
});

describe('arguments', () => {
  const header = '//@version=6\nindicator("t")\n';

  it('flags the same argument given twice', () => {
    expect(rules(`${header}plot(close, title = "a", title = "b")`)).toContain('duplicate-argument');
  });

  it('flags an argument the function does not take, and suggests the near miss', () => {
    const source = `${header}plot(close, titel = "a")`;
    const [issue] = only(source, 'unknown-argument');
    expect(issue!.message).toContain('title');
    expect(applyFix(source, issue!)).toContain('title = "a"');
  });

  it('flags an argument that was dropped between versions', () => {
    const [issue] = only(`${header}plot(close, transp = 40)`, 'unknown-argument');
    expect(issue!.message).toContain('transp');
  });

  it('accepts the arguments a function does take', () => {
    expect(rules(`${header}plot(close, title = "a", linewidth = 2)`)).not.toContain('unknown-argument');
  });

  it('says nothing about arguments of a user function', () => {
    expect(rules(`${header}f(a) =>\n    a\nplot(f(a = close))`)).not.toContain('unknown-argument');
  });
});

describe('declarations that are never read', () => {
  const header = '//@version=6\nindicator("t")\n';

  it('flags an unused variable as dead code', () => {
    const [issue] = only(`${header}unusedOne = 1\nplot(close)`, 'unused-variable');
    expect(issue).toMatchObject({ severity: 'hint', unnecessary: true, line: 2, startCol: 0 });
  });

  it('flags an unused parameter and an unused import', () => {
    expect(rules(`${header}f(a, b) =>\n    a\nplot(f(close, open))`)).toContain('unused-parameter');
    expect(rules('//@version=6\nimport someone/utils/3 as helper\nindicator("t")\nplot(close)')).toContain(
      'unused-import',
    );
  });

  it('keeps quiet about names that are used', () => {
    expect(rules(`${header}length = 14\nplot(ta.sma(close, length))`)).not.toContain('unused-variable');
    expect(
      rules('//@version=6\nimport someone/utils/3 as helper\nindicator("t")\nplot(helper.f(close))'),
    ).not.toContain('unused-import');
  });

  it('respects the underscore convention', () => {
    expect(rules(`${header}_scratch = 1\nplot(close)`)).not.toContain('unused-variable');
  });
});
