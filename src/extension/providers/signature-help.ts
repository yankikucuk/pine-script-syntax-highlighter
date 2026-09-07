import * as vscode from 'vscode';
import { enclosingCall } from '../core/call-resolver';
import type { FunctionSymbol } from '../core/document-model';
import type { LibraryLookup } from '../core/libraries';
import { functionSignatureLabel } from '../core/markdown';
import type { ReferenceIndex } from '../core/reference';
import { analyze } from '../vscode/document-cache';

export class PineSignatureHelpProvider implements vscode.SignatureHelpProvider {
  constructor(
    private readonly ref: ReferenceIndex,
    private readonly libraries: LibraryLookup,
  ) {}

  async provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.SignatureHelp | null> {
    const { model, tokens } = analyze(document);
    const call = enclosingCall(tokens, position.line, position.character);
    if (!call) return null;

    const help = new vscode.SignatureHelp();
    const entry = this.ref.get(call.name, 'function');
    if (entry) {
      for (const o of entry.overloads) {
        const sig = new vscode.SignatureInformation(o.syntax, new vscode.MarkdownString(entry.description));
        sig.parameters = o.params.map(
          (p) => new vscode.ParameterInformation(p.name, new vscode.MarkdownString(`(${p.type}) ${p.description}`)),
        );
        help.signatures.push(sig);
      }
    } else {
      let fn: FunctionSymbol | undefined = model.functions.find((f) => f.name === call.name);
      let origin: string | undefined;
      const dot = call.name.indexOf('.');
      if (!fn && dot > 0) {
        const owner = call.name.slice(0, dot);
        const member = call.name.slice(dot + 1);
        const imp = model.imports.find((i) => i.alias === owner);
        const lib = imp ? await this.libraries.forImport(imp) : null;
        fn = lib?.functions.find((f) => f.name === member);
        origin = lib?.id;
        if (!fn) {
          const type = model.types.find((t) => t.name === owner);
          if (type && member === 'new') {
            const sig = new vscode.SignatureInformation(
              `${type.name}.new(${type.fields.map((f) => `${f.type} ${f.name}${f.default ? ` = ${f.default}` : ''}`).join(', ')})`,
            );
            sig.parameters = type.fields.map((f) => new vscode.ParameterInformation(f.name, type.docs.fields[f.name]));
            help.signatures.push(sig);
          }
        }
      }
      if (fn) {
        const docs = fn.docs;
        const sig = new vscode.SignatureInformation(
          functionSignatureLabel(fn),
          new vscode.MarkdownString(origin ? `_from ${origin}_\n\n${docs.function ?? ''}` : (docs.function ?? '')),
        );
        sig.parameters = fn.params.map((p) => new vscode.ParameterInformation(p.name, docs.params[p.name]));
        help.signatures.push(sig);
      }
    }
    if (!help.signatures.length) return null;

    // Active signature: first whose parameter count covers the current argument; active parameter: named or positional.
    help.activeSignature = Math.max(
      0,
      help.signatures.findIndex((s) => s.parameters.length > call.argIndex),
    );
    const active = help.signatures[help.activeSignature]!;
    const named = call.namedArg ? active.parameters.findIndex((p) => p.label === call.namedArg) : -1;
    help.activeParameter = named >= 0 ? named : Math.min(call.argIndex, Math.max(0, active.parameters.length - 1));
    return help;
  }
}
