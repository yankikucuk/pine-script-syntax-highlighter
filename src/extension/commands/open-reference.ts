import * as vscode from 'vscode';
import { REFERENCE_URL, loadReference } from '../core/reference';
import { wordAt } from '../core/tokenizer';

export function registerOpenReference(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.openReference', async () => {
      const editor = vscode.window.activeTextEditor;
      let url = REFERENCE_URL;
      if (editor && editor.document.languageId === 'pinescript') {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const word = wordAt(line, editor.selection.active.character);
        if (word) {
          const ref = loadReference();
          const parts = word.text.split('.');
          for (let i = parts.length; i > 0; i--) {
            const entry = ref.get(parts.slice(0, i).join('.'));
            if (entry) {
              url = ref.url(entry);
              break;
            }
          }
        }
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );
}
