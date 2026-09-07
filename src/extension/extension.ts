import * as vscode from 'vscode';
import { log, output } from './vscode/output';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(output());
  log('Pine Script extension activated');
}

export function deactivate(): void {}
