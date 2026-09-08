import {
  flattenTokens,
  isImportPath,
  isMemberAccess,
  isNamedArgument,
  resolveSymbolAt,
  type SymbolSource,
  type SymbolTarget,
} from './symbols';

/** Token types the editor understands, limited to the ones a Pine document can produce. */
export type SemanticKind =
  'function' | 'method' | 'type' | 'enum' | 'enumMember' | 'parameter' | 'variable' | 'property' | 'namespace';

export interface SemanticToken {
  line: number;
  startCol: number;
  length: number;
  kind: SemanticKind;
  isDeclaration: boolean;
}

const OF_TARGET: Partial<Record<SymbolTarget['kind'], SemanticKind>> = {
  function: 'function',
  method: 'method',
  type: 'type',
  enum: 'enum',
  enumMember: 'enumMember',
  parameter: 'parameter',
  variable: 'variable',
  import: 'namespace',
};

/**
 * Classifies the identifiers the user declared. Built-ins are left out on purpose: the grammar
 * already colours those, and only the document itself knows which names are the author's own.
 */
export function semanticTokens(source: SymbolSource): SemanticToken[] {
  const flat = flattenTokens(source.tokens);
  const declared = declaredNames(source);
  const out: SemanticToken[] = [];
  for (let i = 0; i < flat.length; i++) {
    const token = flat[i]!;
    if (token.kind !== 'ident') continue;
    if (!declared.has(token.text.split('.')[0]!)) continue;
    if (isImportPath(flat, i) || isNamedArgument(flat, i) || isMemberAccess(flat, i)) continue;

    const field = memberDeclaration(source, token.line, token.start, token.text);
    if (field) {
      out.push({ line: token.line, startCol: token.start, length: token.text.length, ...field });
      continue;
    }

    const target = resolveSymbolAt(source, token.line, token.start);
    if (!target) continue;
    const kind = OF_TARGET[target.kind];
    if (!kind) continue;
    // `Regime.bull` reads better coloured as one enum member than as an enum and a stray word.
    const member = kind === 'enum' ? enumMemberOf(source, token.text) : null;
    out.push({
      line: token.line,
      startCol: token.start,
      length: member ? token.text.length : target.name.length,
      kind: member ? 'enumMember' : kind,
      isDeclaration: target.declaration?.line === token.line && target.declaration.startCol === token.start,
    });
  }
  return out;
}

/** The names the author declared, used to skip the built-ins that make up most of a script. */
function declaredNames(source: SymbolSource): Set<string> {
  const { model } = source;
  const names = new Set<string>();
  for (const fn of model.functions) {
    names.add(fn.name);
    for (const param of fn.params) names.add(param.name);
  }
  for (const type of model.types) {
    names.add(type.name);
    for (const field of type.fields) names.add(field.name);
  }
  for (const enumeration of model.enums) {
    names.add(enumeration.name);
    for (const member of enumeration.members) names.add(member.name);
  }
  for (const variable of model.variables) names.add(variable.name);
  for (const imported of model.imports) if (imported.alias) names.add(imported.alias);
  return names;
}

function enumMemberOf(source: SymbolSource, text: string): boolean {
  const [name, member] = text.split('.');
  return source.model.enums.some((e) => e.name === name && e.members.some((m) => m.name === member));
}

/** Recognises the name of a field inside a `type` block or a member inside an `enum` block. */
function memberDeclaration(
  source: SymbolSource,
  line: number,
  column: number,
  text: string,
): { kind: SemanticKind; isDeclaration: boolean } | null {
  const type = source.model.types.find((t) => line > t.line && line <= t.range.end);
  if (type) {
    const idents = source.tokens[line]!.tokens.filter((t) => t.kind === 'ident');
    if (idents[1]?.start === column && type.fields.some((f) => f.name === text))
      return { kind: 'property', isDeclaration: true };
    return null;
  }
  const enumeration = source.model.enums.find((e) => line > e.line && line <= e.range.end);
  if (enumeration) {
    const idents = source.tokens[line]!.tokens.filter((t) => t.kind === 'ident');
    if (idents[0]?.start === column && enumeration.members.some((m) => m.name === text))
      return { kind: 'enumMember', isDeclaration: true };
  }
  return null;
}
