import * as vscode from 'vscode';
import { annotationBlockRange, docstringLines } from '../core/docstring';
import { declarationAt, type DeclSymbol } from '../core/document-model';
import { analyze } from '../vscode/document-cache';

export function docstringEdit(document: vscode.TextDocument, symbol: DeclSymbol): vscode.TextEdit {
  const { lines } = analyze(document);
  const indent = lines[symbol.line]!.match(/^\s*/)![0];
  const block = annotationBlockRange(lines, symbol.line);
  const existing = block ? lines.slice(block.start, block.end + 1) : [];
  const text = docstringLines(symbol, existing, indent).join('\n') + '\n';
  return block
    ? vscode.TextEdit.replace(new vscode.Range(block.start, 0, block.end + 1, 0), text)
    : vscode.TextEdit.insert(new vscode.Position(symbol.line, 0), text);
}

export function registerGenerateDocstring(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.generateDocstring', async (line?: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pinescript') return;
      const { model } = analyze(editor.document);
      const from = line ?? editor.selection.start.line;
      const to = line ?? editor.selection.end.line;
      const targets: DeclSymbol[] = [];
      for (let l = from; l <= to; l++) {
        const d = declarationAt(model, l);
        if (d) targets.push(d);
      }
      if (!targets.length) {
        // Cursor inside a body: use the enclosing declaration.
        const enclosing = [...model.functions, ...model.types, ...model.enums].find(
          (s) => s.range.start <= from && from <= s.range.end,
        );
        if (enclosing) targets.push(enclosing);
      }
      if (!targets.length) {
        void vscode.window.showInformationMessage('Place the cursor on a function, method, type or enum declaration.');
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.set(
        editor.document.uri,
        targets.map((t) => docstringEdit(editor.document, t)),
      );
      await vscode.workspace.applyEdit(edit);
    }),
  );
}
