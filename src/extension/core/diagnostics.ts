import type { CompileResult, RawIssue } from './pine-facade';

/** One compiler issue placed on the document, with its message resolved. */
export interface CompileDiagnostic {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: 'error' | 'warning';
  code: string | null;
  /** The compiler's own placeholder values, which the quick fixes read. */
  ctx: Record<string, string> | undefined;
}

function render(issue: RawIssue): string {
  return issue.message.replace(/\{(\w+)\}/g, (_, key: string) => issue.ctx?.[key] ?? `{${key}}`);
}

function one(issue: RawIssue, severity: 'error' | 'warning', lineCount: number): CompileDiagnostic {
  const maxLine = Math.max(0, lineCount - 1);
  const line = Math.min(maxLine, Math.max(0, (issue.start?.line ?? 1) - 1));
  const startCol = Math.max(0, (issue.start?.column ?? 1) - 1);
  const endLine = Math.min(maxLine, Math.max(0, (issue.end?.line ?? issue.start?.line ?? 1) - 1));
  const endCol = endLine === line ? Math.max(startCol, (issue.end?.column ?? issue.start?.column ?? 1) - 1) : startCol;
  return { line, startCol, endCol, message: render(issue), severity, code: issue.code ?? null, ctx: issue.ctx };
}

/** Converts a compile result to diagnostics, clamping positions to the document. */
export function toDiagnostics(result: CompileResult, lineCount: number): CompileDiagnostic[] {
  const out = [
    ...result.errors.map((e) => one(e, 'error', lineCount)),
    ...result.warnings.map((w) => one(w, 'warning', lineCount)),
  ];
  if (!result.success && !out.length) {
    out.push({
      line: 0,
      startCol: 0,
      endCol: 0,
      message: result.reason ?? 'The TradingView compiler rejected the script.',
      severity: 'error',
      code: null,
      ctx: undefined,
    });
  }
  return out;
}

/** The types the compiler inferred for each variable, which beats guessing them. */
export function compilerVariableTypes(result: CompileResult): Map<string, string> {
  return new Map(result.variables.map((v) => [v.name, v.type]));
}
