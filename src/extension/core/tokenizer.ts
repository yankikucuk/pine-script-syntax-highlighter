/** The coarse categories the grammar-independent tokenizer distinguishes. */
export type TokenKind = 'comment' | 'string' | 'number' | 'ident' | 'op' | 'open' | 'close' | 'comma' | 'ws';

/** One token, with the columns it spans on its line. `line` is a zero-based document line. */
export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  line: number;
}

/**
 * One tokenized line. `depthAtStart` is the bracket nesting the line opens with, which is what marks a
 * wrapped line; `continuesString` says a triple-quoted string is still open at the end of it.
 */
export interface TokenizedLine {
  tokens: Token[];
  depthAtStart: number;
  continuesString: boolean;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;
const NUMBER = /#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const OPS = [
  '=>',
  ':=',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '?',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
];

/**
 * Splits a document into tokens, line by line. It is deliberately not a parser: it tracks strings,
 * comments and bracket depth well enough for every other module to avoid rescanning raw text.
 */
export function tokenize(text: string): TokenizedLine[] {
  const lines = text.split(/\r?\n/);
  const result: TokenizedLine[] = [];
  let depth = 0;
  let openString: string | null = null; // '"""' or "'''" while inside a triple-quoted string

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]!;
    const tokens: Token[] = [];
    const depthAtStart = depth;
    let i = 0;

    const push = (kind: TokenKind, start: number, end: number) => {
      tokens.push({ kind, start, end, text: line.slice(start, end), line: lineNo });
    };

    if (openString) {
      const close = line.indexOf(openString);
      if (close === -1) {
        push('string', 0, line.length);
        result.push({ tokens, depthAtStart, continuesString: true });
        continue;
      }
      push('string', 0, close + 3);
      i = close + 3;
      openString = null;
    }

    while (i < line.length) {
      const ch = line[i]!;
      if (ch === ' ' || ch === '\t') {
        let j = i + 1;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
        push('ws', i, j);
        i = j;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') {
        push('comment', i, line.length);
        i = line.length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const triple = line.startsWith(ch.repeat(3), i);
        if (triple) {
          const close = line.indexOf(ch.repeat(3), i + 3);
          if (close === -1) {
            push('string', i, line.length);
            openString = ch.repeat(3);
            i = line.length;
            continue;
          }
          push('string', i, close + 3);
          i = close + 3;
          continue;
        }
        let j = i + 1;
        while (j < line.length && line[j] !== ch) {
          if (line[j] === '\\') j++;
          j++;
        }
        push('string', i, Math.min(j + 1, line.length));
        i = Math.min(j + 1, line.length);
        continue;
      }
      IDENT.lastIndex = i;
      const id = IDENT.exec(line);
      if (id) {
        push('ident', i, i + id[0].length);
        i += id[0].length;
        continue;
      }
      NUMBER.lastIndex = i;
      const num = NUMBER.exec(line);
      if (num && (ch === '#' || /\d/.test(ch) || (ch === '.' && /\d/.test(line[i + 1] ?? '')))) {
        push('number', i, i + num[0].length);
        i += num[0].length;
        continue;
      }
      if (ch === '(' || ch === '[') {
        depth++;
        push('open', i, i + 1);
        i++;
        continue;
      }
      if (ch === ')' || ch === ']') {
        depth = Math.max(0, depth - 1);
        push('close', i, i + 1);
        i++;
        continue;
      }
      if (ch === ',') {
        push('comma', i, i + 1);
        i++;
        continue;
      }
      const op = OPS.find((o) => line.startsWith(o, i));
      if (op) {
        push('op', i, i + op.length);
        i += op.length;
        continue;
      }
      push('op', i, i + 1);
      i++;
    }
    result.push({ tokens, depthAtStart, continuesString: openString !== null });
  }
  return result;
}

/** The token at a column, preferring an identifier the cursor sits just after (`ta.sma|(`). */
export function tokenAt(tokens: Token[], col: number): Token | undefined {
  const at = tokens.find((t) => t.start <= col && col < t.end);
  if (at?.kind === 'ident') return at;
  // At the end of an identifier the cursor still belongs to it (`ta.sma|(`).
  return tokens.find((t) => t.end === col && t.kind === 'ident') ?? at;
}

/** True when a column falls inside a string or a comment, where completion and hover stay quiet. */
export function isInStringOrComment(line: TokenizedLine, col: number): boolean {
  const t =
    line.tokens.find((t) => t.start <= col && col < t.end) ?? line.tokens.find((t) => t.start < col && col <= t.end);
  if (!t) return line.continuesString && line.tokens.length === 0;
  return t.kind === 'string' || t.kind === 'comment';
}

/** The dotted word around a column, such as `ta.sma`, or null when there is no word there. */
export function wordAt(lineText: string, col: number): { text: string; start: number; end: number } | null {
  const isWord = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = col;
  let end = col;
  while (start > 0 && isWord(lineText[start - 1]!)) start--;
  while (end < lineText.length && isWord(lineText[end]!)) end++;
  if (start === end) return null;
  const text = lineText.slice(start, end).replace(/^\.+|\.+$/g, '');
  if (!text) return null;
  const s = lineText.indexOf(text, start);
  return { text, start: s, end: s + text.length };
}
