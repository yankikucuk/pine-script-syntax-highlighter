import * as vscode from 'vscode';
import { registerAddTypeAnnotations } from './commands/add-type-annotations';
import { registerGenerateDocstring } from './commands/generate-docstring';
import { registerNewFileCommands } from './commands/new-file';
import { registerOpenReference } from './commands/open-reference';
import { PineCodeActionProvider } from './providers/code-action';
import { noLibraries, type LibraryLookup } from './core/libraries';
import { loadReference } from './core/reference';
import { PineCompletionProvider } from './providers/completion';
import { PineDocumentSymbolProvider } from './providers/document-symbol';
import { PineHoverProvider } from './providers/hover';
import { PineSignatureHelpProvider } from './providers/signature-help';
import { forget } from './vscode/document-cache';
import { log, output } from './vscode/output';
import { getSettings } from './vscode/settings';

const SELECTOR: vscode.DocumentSelector = { language: 'pinescript' };
let providerDisposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(output());
  const libraries: LibraryLookup = noLibraries;

  registerProviders(context, libraries);
  registerAddTypeAnnotations(context, () => undefined);
  registerGenerateDocstring(context);
  registerNewFileCommands(context);
  registerOpenReference(context);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      new PineCodeActionProvider(),
      PineCodeActionProvider.metadata,
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('pinescript')) registerProviders(context, libraries);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => forget(d.uri)),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, new PineDocumentSymbolProvider()),
  );
  log('Pine Script extension activated');
}

export function registerProviders(context: vscode.ExtensionContext, libraries: LibraryLookup): void {
  for (const d of providerDisposables) d.dispose();
  providerDisposables = [];
  const settings = getSettings();
  const ref = loadReference();
  if (settings.completion) {
    providerDisposables.push(
      vscode.languages.registerCompletionItemProvider(
        SELECTOR,
        new PineCompletionProvider(ref, libraries),
        '.',
        '/',
        '@',
        '(',
        ',',
      ),
    );
  }
  if (settings.hover)
    providerDisposables.push(vscode.languages.registerHoverProvider(SELECTOR, new PineHoverProvider(ref, libraries)));
  if (settings.signatureHelp)
    providerDisposables.push(
      vscode.languages.registerSignatureHelpProvider(SELECTOR, new PineSignatureHelpProvider(ref, libraries), '(', ','),
    );
  context.subscriptions.push(...providerDisposables);
}

export function deactivate(): void {}
