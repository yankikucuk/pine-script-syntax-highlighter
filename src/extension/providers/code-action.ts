import * as vscode from 'vscode';
import { needsDocstring } from '../core/docstring';
import { declarationAt } from '../core/document-model';
import { analyze } from '../vscode/document-cache';

export class PineCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.Refactor],
  };

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const { model } = analyze(document);
    const decl = declarationAt(model, range.start.line);
    if (!decl || !needsDocstring(decl)) return [];
    const action = new vscode.CodeAction(`Generate docstring for ${decl.name}`, vscode.CodeActionKind.Refactor);
    action.command = { command: 'pinescript.generateDocstring', title: 'Generate docstring', arguments: [decl.line] };
    return [action];
  }
}
