import * as vscode from 'vscode';

import { lint, TARGET_VERSION, type LintIssue } from '../core/lint';
import type { ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';

/** The rules whose fixes together move a script from an older Pine version to the current one. */
const MIGRATION_RULES = new Set(['missing-version', 'old-version', 'legacy-name', 'unknown-argument']);

export function registerConvertToV6(context: vscode.ExtensionContext, ref: ReferenceIndex): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pinescript.convertToV6', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pinescript') return;
      const document = editor.document;
      const issues = lint(analyze(document), ref).filter((i) => MIGRATION_RULES.has(i.rule) && i.fix);
      if (!issues.length) {
        void vscode.window.showInformationMessage(`This script already reads as Pine Script v${TARGET_VERSION}.`);
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const issue of issues) {
        for (const change of issue.fix!.edits) {
          edit.replace(
            document.uri,
            new vscode.Range(change.startLine, change.startCol, change.endLine, change.endCol),
            change.newText,
          );
        }
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showWarningMessage('The conversion could not be applied.');
        return;
      }
      void vscode.window.showInformationMessage(`Converted to v${TARGET_VERSION}: ${summarise(issues)}.`);
    }),
  );
}

/** Says plainly what the command changed, since one of its fixes deletes an argument. */
function summarise(issues: LintIssue[]): string {
  const count = (rule: string) => issues.filter((i) => i.rule === rule).length;
  const removed = issues.filter((i) => i.rule === 'unknown-argument' && i.fix!.title.startsWith('Remove')).length;
  const renamedArguments = count('unknown-argument') - removed;
  const parts: string[] = [];
  if (count('missing-version') || count('old-version')) parts.push('the version pragma');
  parts.push(...plural(count('legacy-name'), 'name'));
  parts.push(...plural(renamedArguments, 'argument name'));
  if (removed) parts.push(`${removed} ${removed === 1 ? 'argument' : 'arguments'} v6 does not accept, removed`);
  return parts.join(', ');
}

function plural(count: number, noun: string): string[] {
  if (!count) return [];
  return [`${count} ${noun}${count === 1 ? '' : 's'}`];
}
