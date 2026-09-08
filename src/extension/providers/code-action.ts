import * as vscode from 'vscode';

import type { CompileDiagnostic } from '../core/diagnostics';
import { needsDocstring } from '../core/docstring';
import type { LintIssue } from '../core/lint';
import { declarationAt } from '../core/document-model';
import { quickFixes, type QuickFix } from '../core/quick-fix';
import type { ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';

/** Looks up the compiler issues last reported for a document. */
export type IssueLookup = (uri: vscode.Uri) => readonly CompileDiagnostic[] | undefined;

/** Looks up the offline lint issues last reported for a document. */
export type LintLookup = (uri: vscode.Uri) => readonly LintIssue[] | undefined;

export class PineCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor],
  };

  constructor(
    private readonly ref: ReferenceIndex,
    private readonly issues: IssueLookup = () => undefined,
    private readonly lintIssues: LintLookup = () => undefined,
  ) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const { model } = analyze(document);
    const actions: vscode.CodeAction[] = [];

    const lines = document.getText().split(/\r?\n/);
    for (const issue of this.issues(document.uri) ?? []) {
      if (issue.line < range.start.line || issue.line > range.end.line) continue;
      for (const fix of quickFixes(issue, lines, model, this.ref)) {
        actions.push(toAction(fix, document.uri));
      }
    }

    for (const issue of this.lintIssues(document.uri) ?? []) {
      if (issue.line < range.start.line || issue.line > range.end.line || !issue.fix) continue;
      actions.push(toAction(issue.fix, document.uri));
    }

    const decl = declarationAt(model, range.start.line);
    if (decl && needsDocstring(decl)) {
      const action = new vscode.CodeAction(`Generate docstring for ${decl.name}`, vscode.CodeActionKind.Refactor);
      action.command = { command: 'pinescript.generateDocstring', title: 'Generate docstring', arguments: [decl.line] };
      actions.push(action);
    }
    return actions;
  }
}

function toAction(fix: QuickFix, uri: vscode.Uri): vscode.CodeAction {
  const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
  action.isPreferred = fix.preferred;
  action.edit = new vscode.WorkspaceEdit();
  for (const edit of fix.edits) {
    action.edit.replace(uri, new vscode.Range(edit.startLine, edit.startCol, edit.endLine, edit.endCol), edit.newText);
  }
  return action;
}
