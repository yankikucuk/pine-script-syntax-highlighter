import * as vscode from 'vscode';
import { compilerVariableTypes, toDiagnostics } from '../core/diagnostics';
import type { PineFacade } from '../core/pine-facade';
import type { Settings } from '../vscode/settings';

const DEBOUNCE_MS = 600;

export class DiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection('pinescript');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly types = new Map<string, ReadonlyMap<string, string>>();

  constructor(
    private readonly facade: PineFacade,
    private readonly settings: () => Settings,
  ) {}

  start(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, DEBOUNCE_MS)),
      vscode.workspace.onDidSaveTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.collection.delete(d.uri);
        this.types.delete(d.uri.toString());
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('pinescript.diagnostics.remote')) return;
        if (this.settings().diagnosticsRemote) vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
        else this.collection.clear();
      }),
    );
    vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
  }

  typesFor(uri: vscode.Uri): ReadonlyMap<string, string> | undefined {
    return this.types.get(uri.toString());
  }

  private schedule(document: vscode.TextDocument, delay: number): void {
    if (document.languageId !== 'pinescript' || !this.settings().diagnosticsRemote) return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => void this.run(document), delay),
    );
  }

  private async run(document: vscode.TextDocument): Promise<void> {
    const version = document.version;
    const result = await this.facade.translateLight(document.getText());
    if (!result || document.isClosed || document.version !== version) return;
    this.types.set(document.uri.toString(), compilerVariableTypes(result));
    this.collection.set(
      document.uri,
      toDiagnostics(result, document.lineCount).map((d) => {
        const diag = new vscode.Diagnostic(
          new vscode.Range(d.line, d.startCol, d.line, d.endCol),
          d.message,
          d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        );
        diag.source = 'TradingView compiler';
        if (d.code) diag.code = d.code;
        return diag;
      }),
    );
  }
}
