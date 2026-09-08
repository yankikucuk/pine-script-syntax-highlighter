import type { Token, TokenizedLine } from './tokenizer';

/** The call the cursor sits inside, and which argument it is on. */
export interface CallInfo {
  name: string;
  argIndex: number;
  namedArg: string | null;
  usedNamedArgs: string[];
  line: number;
  column: number;
}

const MAX_LINES_BACK = 50;

// Flattens tokens from up to MAX_LINES_BACK lines before the cursor, keeping only what precedes (line, col).
function tokensBefore(tokenLines: TokenizedLine[], line: number, col: number): Token[] {
  const out: Token[] = [];
  for (let l = Math.max(0, line - MAX_LINES_BACK); l <= line; l++) {
    for (const t of tokenLines[l]?.tokens ?? []) {
      if (t.kind === 'ws' || t.kind === 'comment') continue;
      if (l === line && t.start >= col) break;
      if (l === line && t.end > col) {
        out.push({ ...t, end: col, text: t.text.slice(0, col - t.start) });
        break;
      }
      out.push(t);
    }
  }
  return out;
}

/**
 * Finds the innermost call the cursor is inside, looking back over wrapped lines. Grouping
 * parentheses and index brackets are stepped over, so their commas do not count as arguments.
 */
export function enclosingCall(tokenLines: TokenizedLine[], line: number, col: number): CallInfo | null {
  const tokens = tokensBefore(tokenLines, line, col);
  let depth = 0;
  let commas = 0;
  let openIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind === 'close') depth++;
    else if (t.kind === 'open') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const callee = tokens[i - 1];
      if (t.text === '(' && callee?.kind === 'ident') {
        openIndex = i;
        break;
      }
      // Grouping parens or an index: keep looking outward; commas inside them do not count.
      commas = 0;
      continue;
    } else if (t.kind === 'comma' && depth === 0) commas++;
  }
  if (openIndex === -1) return null;
  const callee = tokens[openIndex - 1]!;

  // Split the argument region into top-level segments to find named arguments.
  const args: Token[][] = [[]];
  let d = 0;
  for (const t of tokens.slice(openIndex + 1)) {
    if (t.kind === 'open') d++;
    if (t.kind === 'close') d--;
    if (t.kind === 'comma' && d === 0) {
      args.push([]);
      continue;
    }
    args[args.length - 1]!.push(t);
  }
  const usedNamedArgs: string[] = [];
  for (const seg of args) {
    if (seg[0]?.kind === 'ident' && seg[1]?.kind === 'op' && seg[1].text === '=') usedNamedArgs.push(seg[0].text);
  }
  const current = args[args.length - 1]!;
  const namedArg =
    current[0]?.kind === 'ident' && current[1]?.kind === 'op' && current[1].text === '=' ? current[0].text : null;

  return { name: callee.text, argIndex: commas, namedArg, usedNamedArgs, line: callee.line, column: callee.start };
}
