import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Pine Script');
  }
  return channel;
}

export function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  output().appendLine(`[${stamp}] ${message}`);
}
