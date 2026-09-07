import * as vscode from 'vscode';
import { buildModel, type DocumentModel } from '../core/document-model';
import { tokenize, type TokenizedLine } from '../core/tokenizer';

export interface Analysis {
  model: DocumentModel;
  tokens: TokenizedLine[];
  lines: string[];
}

const MAX = 20;
const cache = new Map<string, { version: number; analysis: Analysis }>();

export function analyze(document: vscode.TextDocument): Analysis {
  const key = document.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === document.version) return hit.analysis;
  const text = document.getText();
  const analysis: Analysis = { model: buildModel(text), tokens: tokenize(text), lines: text.split(/\r?\n/) };
  cache.delete(key);
  cache.set(key, { version: document.version, analysis });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return analysis;
}

export function forget(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}
