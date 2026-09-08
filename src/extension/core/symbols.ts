import type {
  DocumentModel,
  EnumSymbol,
  FunctionSymbol,
  ImportDecl,
  LineRange,
  TypeSymbol,
  VariableSymbol,
} from './document-model';
import { tokenAt, type Token, type TokenizedLine } from './tokenizer';

/** What a name refers to. `builtin` covers everything the document did not declare. */
export type TargetKind =
  'function' | 'method' | 'type' | 'enum' | 'enumMember' | 'variable' | 'parameter' | 'import' | 'builtin';

/** One place a name is written. */
export interface Occurrence {
  line: number;
  startCol: number;
  endCol: number;
  isDeclaration: boolean;
}

/** The symbol a position refers to, and where its name means that symbol. */
export interface SymbolTarget {
  /** The name being referenced: the first segment of a dotted token, or the whole built-in name. */
  name: string;
  kind: TargetKind;
  declaration: Occurrence | null;
  /** Lines within which occurrences of this name mean this symbol. */
  scope: LineRange;
  /** The function a parameter belongs to, so calls that name it can be found. */
  owner: string | null;
}

/** The parts of a document analysis the symbol lookups need. */
export interface SymbolSource {
  model: DocumentModel;
  tokens: TokenizedLine[];
}

/**
 * Lookups over one document, built once and reused. Without it every caller that walks the
 * identifiers of a file would rescan the whole token stream for each symbol it asks about.
 */
export interface SourceIndex {
  /** Every meaningful token in document order. */
  flat: Token[];
  /** Positions in `flat` of the identifiers sharing a first name segment. */
  byBaseName: Map<string, number[]>;
  importLines: Set<number>;
  variablesByName: Map<string, VariableSymbol[]>;
  functionsByName: Map<string, FunctionSymbol>;
  typesByName: Map<string, TypeSymbol>;
  enumsByName: Map<string, EnumSymbol>;
  importsByAlias: Map<string, ImportDecl>;
  /** For each function, the names its body binds, so a shadowed outer name can be skipped. */
  functionBindings: { range: LineRange; names: ReadonlySet<string> }[];
}

const indexes = new WeakMap<TokenizedLine[], { model: DocumentModel; index: SourceIndex }>();

/** The index for a document, rebuilt only when the document changes. */
export function sourceIndex(source: SymbolSource): SourceIndex {
  const cached = indexes.get(source.tokens);
  if (cached && cached.model === source.model) return cached.index;
  const index = buildIndex(source);
  indexes.set(source.tokens, { model: source.model, index });
  return index;
}

function buildIndex(source: SymbolSource): SourceIndex {
  const flat = flattenTokens(source.tokens);
  const byBaseName = new Map<string, number[]>();
  for (let i = 0; i < flat.length; i++) {
    const token = flat[i]!;
    if (token.kind !== 'ident') continue;
    const dot = token.text.indexOf('.');
    const base = dot < 0 ? token.text : token.text.slice(0, dot);
    const bucket = byBaseName.get(base);
    if (bucket) bucket.push(i);
    else byBaseName.set(base, [i]);
  }
  const { model } = source;
  const variablesByName = new Map<string, VariableSymbol[]>();
  for (const variable of model.variables) {
    const bucket = variablesByName.get(variable.name);
    if (bucket) bucket.push(variable);
    else variablesByName.set(variable.name, [variable]);
  }
  return {
    flat,
    byBaseName,
    importLines: new Set(model.imports.map((i) => i.line)),
    variablesByName,
    functionBindings: bindingsPerFunction(model),
    // A name declared twice keeps its first declaration, which is the one in scope first.
    functionsByName: firstByName(model.functions),
    typesByName: firstByName(model.types),
    enumsByName: firstByName(model.enums),
    importsByAlias: new Map(model.imports.filter((i) => i.alias).map((i) => [i.alias!, i])),
  };
}

/** Collects the parameters and local variables of every function in one pass over the model. */
function bindingsPerFunction(model: DocumentModel): { range: LineRange; names: ReadonlySet<string> }[] {
  const bindings = model.functions.map((f) => ({ range: f.range, names: new Set(f.params.map((p) => p.name)) }));
  for (const variable of model.variables) {
    const owner = bindings.find((b) => variable.line > b.range.start && variable.line <= b.range.end);
    if (owner) owner.names.add(variable.name);
  }
  return bindings;
}

function firstByName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.name)) map.set(item.name, item);
  return map;
}

/** True for a symbol the user declared in this document, which is the only kind that can be renamed. */
export function isUserSymbol(target: SymbolTarget): boolean {
  return target.kind !== 'builtin' && target.declaration !== null;
}

/** Works out what the identifier under the cursor refers to. */
export function resolveSymbolAt(source: SymbolSource, line: number, column: number): SymbolTarget | null {
  const tokens = source.tokens[line]?.tokens;
  if (!tokens) return null;
  const token = tokenAt(tokens, column);
  if (!token || token.kind !== 'ident') return null;

  const segments = token.text.split('.');
  const offset = column - token.start;
  const onFirstSegment = offset <= segments[0]!.length;
  if (!onFirstSegment) return resolveMember(source, token, segments);
  return resolveBase(source, segments[0]!, line, token, tokens);
}

/** Resolves `Enum.member`, and treats every other dotted name as a built-in. */
function resolveMember(source: SymbolSource, token: Token, segments: string[]): SymbolTarget | null {
  const owner = sourceIndex(source).enumsByName.get(segments[0]!);
  const member = owner?.members.find((m) => m.name === segments[1]);
  if (owner && member) {
    const declaration = findNameOnLine(source, member.line, member.name);
    return {
      name: `${owner.name}.${member.name}`,
      kind: 'enumMember',
      declaration,
      scope: wholeFile(source),
      owner: owner.name,
    };
  }
  return { name: token.text, kind: 'builtin', declaration: null, scope: wholeFile(source), owner: null };
}

function resolveBase(
  source: SymbolSource,
  name: string,
  line: number,
  token: Token,
  lineTokens: Token[],
): SymbolTarget {
  const { model } = source;
  const index = sourceIndex(source);
  const calling = nextSignificant(lineTokens, token)?.kind === 'open';

  const enclosing = model.functions.find((f) => line >= f.line && line <= f.range.end);
  const parameter = enclosing?.params.find((p) => p.name === name);
  if (parameter && !calling) {
    return {
      name,
      kind: 'parameter',
      declaration: findParameterDeclaration(source, enclosing!.line, name),
      scope: enclosing!.range,
      owner: enclosing!.name,
    };
  }

  const fn = index.functionsByName.get(name);
  if (fn && calling) {
    return {
      name,
      kind: fn.isMethod ? 'method' : 'function',
      declaration: findNameOnLine(source, fn.line, name),
      scope: wholeFile(source),
      owner: null,
    };
  }

  // The declaration in scope is the closest one above the cursor; failing that, any of that name.
  const sameName = index.variablesByName.get(name);
  let declared: VariableSymbol | undefined = sameName?.[0];
  for (const candidate of sameName ?? []) {
    if (candidate.scope.start > line || line > candidate.scope.end) continue;
    if (!declared || declared.scope.start > line || candidate.line > declared.line) declared = candidate;
  }
  if (declared) {
    return {
      name,
      kind: 'variable',
      declaration: {
        line: declared.line,
        startCol: declared.column,
        endCol: declared.column + name.length,
        isDeclaration: true,
      },
      scope: declared.scope,
      owner: null,
    };
  }

  if (fn) {
    return {
      name,
      kind: fn.isMethod ? 'method' : 'function',
      declaration: findNameOnLine(source, fn.line, name),
      scope: wholeFile(source),
      owner: null,
    };
  }
  const type = index.typesByName.get(name);
  if (type) {
    return {
      name,
      kind: 'type',
      declaration: findNameOnLine(source, type.line, name),
      scope: wholeFile(source),
      owner: null,
    };
  }
  const enumeration = index.enumsByName.get(name);
  if (enumeration) {
    return {
      name,
      kind: 'enum',
      declaration: findNameOnLine(source, enumeration.line, name),
      scope: wholeFile(source),
      owner: null,
    };
  }
  const imported = index.importsByAlias.get(name);
  if (imported) {
    return {
      name,
      kind: 'import',
      declaration: findNameOnLine(source, imported.line, name),
      scope: wholeFile(source),
      owner: null,
    };
  }
  return { name, kind: 'builtin', declaration: null, scope: wholeFile(source), owner: null };
}

/** Every place the target is written, in document order. */
export function occurrencesOf(source: SymbolSource, target: SymbolTarget): Occurrence[] {
  const index = sourceIndex(source);
  const { flat } = index;
  const shadowed = shadowingRanges(index, target);
  const found: Occurrence[] = [];
  const base = target.name.split('.')[0]!;
  for (const i of index.byBaseName.get(base) ?? []) {
    const token = flat[i]!;
    if (token.line < target.scope.start || token.line > target.scope.end) continue;
    if (shadowed.some((r) => token.line >= r.start && token.line <= r.end)) continue;
    if (!matches(token.text, target.name)) continue;
    if (isImportPath(index, i) || isMemberAccess(flat, i)) continue;
    if (isMemberDeclaration(source, token, flat, i) && target.kind !== 'enumMember') continue;
    if (isNamedArgument(flat, i) && !namesOwnParameter(flat, i, target)) continue;
    found.push({
      line: token.line,
      startCol: token.start,
      endCol: token.start + target.name.length,
      isDeclaration: isSamePosition(token, target.declaration),
    });
  }
  // An enum member is written bare inside its own block, so its declaration needs adding by hand.
  const declaration = target.declaration;
  if (declaration && !found.some((o) => o.line === declaration.line && o.startCol === declaration.startCol)) {
    found.push(declaration);
    found.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
  }
  return found;
}

/**
 * Function bodies that declare the same name again, where the name means something else. A global
 * `length` is not the `length` a function takes as a parameter.
 */
function shadowingRanges(index: SourceIndex, target: SymbolTarget): LineRange[] {
  if (target.kind !== 'variable' && target.kind !== 'builtin') return [];
  const declaration = target.declaration?.line ?? -1;
  const ranges: LineRange[] = [];
  for (const binding of index.functionBindings) {
    if (declaration > binding.range.start && declaration <= binding.range.end) continue;
    if (binding.names.has(target.name)) ranges.push(binding.range);
  }
  return ranges;
}

/** A token refers to `name` when it is the name itself or starts with it as a namespace. */
function matches(text: string, name: string): boolean {
  return text === name || text.startsWith(`${name}.`);
}

function isSamePosition(token: Token, declaration: Occurrence | null): boolean {
  return !!declaration && declaration.line === token.line && declaration.startCol === token.start;
}

/** Every token that carries meaning, in document order, each knowing its line. */
function flattenTokens(lines: TokenizedLine[]): Token[] {
  const flat: Token[] = [];
  for (const line of lines)
    for (const token of line.tokens) if (token.kind !== 'ws' && token.kind !== 'comment') flat.push(token);
  return flat;
}

function nextSignificant(tokens: Token[], after: Token): Token | undefined {
  return tokens.find((t) => t.start >= after.end && t.kind !== 'ws' && t.kind !== 'comment');
}

/** The owner, library and version of an `import` are a path, not references to anything. */
export function isImportPath(index: SourceIndex, position: number): boolean {
  const token = index.flat[position]!;
  if (!index.importLines.has(token.line)) return false;
  // Only the alias after `as` is a symbol.
  for (let i = position - 1; i >= 0 && index.flat[i]!.line === token.line; i--) {
    if (index.flat[i]!.text === 'as') return false;
  }
  return true;
}

/** True for the name of a field inside a `type` block or a member inside an `enum` block. */
function isMemberDeclaration(source: SymbolSource, token: Token, flat: Token[], index: number): boolean {
  const inType = source.model.types.some((t) => token.line > t.line && token.line <= t.range.end);
  const inEnum = source.model.enums.some((e) => token.line > e.line && token.line <= e.range.end);
  if (!inType && !inEnum) return false;
  const identsBefore = countIdentsBefore(flat, index);
  return inEnum ? identsBefore === 0 : identsBefore === 1;
}

function countIdentsBefore(flat: Token[], index: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0 && flat[i]!.line === flat[index]!.line; i--) if (flat[i]!.kind === 'ident') count++;
  return count;
}

/** True when the token is the member half of `expression.member`, so it names nothing on its own. */
export function isMemberAccess(flat: Token[], index: number): boolean {
  const previous = flat[index - 1];
  return !!previous && previous.kind === 'op' && previous.text === '.';
}

/** True for `name` in `f(name = value)`, which is the callee's parameter rather than a local symbol. */
export function isNamedArgument(flat: Token[], index: number): boolean {
  const next = flat[index + 1];
  const previous = flat[index - 1];
  if (!next || next.text !== '=') return false;
  return !!previous && (previous.kind === 'open' || previous.kind === 'comma');
}

/** True when a named argument belongs to the very function whose parameter is being tracked. */
function namesOwnParameter(flat: Token[], index: number, target: SymbolTarget): boolean {
  if (target.kind !== 'parameter' || !target.owner) return false;
  return calleeOf(flat, index) === target.owner;
}

/** Walks back to the call this token sits inside and returns the name being called. */
export function calleeOf(flat: Token[], index: number): string | null {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const token = flat[i]!;
    if (token.kind === 'close') depth++;
    else if (token.kind === 'open') {
      if (depth === 0) return flat[i - 1]?.kind === 'ident' ? flat[i - 1]!.text : null;
      depth--;
    }
  }
  return null;
}

function findNameOnLine(source: SymbolSource, line: number, name: string): Occurrence | null {
  const token = source.tokens[line]?.tokens.find((t) => t.kind === 'ident' && t.text === name);
  if (!token) return null;
  return { line, startCol: token.start, endCol: token.end, isDeclaration: true };
}

/** Finds a parameter in the header of its function, which may wrap over several lines. */
function findParameterDeclaration(source: SymbolSource, headerLine: number, name: string): Occurrence | null {
  for (let line = headerLine; line < Math.min(source.tokens.length, headerLine + 20); line++) {
    const tokens = source.tokens[line]!.tokens;
    const openParen = line === headerLine ? tokens.find((t) => t.kind === 'open') : undefined;
    const token = tokens.find(
      (t) => t.kind === 'ident' && t.text === name && (!openParen || t.start > openParen.start),
    );
    if (token) return { line, startCol: token.start, endCol: token.end, isDeclaration: true };
    if (tokens.some((t) => t.kind === 'op' && t.text === '=>')) break;
  }
  return null;
}

function wholeFile(source: SymbolSource): LineRange {
  return { start: 0, end: Math.max(0, source.tokens.length - 1) };
}
