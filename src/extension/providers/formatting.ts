import * as vscode from 'vscode';

import { formatDocument, formatRange } from '../core/formatter';

/**
 * Reformats Pine documents. Lines are re-indented and re-spaced but never joined or split, so the
 * structure the author wrote, and the compiler reads, is preserved.
 */
export class PineFormattingProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
  provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
    const text = document.getText();
    const formatted = formatDocument(text, { useTabs: !options.insertSpaces });
    if (formatted === text) return [];
    return [vscode.TextEdit.replace(wholeDocument(document), formatted)];
  }

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
  ): vscode.TextEdit[] {
    const first = range.start.line;
    // A selection that stops at the very start of a line does not include that line.
    const last = range.end.character === 0 && range.end.line > first ? range.end.line - 1 : range.end.line;
    const formatted = formatRange(document.getText(), first, last, { useTabs: !options.insertSpaces });
    const target = new vscode.Range(first, 0, last, lineLength(document, last));
    // The document may use CRLF while the comparison text is joined with LF.
    if (formatted.replace(/\r\n/g, '\n') === textOf(document, first, last)) return [];
    return [vscode.TextEdit.replace(target, formatted)];
  }
}

function wholeDocument(document: vscode.TextDocument): vscode.Range {
  const last = document.lineCount - 1;
  return new vscode.Range(0, 0, last, lineLength(document, last));
}

function lineLength(document: vscode.TextDocument, line: number): number {
  return document.lineAt(line).text.length;
}

function textOf(document: vscode.TextDocument, first: number, last: number): string {
  const lines: string[] = [];
  for (let line = first; line <= last; line++) lines.push(document.lineAt(line).text);
  return lines.join('\n');
}
