import { tokenize, type Token } from './tokenizer';

export interface FormatOptions {
  /** Indent with one tab per level instead of four spaces. */
  useTabs?: boolean;
}

/** Pine reads a local block as exactly four spaces, or one tab, per level. */
const INDENT_WIDTH = 4;
const MAX_BLANK_LINES = 2;

/** Keywords that only ever appear on a line that opens a local block. */
const BLOCK_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'type', 'enum', 'once']);

/** Keywords that cannot be called, so a `(` after them is a group and takes a space. */
const CONTROL_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'and', 'or', 'not', 'to', 'by', 'in']);

/** The only identifiers whose `<` opens a type parameter list rather than a comparison. */
const GENERIC_OWNERS = new Set(['array', 'matrix', 'map', 'array.new', 'matrix.new', 'map.new']);

/** Operators that cannot end a statement, so the following line continues it. */
const CONTINUING_OPS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '?',
  ':',
  '=',
  ':=',
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
]);

type LineKind = 'blank' | 'comment' | 'code' | 'verbatim';

interface LineInfo {
  kind: LineKind;
  /** Indent width of the original line, with tabs counted as one level. */
  indent: number;
  /** Block depth of a statement, or of a comment once resolved. */
  depth: number;
  continuation: boolean;
  /** True when a continuation line is held open by an unclosed bracket. */
  insideBrackets: boolean;
  /** Index of the statement a continuation line belongs to. */
  parent: number;
  /** Depth the author's own indentation suggests, used to place comments. */
  ownDepth: number;
  /** Depth of the statement above, used to place comments. */
  prevDepth: number;
}

/** Formats a whole document. Lines are never joined or split, only re-indented and re-spaced. */
export function formatDocument(text: string, options: FormatOptions = {}): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const tokenized = tokenize(text);
  const info = classify(lines, tokenized);
  resolveStructure(lines, tokenized, info);
  resolveCommentDepth(info);
  return render(lines, tokenized, info, options).join(eol) + eol;
}

/** Formats `text` but returns only the lines from `startLine` to `endLine`, both inclusive. */
export function formatRange(text: string, startLine: number, endLine: number, options: FormatOptions = {}): string {
  const formatted = formatDocument(text, options).split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return formatted.slice(startLine, endLine + 1).join(eol);
}

function classify(lines: string[], tokenized: ReturnType<typeof tokenize>): LineInfo[] {
  return lines.map((line, i) => {
    const insideString = i > 0 && tokenized[i - 1]!.continuesString;
    const significant = tokenized[i]!.tokens.filter((t) => t.kind !== 'ws');
    let kind: LineKind;
    if (insideString) kind = 'verbatim';
    else if (line.trim() === '') kind = 'blank';
    else if (significant[0]?.kind === 'comment') kind = 'comment';
    else kind = 'code';
    return {
      kind,
      indent: indentWidth(line),
      depth: 0,
      continuation: false,
      insideBrackets: false,
      parent: -1,
      ownDepth: 0,
      prevDepth: 0,
    };
  });
}

/** Counts the leading whitespace of a line, a tab standing for one indent level. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += INDENT_WIDTH;
    else break;
  }
  return width;
}

/**
 * Walks the document once, deriving each statement's block depth from the author's own
 * indentation the way Pine does, and marking the lines that only continue the statement above.
 */
function resolveStructure(lines: string[], tokenized: ReturnType<typeof tokenize>, info: LineInfo[]): void {
  const stack = [0];
  let lastCode = -1;
  let lastStatement = -1;
  let lastStatementDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = info[i]!;
    if (line.kind === 'blank' || line.kind === 'verbatim') continue;
    if (line.kind === 'comment') {
      line.ownDepth = Math.max(0, lastIndexAtOrBelow(stack, line.indent));
      line.prevDepth = lastStatementDepth;
      continue;
    }

    if (isContinuation(i, line, stack, tokenized, lastCode, lastStatement)) {
      line.continuation = true;
      line.insideBrackets = tokenized[i]!.depthAtStart > 0;
      line.parent = lastStatement;
      lastCode = i;
      continue;
    }

    while (stack.length > 1 && line.indent < stack[stack.length - 1]!) stack.pop();
    if (line.indent > stack[stack.length - 1]!) stack.push(line.indent);
    line.depth = stack.length - 1;
    lastCode = i;
    lastStatement = i;
    lastStatementDepth = line.depth;
  }
}

function isContinuation(
  index: number,
  line: LineInfo,
  stack: number[],
  tokenized: ReturnType<typeof tokenize>,
  lastCode: number,
  lastStatement: number,
): boolean {
  if (lastStatement < 0) return false;
  // An unclosed bracket continues the statement whatever the indentation is.
  if (tokenized[index]!.depthAtStart > 0) return true;
  const previous = lastCode >= 0 ? significantTokens(tokenized, lastCode) : [];
  const last = previous[previous.length - 1];
  if (last && last.kind === 'comma') return true;
  if (last && last.kind === 'op' && CONTINUING_OPS.has(last.text)) return true;
  // Outside brackets Pine reads an indent that is not a multiple of four as a wrapped line.
  if (line.indent % INDENT_WIDTH === 0) return false;
  if (stack.includes(line.indent)) return false;
  if (line.indent <= stack[stack.length - 1]!) return false;
  return !opensBlock(previous);
}

/** True when the line above starts a local block, so a deeper line below belongs to that block. */
function opensBlock(tokens: Token[]): boolean {
  const last = tokens[tokens.length - 1];
  if (last && last.kind === 'op' && last.text === '=>') return true;
  return tokens.some((t) => t.kind === 'ident' && BLOCK_KEYWORDS.has(t.text));
}

function significantTokens(tokenized: ReturnType<typeof tokenize>, line: number): Token[] {
  return tokenized[line]!.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
}

function lastIndexAtOrBelow(stack: number[], indent: number): number {
  let found = 0;
  for (let i = 0; i < stack.length; i++) if (stack[i]! <= indent) found = i;
  return found;
}

/**
 * A comment sits at the depth of the statement it introduces, but keeps a deeper position when
 * the author placed it inside the block that just ended.
 */
function resolveCommentDepth(info: LineInfo[]): void {
  let next = 0;
  for (let i = info.length - 1; i >= 0; i--) {
    const line = info[i]!;
    if (line.kind === 'comment') line.depth = Math.max(next, Math.min(line.ownDepth, line.prevDepth));
    else if (line.kind === 'code' && !line.continuation) next = line.depth;
  }
}

function render(
  lines: string[],
  tokenized: ReturnType<typeof tokenize>,
  info: LineInfo[],
  options: FormatOptions,
): string[] {
  const out: string[] = [];
  let blanks = 0;
  let previous: Token | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = info[i]!;
    if (line.kind === 'verbatim') {
      out.push(lines[i]!);
      blanks = 0;
      continue;
    }
    if (line.kind === 'blank') {
      blanks++;
      if (out.length > 0 && blanks <= MAX_BLANK_LINES) out.push('');
      continue;
    }
    blanks = 0;
    const code = formatLine(tokenized[i]!.tokens, line.continuation ? previous : undefined);
    out.push(indentFor(i, info, options) + code);
    if (line.kind === 'code') {
      const significant = tokenized[i]!.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
      previous = significant[significant.length - 1] ?? previous;
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

function indentFor(index: number, info: LineInfo[], options: FormatOptions): string {
  const line = info[index]!;
  if (!line.continuation) return unit(line.depth, options);

  const parent = info[line.parent];
  const parentOld = parent ? parent.indent : 0;
  const parentNew = parent ? parent.depth * INDENT_WIDTH : 0;
  let width = parentNew + (line.indent - parentOld);
  if (width < 0) width = 0;
  // A wrapped line that is not held open by a bracket must not land on a block indent.
  if (!line.insideBrackets && width % INDENT_WIDTH === 0) width += 1;
  if (options.useTabs && parent) {
    const extra = Math.max(0, width - parentNew);
    return '\t'.repeat(parent.depth) + ' '.repeat(extra);
  }
  return ' '.repeat(width);
}

function unit(depth: number, options: FormatOptions): string {
  return options.useTabs ? '\t'.repeat(depth) : ' '.repeat(depth * INDENT_WIDTH);
}

/**
 * Rebuilds a line from its tokens, applying the spacing rules. Strings and comments are copied as
 * they are. `previous` is the last token of the statement this line continues, if it continues one.
 */
export function formatLine(tokens: Token[], previous?: Token): string {
  const sig = tokens.filter((t) => t.kind !== 'ws');
  if (sig.length === 0) return '';
  const generics = markGenerics(sig);
  const unary = markUnary(sig, generics, previous);
  // `import user/library/version` is a path, so its slashes are not division.
  const isImport = sig[0]!.kind === 'ident' && sig[0]!.text === 'import';
  let out = '';
  for (let i = 0; i < sig.length; i++) {
    const token = sig[i]!;
    if (token.kind === 'comment' && i > 0) {
      // Keep the gap the author left before a trailing comment, so aligned comments survive.
      const gap = Math.max(1, token.start - sig[i - 1]!.end);
      out += ' '.repeat(gap) + token.text;
      continue;
    }
    if (i > 0 && !(isImport && isSlash(sig, i)) && needsSpace(sig, i, generics, unary)) out += ' ';
    out += token.text;
  }
  return out;
}

/** Marks the `<` and `>` tokens that delimit a type parameter list. */
function markGenerics(sig: Token[]): Set<number> {
  const marks = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < sig.length; i++) {
    const token = sig[i]!;
    if (token.kind !== 'op') continue;
    if (token.text === '<') {
      const previous = sig[i - 1];
      if (previous?.kind === 'ident' && GENERIC_OWNERS.has(previous.text)) {
        open.push(i);
        marks.add(i);
      }
    } else if (token.text === '>' && open.length > 0) {
      open.pop();
      marks.add(i);
    }
  }
  for (const unmatched of open) marks.delete(unmatched);
  return marks;
}

/** Marks the `+`, `-` and `!` tokens that apply to a single operand instead of joining two. */
function markUnary(sig: Token[], generics: Set<number>, carried?: Token): Set<number> {
  const marks = new Set<number>();
  for (let i = 0; i < sig.length; i++) {
    const token = sig[i]!;
    if (token.kind !== 'op' || (token.text !== '-' && token.text !== '+' && token.text !== '!')) continue;
    const previous = i === 0 ? carried : sig[i - 1];
    if (
      !previous ||
      previous.kind === 'open' ||
      previous.kind === 'comma' ||
      (previous.kind === 'op' && !(i > 0 && generics.has(i - 1))) ||
      (previous.kind === 'ident' && CONTROL_KEYWORDS.has(previous.text))
    ) {
      marks.add(i);
    }
  }
  return marks;
}

/** True when the token at `i`, or the one before it, is the `/` of an import path. */
function isSlash(sig: Token[], i: number): boolean {
  const slash = (t: Token | undefined) => t?.kind === 'op' && t.text === '/';
  return slash(sig[i]) || slash(sig[i - 1]);
}

function needsSpace(sig: Token[], i: number, generics: Set<number>, unary: Set<number>): boolean {
  const token = sig[i]!;
  const previous = sig[i - 1]!;
  const isDot = (t: Token) => t.kind === 'op' && t.text === '.';
  if (isDot(token) || isDot(previous)) return false;
  if (generics.has(i)) return false;
  if (generics.has(i - 1)) {
    if (previous.text === '<') return false;
    return token.kind !== 'open' && token.kind !== 'close' && token.kind !== 'comma';
  }
  if (token.kind === 'comma') return false;
  if (previous.kind === 'comma') return true;
  if (unary.has(i)) return previous.kind !== 'open';
  if (unary.has(i - 1)) return false;
  if (token.kind === 'close') return false;
  if (previous.kind === 'open') return false;
  if (token.kind === 'open') {
    if (previous.kind === 'ident') return CONTROL_KEYWORDS.has(previous.text);
    return previous.kind === 'op';
  }
  return true;
}
