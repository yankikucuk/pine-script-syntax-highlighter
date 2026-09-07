// Minimal stand-in for the vscode module so provider code can run under vitest.
export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}
export class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b as Position;
    } else {
      this.start = new Position(a, b as number);
      this.end = new Position(c!, d!);
    }
  }
}
export class MarkdownString {
  isTrusted = false;
  constructor(public value = '') {}
}
export class SnippetString {
  constructor(public value = '') {}
}
export enum CompletionItemKind {
  Text,
  Method,
  Function,
  Constructor,
  Field,
  Variable,
  Class,
  Interface,
  Module,
  Property,
  Unit,
  Value,
  Enum,
  Keyword,
  Snippet,
  Color,
  File,
  Reference,
  Folder,
  EnumMember,
  Constant,
  Struct,
  Event,
  Operator,
  TypeParameter,
}
export class CompletionItem {
  detail?: string;
  documentation?: MarkdownString;
  insertText?: string | SnippetString;
  filterText?: string;
  sortText?: string;
  command?: unknown;
  constructor(
    public label: string,
    public kind?: CompletionItemKind,
  ) {}
}
export class Hover {
  constructor(
    public contents: MarkdownString,
    public range?: Range,
  ) {}
}
export class ParameterInformation {
  constructor(
    public label: string,
    public documentation?: unknown,
  ) {}
}
export class SignatureInformation {
  parameters: ParameterInformation[] = [];
  constructor(
    public label: string,
    public documentation?: unknown,
  ) {}
}
export class SignatureHelp {
  signatures: SignatureInformation[] = [];
  activeSignature = 0;
  activeParameter = 0;
}
export enum SymbolKind {
  File,
  Module,
  Namespace,
  Package,
  Class,
  Method,
  Property,
  Field,
  Constructor,
  Enum,
  Interface,
  Function,
  Variable,
  Constant,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Key,
  Null,
  EnumMember,
  Struct,
  Event,
  Operator,
  TypeParameter,
}
export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range,
  ) {}
}
export class TextEdit {
  constructor(
    public range: Range,
    public newText: string,
  ) {}
  static replace(range: Range, newText: string) {
    return new TextEdit(range, newText);
  }
  static insert(position: Position, newText: string) {
    return new TextEdit(new Range(position, position), newText);
  }
}
export class CodeActionKind {
  static Refactor = new CodeActionKind('refactor');
  constructor(public value: string) {}
}
export class CodeAction {
  command?: unknown;
  constructor(
    public title: string,
    public kind?: CodeActionKind,
  ) {}
}
export class Uri {
  private constructor(public readonly path: string) {}
  static parse(s: string) {
    return new Uri(s);
  }
  static file(s: string) {
    return new Uri(s);
  }
  toString() {
    return this.path;
  }
}

let nextVersion = 1;
export function makeDocument(text: string, uri = `file:///doc${nextVersion}.pine`) {
  const lines = text.split(/\r?\n/);
  return {
    uri: Uri.parse(uri),
    version: nextVersion++,
    languageId: 'pinescript',
    lineCount: lines.length,
    isClosed: false,
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  };
}
