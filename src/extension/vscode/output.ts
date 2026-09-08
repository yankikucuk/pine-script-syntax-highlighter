import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** The "Pine Script" output channel, created on first use. */
export function output(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Pine Script');
  }
  return channel;
}

/** Writes a timestamped line to the output channel. */
export function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  output().appendLine(`[${stamp}] ${message}`);
}
