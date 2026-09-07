import * as vscode from 'vscode';
import { analyze } from '../vscode/document-cache';

export class PineDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const { model, lines } = analyze(document);
    const symbols: vscode.DocumentSymbol[] = [];
    const lineRange = (start: number, end: number) => new vscode.Range(start, 0, end, lines[end]?.length ?? 0);

    for (const f of model.functions) {
      symbols.push(
        new vscode.DocumentSymbol(
          f.name,
          f.isMethod ? 'method' : 'function',
          f.isMethod ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
          lineRange(f.range.start, f.range.end),
          lineRange(f.line, f.line),
        ),
      );
    }
    for (const t of model.types) {
      const s = new vscode.DocumentSymbol(
        t.name,
        'type',
        vscode.SymbolKind.Struct,
        lineRange(t.range.start, t.range.end),
        lineRange(t.line, t.line),
      );
      s.children = t.fields.map(
        (f, i) =>
          new vscode.DocumentSymbol(
            f.name,
            f.type,
            vscode.SymbolKind.Field,
            lineRange(t.line + 1 + i, t.line + 1 + i),
            lineRange(t.line + 1 + i, t.line + 1 + i),
          ),
      );
      symbols.push(s);
    }
    for (const e of model.enums) {
      const s = new vscode.DocumentSymbol(
        e.name,
        'enum',
        vscode.SymbolKind.Enum,
        lineRange(e.range.start, e.range.end),
        lineRange(e.line, e.line),
      );
      s.children = e.members.map(
        (m, i) =>
          new vscode.DocumentSymbol(
            m.name,
            m.title ?? '',
            vscode.SymbolKind.EnumMember,
            lineRange(e.line + 1 + i, e.line + 1 + i),
            lineRange(e.line + 1 + i, e.line + 1 + i),
          ),
      );
      symbols.push(s);
    }
    for (const v of model.variables) {
      if (model.functions.some((f) => v.line > f.line && v.line <= f.range.end)) continue; // locals stay out of the outline
      symbols.push(
        new vscode.DocumentSymbol(
          v.name,
          v.declaredType ?? '',
          vscode.SymbolKind.Variable,
          lineRange(v.line, v.line),
          new vscode.Range(v.line, v.column, v.line, v.column + v.name.length),
        ),
      );
    }
    return symbols.sort((a, b) => a.range.start.line - b.range.start.line);
  }
}
