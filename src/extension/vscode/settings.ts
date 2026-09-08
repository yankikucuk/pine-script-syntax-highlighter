import * as vscode from 'vscode';

export interface Settings {
  completion: boolean;
  hover: boolean;
  signatureHelp: boolean;
  librariesInclude: string;
  librariesRemote: boolean;
  diagnosticsRemote: boolean;
  format: boolean;
  lint: boolean;
  lintDisabledRules: string[];
}

export function getSettings(): Settings {
  const c = vscode.workspace.getConfiguration('pinescript');
  return {
    completion: c.get<boolean>('completion.enabled', true),
    hover: c.get<boolean>('hover.enabled', true),
    signatureHelp: c.get<boolean>('signatureHelp.enabled', true),
    librariesInclude: c.get<string>('libraries.local.include', '**/*.pine'),
    librariesRemote: c.get<boolean>('libraries.remote', true),
    diagnosticsRemote: c.get<boolean>('diagnostics.remote', false),
    format: c.get<boolean>('format.enabled', true),
    lint: c.get<boolean>('lint.enabled', true),
    lintDisabledRules: c.get<string[]>('lint.disabledRules', []),
  };
}
