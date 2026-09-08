import * as vscode from 'vscode';

import { isUserSymbol, occurrencesOf, resolveSymbolAt, type Occurrence, type SymbolTarget } from '../core/symbols';
import { analyze } from '../vscode/document-cache';

/** Go to Definition for the functions, types, enums, variables and imports a document declares. */
export class PineDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | null {
    const target = targetAt(document, position);
    if (!target?.declaration) return null;
    return new vscode.Location(document.uri, rangeOf(target.declaration));
  }
}

/** Find All References, listing the declaration alongside the uses when asked for. */
export class PineReferenceProvider implements vscode.ReferenceProvider {
  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
  ): vscode.Location[] {
    const target = targetAt(document, position);
    if (!target) return [];
    return occurrencesOf(analyze(document), target)
      .filter((o) => context.includeDeclaration || !o.isDeclaration)
      .map((o) => new vscode.Location(document.uri, rangeOf(o)));
  }
}

/** Highlights the other places the symbol under the cursor is written. */
export class PineDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
  provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.DocumentHighlight[] {
    const target = targetAt(document, position);
    if (!target) return [];
    return occurrencesOf(analyze(document), target).map(
      (o) =>
        new vscode.DocumentHighlight(
          rangeOf(o),
          o.isDeclaration ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read,
        ),
    );
  }
}

/** Renames a symbol the document declares. Built-ins are refused rather than half renamed. */
export class PineRenameProvider implements vscode.RenameProvider {
  prepareRename(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
    const target = targetAt(document, position);
    if (!target) throw new Error('There is no symbol here to rename.');
    if (!isUserSymbol(target)) throw new Error(`\`${target.name}\` is part of Pine Script and cannot be renamed.`);
    const word = document.getWordRangeAtPosition(position);
    return word ?? rangeOf(target.declaration!);
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): vscode.WorkspaceEdit | null {
    const target = targetAt(document, position);
    if (!target || !isUserSymbol(target)) return null;
    const replacement = target.kind === 'enumMember' ? qualify(target, newName) : newName;
    const edit = new vscode.WorkspaceEdit();
    for (const occurrence of occurrencesOf(analyze(document), target)) {
      edit.replace(document.uri, rangeOf(occurrence), textFor(target, occurrence, replacement, newName));
    }
    return edit;
  }
}

/** An enum member is written `Enum.member`, so a new name keeps the enum in front of it. */
function qualify(target: SymbolTarget, newName: string): string {
  return newName.includes('.') ? newName : `${target.owner}.${newName}`;
}

/**
 * The declaration of an enum member is written bare inside its own block, while every use carries
 * the enum in front of it.
 */
function textFor(target: SymbolTarget, occurrence: Occurrence, replacement: string, bare: string): string {
  if (target.kind !== 'enumMember') return replacement;
  return occurrence.isDeclaration ? bare : replacement;
}

function targetAt(document: vscode.TextDocument, position: vscode.Position): SymbolTarget | null {
  return resolveSymbolAt(analyze(document), position.line, position.character);
}

function rangeOf(occurrence: Occurrence): vscode.Range {
  return new vscode.Range(occurrence.line, occurrence.startCol, occurrence.line, occurrence.endCol);
}
