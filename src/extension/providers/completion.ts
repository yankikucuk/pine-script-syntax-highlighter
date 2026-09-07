import * as vscode from 'vscode';
import { completionContext } from '../core/context';
import type { DocumentModel, EnumSymbol, FunctionSymbol, TypeSymbol } from '../core/document-model';
import { visibleVariables } from '../core/document-model';
import type { LibraryInfo, LibraryLookup } from '../core/libraries';
import {
  entryDetail,
  entryMarkdown,
  enumMarkdown,
  functionMarkdown,
  functionSignatureLabel,
  typeMarkdown,
} from '../core/markdown';
import type { RefEntry, ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';

const KEYWORDS = [
  'and',
  'or',
  'not',
  'if',
  'else',
  'for',
  'to',
  'by',
  'in',
  'while',
  'switch',
  'once',
  'var',
  'varip',
  'import',
  'export',
  'method',
  'type',
  'enum',
  'true',
  'false',
  'na',
  'series',
  'simple',
  'const',
  'input',
];
const TYPES = [
  'int',
  'float',
  'bool',
  'string',
  'color',
  'line',
  'label',
  'box',
  'table',
  'linefill',
  'polyline',
  'array',
  'matrix',
  'map',
  'chart.point',
  'footprint',
  'volume_row',
];

const KIND: Record<RefEntry['kind'], vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  constant: vscode.CompletionItemKind.Constant,
  keyword: vscode.CompletionItemKind.Keyword,
  type: vscode.CompletionItemKind.Class,
  annotation: vscode.CompletionItemKind.Keyword,
  operator: vscode.CompletionItemKind.Operator,
};

const TRIGGER_HINTS: vscode.Command = {
  command: 'editor.action.triggerParameterHints',
  title: 'Trigger parameter hints',
};

export class PineCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const { model, tokens, lines } = analyze(document);
    const ctx = completionContext(tokens, lines[position.line] ?? '', position.line, position.character);
    switch (ctx.kind) {
      case 'none':
        return [];
      case 'annotation':
        return this.ref.byKind('annotation').map((e) => this.entryItem(e, e.name.replace(/^@/, '')));
      case 'import-path':
        return this.importItems(ctx.prefix, position, lines[position.line] ?? '');
      case 'member':
        return this.memberItems(ctx.receiver, model);
      case 'named-arg':
        return [
          ...this.namedArgItems(ctx.call.name, ctx.call.usedNamedArgs, model),
          ...this.identifierItems(model, position.line),
        ];
      case 'identifier':
        return this.identifierItems(model, position.line);
    }
  }

  private entryItem(
    entry: RefEntry,
    label = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1) : entry.name,
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, KIND[entry.kind]);
    item.detail = entryDetail(entry);
    item.documentation = new vscode.MarkdownString(entryMarkdown(entry, this.ref));
    if (entry.kind === 'function') {
      item.insertText = new vscode.SnippetString(`${label}($1)`);
      item.command = TRIGGER_HINTS;
    }
    return item;
  }

  private namespaceItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = 'namespace';
    return item;
  }

  private identifierItems(model: DocumentModel, line: number): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    for (const ns of this.ref.childNamespaces('')) items.push(this.namespaceItem(ns));
    for (const e of this.ref.bare()) items.push(this.entryItem(e));
    for (const k of KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
    for (const t of TYPES) items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.Class));
    for (const f of model.functions) items.push(userFunctionItem(f));
    for (const t of model.types) items.push(userTypeItem(t));
    for (const e of model.enums) items.push(userEnumItem(e));
    for (const v of visibleVariables(model, line)) {
      const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
      if (v.declaredType) item.detail = v.declaredType;
      items.push(item);
    }
    for (const imp of model.imports) {
      if (imp.alias) {
        const item = new vscode.CompletionItem(imp.alias, vscode.CompletionItemKind.Module);
        item.detail = `${imp.owner}/${imp.name}/${imp.version}`;
        items.push(item);
      }
    }
    return items;
  }

  private async memberItems(receiver: string, model: DocumentModel): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    for (const ns of this.ref.childNamespaces(receiver)) items.push(this.namespaceItem(ns));
    for (const e of this.ref.members(receiver)) items.push(this.entryItem(e));

    const type = model.types.find((t) => t.name === receiver);
    if (type) {
      const ctor = new vscode.CompletionItem('new', vscode.CompletionItemKind.Constructor);
      ctor.insertText = new vscode.SnippetString('new($1)');
      ctor.detail = `${type.name}.new(${type.fields.map((f) => f.name).join(', ')})`;
      ctor.command = TRIGGER_HINTS;
      items.push(ctor);
      for (const f of type.fields) {
        const field = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Field);
        field.detail = f.type;
        items.push(field);
      }
    }
    const en = model.enums.find((e) => e.name === receiver);
    if (en)
      for (const m of en.members) items.push(new vscode.CompletionItem(m.name, vscode.CompletionItemKind.EnumMember));

    const imp = model.imports.find((i) => i.alias === receiver);
    if (imp) {
      const lib = await this.libraries.forImport(imp);
      if (lib) items.push(...libraryExportItems(lib));
    }
    return items;
  }

  private namedArgItems(callee: string, used: string[], model: DocumentModel): vscode.CompletionItem[] {
    const names = new Set<string>();
    const entry = this.ref.get(callee, 'function');
    if (entry) for (const o of entry.overloads) for (const p of o.params) names.add(p.name);
    const fn = model.functions.find((f) => f.name === callee);
    if (fn) for (const p of fn.params) names.add(p.name);
    return [...names]
      .filter((n) => !used.includes(n))
      .map((n) => {
        const item = new vscode.CompletionItem(`${n}=`, vscode.CompletionItemKind.Property);
        item.insertText = `${n} = `;
        item.filterText = n;
        item.sortText = `0${n}`;
        item.detail = 'named argument';
        return item;
      });
  }

  private async importItems(
    prefix: string,
    position: vscode.Position,
    lineText: string,
  ): Promise<vscode.CompletionItem[]> {
    const local = this.libraries.local();
    const remote = await this.libraries.search(prefix);
    // The default word range stops at `/`; replace everything typed after `import ` instead.
    const start = lineText.slice(0, position.character).match(/^\s*import\s+/)?.[0].length ?? position.character;
    const range = new vscode.Range(position.line, start, position.line, position.character);
    return [...local, ...remote].map((lib) => {
      const item = new vscode.CompletionItem(lib.id, vscode.CompletionItemKind.Module);
      item.detail = lib.source === 'local' ? 'workspace library' : 'TradingView library';
      if (lib.description) item.documentation = new vscode.MarkdownString(lib.description);
      item.filterText = lib.id;
      item.range = range;
      return item;
    });
  }
}

export function userFunctionItem(f: FunctionSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    f.name,
    f.isMethod ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Function,
  );
  item.detail = functionSignatureLabel(f);
  item.documentation = new vscode.MarkdownString(functionMarkdown(f, origin));
  item.insertText = new vscode.SnippetString(`${f.name}($1)`);
  item.command = TRIGGER_HINTS;
  return item;
}

export function userTypeItem(t: TypeSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Class);
  item.documentation = new vscode.MarkdownString(typeMarkdown(t, origin));
  return item;
}

export function userEnumItem(e: EnumSymbol, origin?: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Enum);
  item.documentation = new vscode.MarkdownString(enumMarkdown(e, origin));
  return item;
}

export function libraryExportItems(lib: LibraryInfo): vscode.CompletionItem[] {
  const origin = `from ${lib.id}`;
  return [
    ...lib.functions.map((f) => userFunctionItem(f, origin)),
    ...lib.types.map((t) => userTypeItem(t, origin)),
    ...lib.enums.map((e) => userEnumItem(e, origin)),
  ];
}
