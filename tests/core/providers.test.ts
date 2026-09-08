import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { noLibraries, parseLibrary, type LibraryLookup } from '../../src/extension/core/libraries';
import { loadReference } from '../../src/extension/core/reference';
import { PineCodeActionProvider } from '../../src/extension/providers/code-action';
import { PineCompletionProvider } from '../../src/extension/providers/completion';
import { PineDocumentSymbolProvider } from '../../src/extension/providers/document-symbol';
import { PineColorProvider, PineSemanticTokensProvider } from '../../src/extension/providers/decorations';
import { PineFormattingProvider } from '../../src/extension/providers/formatting';
import {
  PineDefinitionProvider,
  PineDocumentHighlightProvider,
  PineReferenceProvider,
  PineRenameProvider,
} from '../../src/extension/providers/navigation';
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
    const actions = new PineCodeActionProvider(ref).provideCodeActions(d, new vscode.Range(28, 0, 28, 0));
    expect(actions.map((a) => a.title)).toEqual(['Generate docstring for internal']);
    const { model } = analyze(d);
    const edit = docstringEdit(d, declarationAt(model, 28)!);
    expect(edit.newText).toBe('//@function internal \n//@param x \n//@returns \n');
    expect(edit.range.start.line).toBe(28);
    expect(new PineCodeActionProvider(ref).provideCodeActions(d, new vscode.Range(9, 0, 9, 0))).toEqual([]);
  });
});

describe('formatting provider', () => {
  const provider = new PineFormattingProvider();
  const options = { insertSpaces: true, tabSize: 4 } as vscode.FormattingOptions;

  it('replaces the whole document with the formatted text', () => {
    const d = doc('//@version=6\nif a\n  x=1\n');
    const [edit] = provider.provideDocumentFormattingEdits(d, options);
    expect(edit!.newText).toBe('//@version=6\nif a\n    x = 1\n');
    expect(edit!.range.start.line).toBe(0);
  });

  it('makes no edit when the document is already formatted', () => {
    expect(provider.provideDocumentFormattingEdits(doc('x = 1\n'), options)).toEqual([]);
  });

  it('indents with tabs when the editor does', () => {
    const d = doc('if a\n  x = 1\n');
    const [edit] = provider.provideDocumentFormattingEdits(d, { insertSpaces: false, tabSize: 4 });
    expect(edit!.newText).toBe('if a\n\tx = 1\n');
  });

  it('formats only the selected lines', () => {
    const d = doc('x=1\ny=2\nz=3');
    const [edit] = provider.provideDocumentRangeFormattingEdits(d, new vscode.Range(1, 0, 1, 3), options);
    expect(edit!.newText).toBe('y = 2');
    expect(edit!.range.start.line).toBe(1);
    expect(edit!.range.end.line).toBe(1);
  });
});

describe('code action provider: compiler quick fixes', () => {
  const text = '//@version=6\nindicator("t")\nplot(sma(close, 14))';
  const issue = {
    line: 2,
    startCol: 5,
    endCol: 8,
    message: "Could not find function 'sma'",
    severity: 'error' as const,
    code: 'CE10271',
    ctx: { fullName: 'sma', kind: 'function' },
  };

  it('turns a compiler diagnostic into an applicable quick fix', () => {
    const d = doc(text);
    const actions = new PineCodeActionProvider(ref, () => [issue]).provideCodeActions(d, new vscode.Range(2, 0, 2, 0));
    expect(actions.map((a) => a.title)).toContain('Change to `ta.sma`');
    const fix = actions.find((a) => a.title === 'Change to `ta.sma`')!;
    expect(fix.kind?.value).toBe('quickfix');
    const edits = (fix.edit as unknown as { edits: { newText: string }[] }).edits;
    expect(edits.map((e) => e.newText)).toEqual(['ta.sma']);
  });

  it('ignores diagnostics outside the requested range', () => {
    const d = doc(text);
    const actions = new PineCodeActionProvider(ref, () => [issue]).provideCodeActions(d, new vscode.Range(0, 0, 0, 0));
    expect(actions).toEqual([]);
  });

  it('offers nothing when the compiler has not run', () => {
    expect(new PineCodeActionProvider(ref).provideCodeActions(doc(text), new vscode.Range(2, 0, 2, 0))).toEqual([]);
  });
});

const navigable = [
  '//@version=6',
  'indicator("Demo")',
  'enum Regime',
  '    bull = "Bull"',
  'mean(source) =>',
  '    ta.sma(source, 14)',
  'value = mean(close)',
  'mode = Regime.bull',
  'plot(value, color = color.new(color.red, 40))',
].join('\n');

describe('navigation providers', () => {
  const d = () => doc(navigable);

  it('goes to the declaration of a user function', () => {
    const location = new PineDefinitionProvider().provideDefinition(d(), new vscode.Position(6, 8));
    expect(location?.range.start.line).toBe(4);
  });

  it('has no definition for a built-in', () => {
    expect(new PineDefinitionProvider().provideDefinition(d(), new vscode.Position(6, 13))).toBeNull();
  });

  it('lists references with and without the declaration', () => {
    const provider = new PineReferenceProvider();
    const withDeclaration = provider.provideReferences(d(), new vscode.Position(4, 0), { includeDeclaration: true });
    expect(withDeclaration.map((l) => l.range.start.line)).toEqual([4, 6]);
    const uses = provider.provideReferences(d(), new vscode.Position(4, 0), { includeDeclaration: false });
    expect(uses.map((l) => l.range.start.line)).toEqual([6]);
  });

  it('highlights the declaration as a write and the uses as reads', () => {
    const highlights = new PineDocumentHighlightProvider().provideDocumentHighlights(d(), new vscode.Position(4, 0));
    expect(highlights.map((h) => h.kind)).toEqual([
      vscode.DocumentHighlightKind.Write,
      vscode.DocumentHighlightKind.Read,
    ]);
  });

  it('renames a user symbol everywhere it appears', () => {
    const edit = new PineRenameProvider().provideRenameEdits(d(), new vscode.Position(4, 0), 'average');
    const edits = (edit as unknown as { edits: { range: vscode.Range; newText: string }[] }).edits;
    expect(edits.map((e) => `${e.range.start.line}:${e.newText}`)).toEqual(['4:average', '6:average']);
  });

  it('keeps the enum in front of a renamed member', () => {
    const edit = new PineRenameProvider().provideRenameEdits(d(), new vscode.Position(7, 18), 'rising');
    const edits = (edit as unknown as { edits: { range: vscode.Range; newText: string }[] }).edits;
    expect(edits.map((e) => e.newText)).toEqual(['rising', 'Regime.rising']);
  });

  it('refuses to rename a built-in', () => {
    expect(() => new PineRenameProvider().prepareRename(d(), new vscode.Position(6, 13))).toThrow(/cannot be renamed/);
  });
});

describe('colour and semantic token providers', () => {
  it('offers a swatch for a colour call and writes the picked colour back', () => {
    const provider = new PineColorProvider(ref);
    const colors = provider.provideDocumentColors(doc(navigable));
    expect(colors).toHaveLength(1);
    expect(colors[0]!.range.start.line).toBe(8);
    expect(colors[0]!.color.alpha).toBeCloseTo(0.6, 5);
    expect(provider.provideColorPresentations(new vscode.Color(1, 0, 0, 1)).map((p) => p.label)).toEqual([
      '#FF0000',
      'color.rgb(255, 0, 0)',
    ]);
  });

  it('emits semantic tokens only for the names the document declares', () => {
    const built = new PineSemanticTokensProvider().provideDocumentSemanticTokens(doc(navigable));
    const pushes = (built as unknown as { pushes: { line: number; type: number; modifiers: number }[] }).pushes;
    expect(pushes.map((p) => p.line)).toEqual([2, 3, 4, 4, 5, 6, 6, 7, 7, 8]);
    expect(pushes[0]!.modifiers).toBe(1);
  });
});

void noLibraries;
