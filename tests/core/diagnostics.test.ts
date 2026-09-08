import { describe, expect, it } from 'vitest';
import { compilerVariableTypes, toDiagnostics } from '../../src/extension/core/diagnostics';

describe('toDiagnostics', () => {
  it('maps compiler issues to zero-based ranges with substituted messages', () => {
    const d = toDiagnostics(
      {
        success: true,
        errors: [
          {
            code: 'CE10272',
            ctx: { identifier: 'closee' },
            message: 'Undeclared identifier "{identifier}"',
            start: { line: 3, column: 6 },
            end: { line: 3, column: 11 },
          },
        ],
        warnings: [{ message: 'Unused variable', start: { line: 5, column: 1 }, end: { line: 5, column: 4 } }],
        variables: [],
        functions: [],
      },
      10,
    );
    expect(d).toEqual([
      {
        line: 2,
        startCol: 5,
        endCol: 10,
        message: 'Undeclared identifier "closee"',
        severity: 'error',
        code: 'CE10272',
        ctx: { identifier: 'closee' },
      },
      {
        line: 4,
        startCol: 0,
        endCol: 3,
        message: 'Unused variable',
        severity: 'warning',
        code: null,
        ctx: undefined,
      },
    ]);
  });

  it('reports a failure without positions on the first line', () => {
    expect(
      toDiagnostics(
        { success: false, reason: 'Script too large', errors: [], warnings: [], variables: [], functions: [] },
        3,
      ),
    ).toEqual([
      { line: 0, startCol: 0, endCol: 0, message: 'Script too large', severity: 'error', code: null, ctx: undefined },
    ]);
  });

  it('clamps lines beyond the document', () => {
    const d = toDiagnostics(
      {
        success: true,
        errors: [{ message: 'x', start: { line: 99, column: 1 }, end: { line: 99, column: 2 } }],
        warnings: [],
        variables: [],
        functions: [],
      },
      3,
    );
    expect(d[0]?.line).toBe(2);
  });

  it('collects variable types', () => {
    const t = compilerVariableTypes({
      success: true,
      errors: [],
      warnings: [],
      variables: [{ name: 'a', type: 'series float' }],
      functions: [],
    });
    expect(t.get('a')).toBe('series float');
  });
});
