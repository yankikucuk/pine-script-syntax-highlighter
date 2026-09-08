import * as vscode from 'vscode';

import { lint, type LintIssue, type LintSeverity } from '../core/lint';
import type { ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';
import type { Settings } from '../vscode/settings';

const DEBOUNCE_MS = 300;

const SEVERITY: Record<LintSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/**
 * Runs the offline rules as the document changes. Nothing leaves the machine, so this is on by
 * default, unlike the diagnostics that ask the TradingView compiler.
 */
export class LintController {
  private readonly collection = vscode.languages.createDiagnosticCollection('pinescript-lint');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly issues = new Map<string, LintIssue[]>();

  constructor(
    private readonly ref: ReferenceIndex,
    private readonly settings: () => Settings,
  ) {}

  start(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, DEBOUNCE_MS)),
      vscode.workspace.onDidCloseTextDocument((d) => this.forget(d)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('pinescript.lint')) return;
        this.collection.clear();
        this.issues.clear();
        vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
      }),
    );
    vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
  }

  /** The issues last reported for a document, so the code actions can offer their fixes. */
  issuesFor(uri: vscode.Uri): readonly LintIssue[] | undefined {
    return this.issues.get(uri.toString());
  }

  private forget(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
    this.issues.delete(document.uri.toString());
    clearTimeout(this.timers.get(document.uri.toString()));
  }

  private schedule(document: vscode.TextDocument, delay: number): void {
    if (document.languageId !== 'pinescript') return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    if (!this.settings().lint) {
      this.collection.delete(document.uri);
      this.issues.delete(key);
      return;
    }
    this.timers.set(
      key,
      setTimeout(() => this.run(document), delay),
    );
  }

  private run(document: vscode.TextDocument): void {
    if (document.isClosed) return;
    const disabled = new Set(this.settings().lintDisabledRules);
    const found = lint(analyze(document), this.ref).filter((issue) => !disabled.has(issue.rule));
    this.issues.set(document.uri.toString(), found);
    this.collection.set(document.uri, found.map(toDiagnostic));
  }
}

function toDiagnostic(issue: LintIssue): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(issue.line, issue.startCol, issue.line, issue.endCol),
    issue.message,
    SEVERITY[issue.severity],
  );
  diagnostic.source = 'Pine Script';
  diagnostic.code = issue.rule;
  if (issue.unnecessary) diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
  return diagnostic;
}
