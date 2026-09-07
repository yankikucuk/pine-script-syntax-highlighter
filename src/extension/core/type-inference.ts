import { visibleVariables, type DocumentModel } from './document-model';
import { ReferenceIndex } from './reference';
import { tokenize, type Token } from './tokenizer';

export interface InferenceScope {
  ref: ReferenceIndex;
  model: DocumentModel;
  line: number;
  compilerTypes?: ReadonlyMap<string, string>;
}

export interface AnnotationEdit {
  line: number;
  column: number;
  insert: string;
}

const INPUT_TYPES: Record<string, string> = {
  'input.int': 'int',
  'input.float': 'float',
  'input.bool': 'bool',
  'input.string': 'string',
  'input.color': 'color',
  'input.source': 'float',
  'input.timeframe': 'string',
  'input.symbol': 'string',
  'input.session': 'string',
  'input.price': 'float',
  'input.time': 'int',
  'input.text_area': 'string',
  'input.enum': 'enum',
  input: 'float',
};
const COMPARISON = new Set(['==', '!=', '<', '<=', '>', '>=']);
const NOT_A_VALUE = new Set(['plot', 'hline', 'void']);

export function inferType(expr: string, scope: InferenceScope): string | null {
  const tokens = tokenize(expr)[0]?.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment') ?? [];
  if (!tokens.length) return null;
  const type = inferTokens(tokens, scope);
  return type === 'na' ? null : type;
}

function inferTokens(tokens: Token[], scope: InferenceScope): string | null {
  if (!tokens.length) return null;
  // Unwrap a single outer group: (expr)
  if (tokens[0]?.text === '(' && matchingClose(tokens, 0) === tokens.length - 1)
    return inferTokens(tokens.slice(1, -1), scope);

  // `array.new<float>()`: the angle brackets are generics, not comparisons.
  if (isGenericCall(tokens)) return inferCall(tokens, scope);

  // Ternary at depth 0: cond ? a : b
  const q = indexAtDepth(tokens, (t) => t.text === '?');
  if (q > 0) {
    const c = indexAtDepth(tokens.slice(q + 1), (t) => t.text === ':');
    if (c > 0) {
      const a = inferTokens(tokens.slice(q + 1, q + 1 + c), scope);
      const b = inferTokens(tokens.slice(q + 2 + c), scope);
      return unify(a, b);
    }
  }
  // Logical operators, `not` and comparisons yield bool.
  if (indexAtDepth(tokens, (t) => t.kind === 'ident' && (t.text === 'and' || t.text === 'or')) >= 0) return 'bool';
  if (tokens[0]?.kind === 'ident' && tokens[0].text === 'not') return 'bool';
  if (indexAtDepth(tokens, (t) => t.kind === 'op' && COMPARISON.has(t.text)) > 0) return 'bool';

  // Binary arithmetic at depth 0, lowest precedence first (+,- before *,/,%).
  for (const ops of [
    ['+', '-'],
    ['*', '/', '%'],
  ]) {
    const i = lastBinaryAtDepth(tokens, ops);
    if (i > 0) {
      const left = inferTokens(tokens.slice(0, i), scope);
      const right = inferTokens(tokens.slice(i + 1), scope);
      if (tokens[i]!.text === '+' && (left === 'string' || right === 'string')) return 'string';
      return numeric(left, right);
    }
  }
  // Unary minus.
  if (tokens[0]?.kind === 'op' && tokens[0].text === '-' && tokens.length > 1)
    return inferTokens(tokens.slice(1), scope);

  const first = tokens[0]!;
  if (first.kind === 'number') return first.text.startsWith('#') ? 'color' : /[.eE]/.test(first.text) ? 'float' : 'int';
  if (first.kind === 'string') return 'string';
  if (first.kind !== 'ident') return null;

  // History reference x[1] keeps the type of x.
  if (tokens.length > 1 && tokens[1]!.text === '[' && matchingClose(tokens, 1) === tokens.length - 1)
    return inferTokens(tokens.slice(0, 1), scope);

  const name = first.text;
  const isCall = tokens[1]?.text === '(' || tokens[1]?.text === '<';
  if (!isCall) {
    if (tokens.length !== 1) return null; // something after an identifier we do not model
    if (name === 'true' || name === 'false') return 'bool';
    if (name === 'na') return 'na';
    const variable = visibleVariables(scope.model, scope.line).find((v) => v.name === name && v.line < scope.line);
    if (variable?.declaredType) return variable.declaredType;
    const entry = scope.ref.get(name, 'variable') ?? scope.ref.get(name, 'constant');
    if (entry?.type) return ReferenceIndex.baseType(entry.type);
    const en = scope.model.enums.find((e) => name.startsWith(`${e.name}.`));
    if (en) return en.name;
    return null;
  }

  return inferCall(tokens, scope);
}

function isGenericCall(tokens: Token[]): boolean {
  if (tokens[0]?.kind !== 'ident' || tokens[1]?.text !== '<') return false;
  const close = tokens.findIndex((t) => t.text === '>');
  return close > 1 && tokens[close + 1]?.text === '(';
}

function inferCall(tokens: Token[], scope: InferenceScope): string | null {
  const name = tokens[0]!.text;
  if (name in INPUT_TYPES) return INPUT_TYPES[name]!;
  if (name.endsWith('.new')) {
    const owner = name.slice(0, -4);
    if (scope.model.types.some((t) => t.name === owner)) return owner;
    if (tokens[1]?.text === '<') {
      const close = tokens.findIndex((t) => t.text === '>');
      if (close > 1)
        return `${owner}<${tokens
          .slice(2, close)
          .map((t) => t.text)
          .join('')}>`;
    }
  }
  if (scope.model.functions.some((f) => f.name === name)) return null; // user function return types need the compiler
  const entry = scope.ref.get(name, 'function');
  if (entry) {
    const argCount = countArgs(tokens);
    const overload = entry.overloads.find((o) => o.params.length >= argCount) ?? entry.overloads[0];
    const ret = overload?.returns?.type;
    if (!ret) return null;
    const base = ReferenceIndex.baseType(ret);
    return base.includes(' ') || NOT_A_VALUE.has(base) ? null : base;
  }
  return null;
}

function countArgs(tokens: Token[]): number {
  const open = tokens.findIndex((t) => t.text === '(');
  if (open < 0) return 0;
  const close = matchingClose(tokens, open);
  const inner = tokens.slice(open + 1, close < 0 ? undefined : close);
  if (!inner.length) return 0;
  let depth = 0;
  let n = 1;
  for (const t of inner) {
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (t.kind === 'comma' && depth === 0) n++;
  }
  return n;
}

function matchingClose(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i]!.kind === 'open') depth++;
    if (tokens[i]!.kind === 'close') depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function indexAtDepth(tokens: Token[], pred: (t: Token) => boolean): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (depth === 0 && pred(t)) return i;
  }
  return -1;
}

// Last binary operator among `ops` at depth 0 whose left neighbour is a value (so unary minus is skipped).
function lastBinaryAtDepth(tokens: Token[], ops: string[]): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    else if (
      depth === 0 &&
      t.kind === 'op' &&
      ops.includes(t.text) &&
      i > 0 &&
      tokens[i - 1]!.kind !== 'op' &&
      tokens[i - 1]!.kind !== 'comma'
    )
      found = i;
  }
  return found;
}

function unify(a: string | null, b: string | null): string | null {
  if (a === 'na') return b === 'na' ? null : b;
  if (b === 'na') return a;
  if (a === b) return a;
  if ((a === 'int' && b === 'float') || (a === 'float' && b === 'int')) return 'float';
  return null;
}

function numeric(a: string | null, b: string | null): string | null {
  if (a === 'na') a = null;
  if (b === 'na') b = null;
  if (a === 'float' || b === 'float') return a && b ? 'float' : null;
  if (a === 'int' && b === 'int') return 'int';
  return null;
}

export function planTypeAnnotations(
  model: DocumentModel,
  ref: ReferenceIndex,
  lines: [number, number] | null,
  compilerTypes?: ReadonlyMap<string, string>,
): { edits: AnnotationEdit[]; skipped: string[] } {
  const edits: AnnotationEdit[] = [];
  const skipped: string[] = [];
  for (const v of model.variables) {
    if (lines && (v.line < lines[0] || v.line > lines[1])) continue;
    if (v.declaredType || v.initializer === null) continue;
    const compiled = compilerTypes?.get(v.name);
    const type = compiled
      ? ReferenceIndex.baseType(compiled)
      : inferType(v.initializer, { ref, model, line: v.line, compilerTypes });
    if (!type || type === 'enum') {
      skipped.push(v.name);
      continue;
    }
    edits.push({ line: v.line, column: v.column, insert: `${type} ` });
  }
  return { edits, skipped };
}
