import * as vscode from 'vscode';
import { loadReference } from '../core/reference';
import { planTypeAnnotations } from '../core/type-inference';
import { analyze } from '../vscode/document-cache';

export type CompilerTypesLookup = (uri: vscode.Uri) => ReadonlyMap<string, string> | undefined;

export function registerAddTypeAnnotations(context: vscode.ExtensionContext, compilerTypes: CompilerTypesLookup): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.addTypeAnnotations', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pinescript') return;
      const { model } = analyze(editor.document);
      const range: [number, number] | null = editor.selection.isEmpty
        ? null
        : [editor.selection.start.line, editor.selection.end.line];
      const { edits, skipped } = planTypeAnnotations(model, loadReference(), range, compilerTypes(editor.document.uri));
      if (!edits.length) {
        void vscode.window.showInformationMessage(
          skipped.length
            ? `No types could be inferred for: ${skipped.join(', ')}`
            : 'Every declaration already has a type.',
        );
        return;
      }
      await editor.edit((b) => {
        for (const e of edits) b.insert(new vscode.Position(e.line, e.column), e.insert);
      });
      const tail = skipped.length ? ` Skipped ${skipped.length}: ${skipped.join(', ')}.` : '';
      void vscode.window.showInformationMessage(
        `Added ${edits.length} type annotation${edits.length === 1 ? '' : 's'}.${tail}`,
      );
    }),
  );
}
