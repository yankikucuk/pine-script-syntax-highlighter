import * as vscode from 'vscode';

import { colorPresentations, findColors, type Rgba } from '../core/colors';
import type { ReferenceIndex } from '../core/reference';
import { semanticTokens, type SemanticKind } from '../core/semantic';
import { analyze } from '../vscode/document-cache';

/** Shows a swatch beside every colour a script names, and writes the picked colour back. */
export class PineColorProvider implements vscode.DocumentColorProvider {
  constructor(private readonly ref: ReferenceIndex) {}

  provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
    return findColors(analyze(document).tokens, this.ref).map(
      (spot) =>
        new vscode.ColorInformation(
          new vscode.Range(spot.line, spot.startCol, spot.line, spot.endCol),
          toVsColor(spot.color),
        ),
    );
  }

  provideColorPresentations(color: vscode.Color): vscode.ColorPresentation[] {
    return colorPresentations(fromVsColor(color)).map((label) => new vscode.ColorPresentation(label));
  }
}

const TOKEN_TYPES: SemanticKind[] = [
  'namespace',
  'type',
  'enum',
  'function',
  'method',
  'property',
  'enumMember',
  'variable',
  'parameter',
];
const TOKEN_MODIFIERS = ['declaration'];

/** The token types and modifiers this extension emits, in the order the builder indexes them. */
export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

/**
 * Colours the names the author declared. Built-ins keep the colours the grammar gives them, so a
 * theme that knows nothing about semantic tokens still looks right.
 */
export class PineSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
    for (const token of semanticTokens(analyze(document))) {
      builder.push(
        token.line,
        token.startCol,
        token.length,
        TOKEN_TYPES.indexOf(token.kind),
        token.isDeclaration ? 1 : 0,
      );
    }
    return builder.build();
  }
}

function toVsColor(color: Rgba): vscode.Color {
  return new vscode.Color(color.red, color.green, color.blue, color.alpha);
}

function fromVsColor(color: vscode.Color): Rgba {
  return { red: color.red, green: color.green, blue: color.blue, alpha: color.alpha };
}
