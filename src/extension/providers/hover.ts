import * as vscode from 'vscode';
import { visibleVariables } from '../core/document-model';
import type { LibraryLookup } from '../core/libraries';
import { entryMarkdown, enumMarkdown, functionMarkdown, typeMarkdown } from '../core/markdown';
import type { ReferenceIndex } from '../core/reference';
import { isInStringOrComment, wordAt } from '../core/tokenizer';
import { analyze } from '../vscode/document-cache';

export class PineHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    const { model, tokens, lines } = analyze(document);
    const lineText = lines[position.line] ?? '';
    const tl = tokens[position.line];

    const importDecl = model.imports.find((i) => i.line === position.line);
    if (importDecl) {
      const lib = await this.libraries.forImport(importDecl);
      if (!lib) return null;
      const exports = [
        ...lib.functions.map((f) => `\`${f.name}()\``),
        ...lib.types.map((t) => `\`${t.name}\``),
        ...lib.enums.map((e) => `\`${e.name}\``),
      ];
      const md = [
        `**${lib.title}** _(${lib.source === 'local' ? 'workspace' : 'TradingView'})_`,
        lib.description ?? '',
        exports.length ? `Exports: ${exports.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      return new vscode.Hover(new vscode.MarkdownString(md));
    }

    if (tl && isInStringOrComment(tl, position.character)) {
      const ann = lineText.slice(0, position.character + 1).match(/\/\/\s*(@\w+)$/) ?? lineText.match(/\/\/\s*(@\w+)/);
      const entry = ann ? this.ref.get(ann[1]!, 'annotation') : undefined;
      return entry ? new vscode.Hover(new vscode.MarkdownString(entryMarkdown(entry, this.ref))) : null;
    }

    const word = wordAt(lineText, position.character);
    if (!word) return null;
    const range = new vscode.Range(position.line, word.start, position.line, word.end);

    // Alias member: ma.weighted
    const dot = word.text.indexOf('.');
    if (dot > 0) {
      const alias = word.text.slice(0, dot);
      const member = word.text.slice(dot + 1);
      const imp = model.imports.find((i) => i.alias === alias);
      if (imp) {
        const lib = await this.libraries.forImport(imp);
        if (lib) {
          const origin = `from ${lib.id}`;
          const f = lib.functions.find((f) => f.name === member);
          if (f) return new vscode.Hover(new vscode.MarkdownString(functionMarkdown(f, origin)), range);
          const t = lib.types.find((t) => t.name === member);
          if (t) return new vscode.Hover(new vscode.MarkdownString(typeMarkdown(t, origin)), range);
          const e = lib.enums.find((e) => e.name === member);
          if (e) return new vscode.Hover(new vscode.MarkdownString(enumMarkdown(e, origin)), range);
        }
      }
    }

    // User symbols.
    const fn = model.functions.find((f) => f.name === word.text || (f.isMethod && word.text.endsWith(`.${f.name}`)));
    if (fn) return new vscode.Hover(new vscode.MarkdownString(functionMarkdown(fn)), range);
    const type = model.types.find((t) => t.name === word.text);
    if (type) return new vscode.Hover(new vscode.MarkdownString(typeMarkdown(type)), range);
    const en = model.enums.find((e) => e.name === word.text || word.text.startsWith(`${e.name}.`));
    if (en) return new vscode.Hover(new vscode.MarkdownString(enumMarkdown(en)), range);
    const variable = visibleVariables(model, position.line).find((v) => v.name === word.text);
    if (variable) {
      const decl = `${variable.qualifier ? `${variable.qualifier} ` : ''}${variable.declaredType ? `${variable.declaredType} ` : ''}${variable.name}${variable.initializer ? ` = ${variable.initializer}` : ''}`;
      return new vscode.Hover(new vscode.MarkdownString('```pine\n' + decl + '\n```'), range);
    }

    // Built-ins: longest dotted match first, then shorter prefixes.
    const candidates = [word.text];
    const parts = word.text.split('.');
    for (let i = parts.length - 1; i > 0; i--) candidates.push(parts.slice(0, i).join('.'));
    for (const name of candidates) {
      const entries = this.ref.getAll(name);
      if (entries.length) {
        const preferred = this.ref.get(name)!;
        const others = entries.filter((e) => e !== preferred);
        const text = [entryMarkdown(preferred, this.ref), ...others.map((e) => entryMarkdown(e, this.ref))].join(
          '\n\n---\n\n',
        );
        return new vscode.Hover(new vscode.MarkdownString(text), range);
      }
    }
    return null;
  }
}
