import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { noLibraries, parseLibrary, type LibraryLookup } from '../../src/extension/core/libraries';
import { loadReference } from '../../src/extension/core/reference';
import { PineCodeActionProvider } from '../../src/extension/providers/code-action';
import { PineCompletionProvider } from '../../src/extension/providers/completion';
import { PineDocumentSymbolProvider } from '../../src/extension/providers/document-symbol';
import { PineHoverProvider } from '../../src/extension/providers/hover';
import { PineSignatureHelpProvider } from '../../src/extension/providers/signature-help';
import { docstringEdit } from '../../src/extension/commands/generate-docstring';
import { declarationAt } from '../../src/extension/core/document-model';
import { analyze } from '../../src/extension/vscode/document-cache';
import { makeDocument } from './fake-vscode';

type Doc = Parameters<typeof analyze>[0];
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ref = loadReference();
const library = parseLibrary(fixture('library.pine'), 'yankikucuk/MaHelpers/2', 'local')!;
const libraries: LibraryLookup = {
  forImport: async (imp) => (imp.name === 'MaHelpers' ? library : null),
  local: () => [library],
  search: async (prefix) =>
    prefix.startsWith('Trad') ? [{ ...library, id: 'TradingView/ta/14', title: 'ta', source: 'remote' }] : [],
};
const doc = (text: string) => makeDocument(text) as unknown as Doc;
const end = (text: string) => {
  const lines = text.split('\n');
  return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
};
const labels = (items: vscode.CompletionItem[]) => items.map((i) => i.label);
const hoverText = (h: vscode.Hover | null | undefined) =>
  (h?.contents as unknown as { value?: string } | undefined)?.value;

describe('completion provider', () => {
  const provider = new PineCompletionProvider(ref, libraries);

  it('lists namespace members with documentation', async () => {
    const text = 'x = ta.';
    const items = await provider.provideCompletionItems(doc(text), end(text));
    expect(labels(items)).toContain('sma');
    const sma = items.find((i) => i.label === 'sma')!;
    expect(sma.detail).toBe('ta.sma(source, length) → series float');
    expect((sma.insertText as vscode.SnippetString).value).toBe('sma($1)');
  });

  it('lists bare built-ins, keywords, user symbols and aliases', async () => {
    const text = fixture('consumer.pine') + '\nz = ';
    const items = await provider.provideCompletionItems(doc(text), end(text));
    const l = labels(items);
    expect(l).toEqual(expect.arrayContaining(['close', 'ta', 'if', 'float', 'length', 'fast', 'ma']));
  });

  it('offers named arguments inside a call, skipping used ones', async () => {
    const text = 'plot(close, title = "x", ';
    const items = await provider.provideCompletionItems(doc(text), end(text));
    const named = items.filter((i) => i.detail === 'named argument').map((i) => i.label);
    expect(named).toContain('color=');
    expect(named).not.toContain('title=');
  });

  it('completes annotations, imports and alias exports', async () => {
    const a = await provider.provideCompletionItems(doc('//@'), end('//@'));
    expect(labels(a)).toContain('param');
    const i = await provider.provideCompletionItems(doc('import Trad'), end('import Trad'));
    expect(labels(i)).toEqual(expect.arrayContaining(['yankikucuk/MaHelpers/2', 'TradingView/ta/14']));
    expect(i[0]?.range).toMatchObject({ start: { line: 0, character: 7 }, end: { line: 0, character: 11 } });
    const text = fixture('consumer.pine') + '\nq = ma.';
    const m = await provider.provideCompletionItems(doc(text), end(text));
    expect(labels(m)).toEqual(expect.arrayContaining(['weighted', 'Level', 'Side']));
  });

  it('stays quiet inside strings', async () => {
    expect(await provider.provideCompletionItems(doc('s = "ta.'), end('s = "ta.'))).toEqual([]);
  });
});

describe('hover provider', () => {
  const provider = new PineHoverProvider(ref, libraries);
  const text = fixture('consumer.pine');

  it('documents built-ins, preferring the longest dotted name', async () => {
    const h = await provider.provideHover(doc(text), new vscode.Position(9, 10)); // ta.ema
    expect(hoverText(h)).toContain('ta.ema(source, length)');
    expect(h?.range).toMatchObject({ start: { character: 7 }, end: { character: 13 } });
  });

  it('documents variables, imports and alias members', async () => {
    const v = await provider.provideHover(doc(text), new vscode.Position(9, 1)); // fast
    expect(hoverText(v)).toContain('fast = ta.ema(src, length)');
    const i = await provider.provideHover(doc(text), new vscode.Position(2, 5));
    expect(hoverText(i)).toContain('**MaHelpers**');
    expect(hoverText(i)).toContain('`weighted()`');
    const withCall = text + 'w = ma.weighted(1, 2)';
    const m = await provider.provideHover(doc(withCall), new vscode.Position(end(withCall).line, 8));
    expect(hoverText(m)).toContain('weighted(float a, float b, float w = 0.5)');
    expect(hoverText(m)).toContain('from yankikucuk/MaHelpers/2');
  });

  it('documents annotations inside comments and nothing inside strings', async () => {
    const a = await provider.provideHover(doc('//@param x'), new vscode.Position(0, 4));
    expect(hoverText(a)).toContain('@param');
    expect(await provider.provideHover(doc('s = "close"'), new vscode.Position(0, 7))).toBeNull();
  });
});

describe('signature help provider', () => {
  const provider = new PineSignatureHelpProvider(ref, libraries);

  it('shows overloads and tracks the active parameter', async () => {
    const text = 'x = str.tostring(1, ';
    const h = await provider.provideSignatureHelp(doc(text), end(text));
    expect(h?.signatures.length).toBeGreaterThan(1);
    expect(h?.signatures[h.activeSignature]?.parameters.length).toBe(2);
    expect(h?.activeParameter).toBe(1);
  });

  it('resolves named arguments and user functions', async () => {
    const t1 = 'plot(close, color = ';
    const h1 = await provider.provideSignatureHelp(doc(t1), end(t1));
    expect(h1?.signatures[0]?.parameters[h1.activeParameter]?.label).toBe('color');
    const t2 = fixture('library.pine') + '\nv = weighted(1, ';
    const h2 = await provider.provideSignatureHelp(doc(t2), end(t2));
    expect(h2?.signatures[0]?.label).toBe('weighted(float a, float b, float w = 0.5)');
    expect(h2?.activeParameter).toBe(1);
  });
});

describe('document symbols and code actions', () => {
  it('outlines a library', () => {
    const symbols = new PineDocumentSymbolProvider().provideDocumentSymbols(doc(fixture('library.pine')));
    expect(symbols.map((s) => `${s.name}:${vscode.SymbolKind[s.kind]}`)).toEqual([
      'weighted:Function',
      'Level:Struct',
      'Side:Enum',
      'describe:Method',
      'internal:Function',
    ]);
    expect(symbols[1]?.children.map((c) => c.name)).toEqual(['price', 'name']);
  });

  it('offers and applies a docstring for an undocumented function', () => {
    const d = doc(fixture('library.pine'));
    const actions = new PineCodeActionProvider().provideCodeActions(d, new vscode.Range(28, 0, 28, 0));
    expect(actions.map((a) => a.title)).toEqual(['Generate docstring for internal']);
    const { model } = analyze(d);
    const edit = docstringEdit(d, declarationAt(model, 28)!);
    expect(edit.newText).toBe('//@function internal \n//@param x \n//@returns \n');
    expect(edit.range.start.line).toBe(28);
    expect(new PineCodeActionProvider().provideCodeActions(d, new vscode.Range(9, 0, 9, 0))).toEqual([]);
  });
});

void noLibraries;
