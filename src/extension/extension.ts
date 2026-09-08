import * as vscode from 'vscode';
import { registerAddTypeAnnotations } from './commands/add-type-annotations';
import { registerGenerateDocstring } from './commands/generate-docstring';
import { registerNewFileCommands } from './commands/new-file';
import { registerOpenReference } from './commands/open-reference';
import { PineCodeActionProvider } from './providers/code-action';
import { DiagnosticsController } from './providers/diagnostics-controller';
import { LibraryIndex } from './providers/library-index';
import type { LibraryLookup } from './core/libraries';
import { PineFacade } from './core/pine-facade';
import { loadReference } from './core/reference';
import { PineCompletionProvider } from './providers/completion';
import { PineDocumentSymbolProvider } from './providers/document-symbol';
import { PineFormattingProvider } from './providers/formatting';
import { PineHoverProvider } from './providers/hover';
import { PineSignatureHelpProvider } from './providers/signature-help';
import { forget } from './vscode/document-cache';
import { log, output } from './vscode/output';
import { getSettings } from './vscode/settings';

const SELECTOR: vscode.DocumentSelector = { language: 'pinescript' };
let providerDisposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(output());
  const facade = new PineFacade({ log });
  const libraries = new LibraryIndex(facade, getSettings);
  libraries.start(context);
  const diagnostics = new DiagnosticsController(facade, getSettings);
  diagnostics.start(context);

  registerProviders(context, libraries);
  registerAddTypeAnnotations(context, (uri) => diagnostics.typesFor(uri));
  registerGenerateDocstring(context);
  registerNewFileCommands(context);
  registerOpenReference(context);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      new PineCodeActionProvider(loadReference(), (uri) => diagnostics.issuesFor(uri)),
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
  if (settings.format) {
    const formatter = new PineFormattingProvider();
    providerDisposables.push(
      vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, formatter),
      vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, formatter),
    );
  }
  context.subscriptions.push(...providerDisposables);
}

export function deactivate(): void {}
