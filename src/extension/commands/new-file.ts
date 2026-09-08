import * as vscode from 'vscode';
import { renderTemplate, type TemplateKind } from '../core/templates';

const TITLES: Record<TemplateKind, string> = {
  indicator: 'My Indicator',
  strategy: 'My Strategy',
  library: 'MyLibrary',
};
const LABELS: Record<TemplateKind, string> = { indicator: 'Indicator', strategy: 'Strategy', library: 'Library' };

/** Registers the three commands that open a new script from a template. */
export function registerNewFileCommands(context: vscode.ExtensionContext): void {
  for (const kind of ['indicator', 'strategy', 'library'] as const) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`pinescript.new${LABELS[kind]}`, async () => {
        const title = await vscode.window.showInputBox({ prompt: `${LABELS[kind]} title`, value: TITLES[kind] });
        if (title === undefined) return;
        const content = renderTemplate(kind, {
          title: title || TITLES[kind],
          date: new Date().toISOString().slice(0, 10),
        });
        const doc = await vscode.workspace.openTextDocument({ language: 'pinescript', content });
        await vscode.window.showTextDocument(doc);
      }),
    );
  }
}
