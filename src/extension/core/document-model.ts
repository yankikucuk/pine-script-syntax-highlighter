import { tokenize, type TokenizedLine } from './tokenizer';

/** An inclusive span of document lines. */
export interface LineRange {
  start: number;
  end: number;
}

/** The `//@` documentation written above a declaration, split by tag. */
export interface Annotations {
  function: string | null;
  description: string | null;
  params: Record<string, string>;
  returns: string | null;
  type: string | null;
  fields: Record<string, string>;
  enum: string | null;
  raw: string[];
}

/** One parameter of a user function, as written in its header. */
export interface ParamDecl {
  name: string;
  type: string | null;
  default: string | null;
}

/** A function or method the document declares. `range` covers the header and the body. */
export interface FunctionSymbol {
  kind: 'function';
  name: string;
  isMethod: boolean;
  isExport: boolean;
  params: ParamDecl[];
  docs: Annotations;
  line: number;
  range: LineRange;
  /** Trimmed text of the last non-blank body line, or null for an empty body. */
  lastLine: string | null;
}

/** One field of a user type, with the line it is written on. */
export interface FieldDecl {
  name: string;
  type: string;
  default: string | null;
  line: number;
}

/** A user-defined type and its fields. */
export interface TypeSymbol {
  kind: 'type';
  name: string;
  isExport: boolean;
  fields: FieldDecl[];
  docs: Annotations;
  line: number;
  range: LineRange;
}

/** One member of a user enum, with the line it is written on. */
export interface EnumMember {
  name: string;
  title: string | null;
  line: number;
}

/** A user-defined enum and its members. */
export interface EnumSymbol {
  kind: 'enum';
  name: string;
  isExport: boolean;
  members: EnumMember[];
  docs: Annotations;
  line: number;
  range: LineRange;
}

/**
 * A variable the document declares. `scope` is where the name refers to this declaration: the rest
 * of the file, the enclosing function body, or the loop block for a `for` counter.
 */
export interface VariableSymbol {
  kind: 'variable';
  name: string;
  declaredType: string | null;
  qualifier: 'var' | 'varip' | null;
  initializer: string | null;
  line: number;
  column: number;
  scope: LineRange;
}

/** An `import owner/library/version as alias` line. */
export interface ImportDecl {
  owner: string;
  name: string;
  version: string;
  alias: string | null;
  line: number;
}

/** Everything read from one document without asking the compiler. */
export interface DocumentModel {
  version: number | null;
  scriptKind: 'indicator' | 'strategy' | 'library' | null;
  libraryTitle: string | null;
  imports: ImportDecl[];
  functions: FunctionSymbol[];
  types: TypeSymbol[];
  enums: EnumSymbol[];
  variables: VariableSymbol[];
  lineCount: number;
}

/** The declarations that can carry a `//@` documentation block. */
export type DeclSymbol = FunctionSymbol | TypeSymbol | EnumSymbol;

const TYPE = String.raw`[A-Za-z_][\w.]*(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?(?:\[\])?`;
const NAME = String.raw`[A-Za-z_]\w*`;
const RE_VERSION = /^\/\/@version\s*=\s*(\d+)/;
const RE_DECLARATION = /^(indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?("([^"]*)"|'([^']*)')?/;
const RE_IMPORT = /^import\s+([\w-]+)\/([\w-]+)\/(\d+)(?:\s+as\s+(\w+))?/;
const RE_FUNCTION_HEAD = new RegExp(String.raw`^(export\s+)?(method\s+)?(${NAME})\s*\(`);
const RE_TYPE = new RegExp(String.raw`^(export\s+)?type\s+(${NAME})\s*$`);
const RE_ENUM = new RegExp(String.raw`^(export\s+)?enum\s+(${NAME})\s*$`);
const RE_FIELD = new RegExp(String.raw`^(${TYPE})\s+(${NAME})(?:\s*=\s*(.+))?$`);
const RE_ENUM_MEMBER = new RegExp(String.raw`^(${NAME})(?:\s*=\s*(.+))?$`);
const RE_VARIABLE = new RegExp(String.raw`^(?:(var|varip)\s+)?(?:(${TYPE})\s+)?(${NAME})\s*=(?![=>])\s*(.*)$`);
const RE_FOR_COUNTER = new RegExp(String.raw`^for\s+(${NAME})\s*=(?![=>])`);
const RE_FOR_IN = new RegExp(String.raw`^for\s+(?:\[\s*(${NAME})\s*,\s*(${NAME})\s*\]|(${NAME}))\s+in\b`);
const RE_TUPLE = /^\[\s*([\w\s,]+)\]\s*=(?![=>])/;
const RE_PARAM = new RegExp(String.raw`^(?:(${TYPE})\s+)?(${NAME})(?:\s*=\s*(.+))?$`);

const KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'once',
  'and',
  'or',
  'not',
  'import',
  'export',
  'type',
  'enum',
  'method',
  'var',
  'varip',
]);

/** An annotation block with nothing filled in. */
export function emptyAnnotations(): Annotations {
  return { function: null, description: null, params: {}, returns: null, type: null, fields: {}, enum: null, raw: [] };
}

/**
 * Reads a document into a model of what it declares. Wrapped lines and lines inside strings are
 * skipped, so only real statements are considered.
 */
export function buildModel(text: string): DocumentModel {
  const lines = text.split(/\r?\n/);
  const tokenLines = tokenize(text);
  const model: DocumentModel = {
    version: null,
    scriptKind: null,
    libraryTitle: null,
    imports: [],
    functions: [],
    types: [],
    enums: [],
    variables: [],
    lineCount: lines.length,
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const tl = tokenLines[i]!;
    if (tl.depthAtStart > 0 || tl.tokens[0]?.kind === 'string') continue; // continuation line
    const indent = raw.length - raw.trimStart().length;
    const code = stripComment(raw, tl).trim();
    if (!code) {
      const v = raw.match(RE_VERSION);
      if (v) model.version = Number(v[1]);
      continue;
    }

    if (indent === 0) {
      const decl = code.match(RE_DECLARATION);
      if (decl) {
        model.scriptKind = decl[1] as DocumentModel['scriptKind'];
        if (decl[1] === 'library') model.libraryTitle = decl[3] ?? decl[4] ?? null;
      }
      const imp = code.match(RE_IMPORT);
      if (imp) {
        model.imports.push({ owner: imp[1]!, name: imp[2]!, version: imp[3]!, alias: imp[4] ?? null, line: i });
        continue;
      }
    }

    const typeMatch = code.match(RE_TYPE);
    if (typeMatch) {
      const range = blockRange(lines, i, indent);
      const fields: FieldDecl[] = [];
      for (let j = i + 1; j <= range.end; j++) {
        const f = stripComment(lines[j]!, tokenLines[j]!).trim().match(RE_FIELD);
        if (f) fields.push({ name: f[2]!, type: f[1]!, default: f[3]?.trim() ?? null, line: j });
      }
      model.types.push({
        kind: 'type',
        name: typeMatch[2]!,
        isExport: !!typeMatch[1],
        fields,
        docs: annotationsAbove(lines, i),
        line: i,
        range,
      });
      i = range.end;
      continue;
    }

    const enumMatch = code.match(RE_ENUM);
    if (enumMatch) {
      const range = blockRange(lines, i, indent);
      const members: EnumMember[] = [];
      for (let j = i + 1; j <= range.end; j++) {
        const m = stripComment(lines[j]!, tokenLines[j]!).trim().match(RE_ENUM_MEMBER);
        if (m) members.push({ name: m[1]!, title: m[2]?.trim() ?? null, line: j });
      }
      model.enums.push({
        kind: 'enum',
        name: enumMatch[2]!,
        isExport: !!enumMatch[1],
        members,
        docs: annotationsAbove(lines, i),
        line: i,
        range,
      });
      i = range.end;
      continue;
    }

    const fn = code.match(RE_FUNCTION_HEAD);
    if (fn && !KEYWORDS.has(fn[3]!)) {
      const header = joinHeader(lines, tokenLines, i);
      if (header && /=>\s*$/.test(header.text)) {
        const range = blockRange(lines, header.endLine, indent);
        range.start = i;
        const paramText = header.text.slice(header.text.indexOf('(') + 1, header.text.lastIndexOf(')'));
        const body = lines.slice(header.endLine + 1, range.end + 1).filter((l) => l.trim());
        model.functions.push({
          kind: 'function',
          name: fn[3]!,
          isMethod: !!fn[2],
          isExport: !!fn[1],
          params: parseParams(paramText),
          docs: annotationsAbove(lines, i),
          line: i,
          range,
          lastLine: body.length ? body[body.length - 1]!.trim() : null,
        });
        // Body variables are collected by the main loop; only the header lines are skipped here.
        i = header.endLine;
        continue;
      }
    }

    // A `for` header declares its counter, or its index and element, for the length of the loop.
    const counter = code.match(RE_FOR_COUNTER);
    const forIn = counter ? null : code.match(RE_FOR_IN);
    if (counter || forIn) {
      const range = blockRange(lines, i, indent);
      const declared: { name: string; type: string | null }[] = counter
        ? [{ name: counter[1]!, type: 'int' }]
        : forIn![3]
          ? [{ name: forIn![3], type: null }]
          : [
              { name: forIn![1]!, type: 'int' },
              { name: forIn![2]!, type: null },
            ];
      for (const { name, type } of declared) {
        model.variables.push({
          kind: 'variable',
          name,
          declaredType: type,
          qualifier: null,
          initializer: null,
          line: i,
          column: columnOf(tl, name, raw),
          scope: range,
        });
      }
      continue;
    }

    const tuple = code.match(RE_TUPLE);
    if (tuple) {
      for (const name of tuple[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        model.variables.push({
          kind: 'variable',
          name,
          declaredType: null,
          qualifier: null,
          initializer: null,
          line: i,
          column: columnOf(tl, name, raw),
          scope: { start: i, end: lines.length - 1 },
        });
      }
      continue;
    }

    const v = code.match(RE_VARIABLE);
    if (v && !KEYWORDS.has(v[3]!)) {
      model.variables.push({
        kind: 'variable',
        name: v[3]!,
        declaredType: v[2] ?? null,
        qualifier: (v[1] as 'var' | 'varip' | undefined) ?? null,
        initializer: v[4]?.trim() || null,
        line: i,
        column: columnOf(tl, v[3]!, raw),
        scope: { start: i, end: lines.length - 1 },
      });
    }
  }

  // Narrow variable scopes to the enclosing function body, keeping a narrower loop scope as it is.
  for (const variable of model.variables) {
    const owner = model.functions.find((f) => variable.line > f.line && variable.line <= f.range.end);
    if (owner) variable.scope = { start: variable.line, end: Math.min(variable.scope.end, owner.range.end) };
  }
  return model;
}

/** The function, type or enum declared on a line, or null when the line declares none. */
export function declarationAt(model: DocumentModel, line: number): DeclSymbol | null {
  return (
    model.functions.find((f) => f.line === line) ??
    model.types.find((t) => t.line === line) ??
    model.enums.find((e) => e.line === line) ??
    null
  );
}

/** The variables whose scope covers a line. */
export function visibleVariables(model: DocumentModel, line: number): VariableSymbol[] {
  return model.variables.filter((v) => v.scope.start <= line && line <= v.scope.end);
}

/**
 * The column a declared name sits at. Searching the raw text would find the letter inside a keyword,
 * so `var a = 1` would report column 1 rather than 4.
 */
function columnOf(tl: TokenizedLine, name: string, raw: string): number {
  const token = tl.tokens.find((t) => t.kind === 'ident' && t.text === name);
  return token ? token.start : raw.indexOf(name);
}

function stripComment(raw: string, tl: TokenizedLine): string {
  const c = tl.tokens.find((t) => t.kind === 'comment');
  return c ? raw.slice(0, c.start) : raw;
}

// Lines belonging to the block that starts at `line`: every following line that is blank or indented deeper than `indent`.
function blockRange(lines: string[], line: number, indent: number): LineRange {
  let end = line;
  for (let j = line + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (!l.trim()) continue;
    const ind = l.length - l.trimStart().length;
    if (ind <= indent) break;
    end = j;
  }
  return { start: line, end };
}

// Joins a function header whose parameter list spans several lines. Returns null when no `)` closes it within 20 lines.
function joinHeader(
  lines: string[],
  tokenLines: TokenizedLine[],
  start: number,
): { text: string; endLine: number } | null {
  let text = '';
  for (let j = start; j < Math.min(lines.length, start + 20); j++) {
    text += (j === start ? '' : ' ') + stripComment(lines[j]!, tokenLines[j]!).trim();
    const next = tokenLines[j + 1];
    if (!next || next.depthAtStart === 0) return { text, endLine: j };
  }
  return null;
}

/** Splits the parameter list of a function header, dropping the qualifiers Pine allows. */
export function parseParams(paramText: string): ParamDecl[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (const ch of paramText) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    if (ch === ')' || ch === ']' || ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts
    .map((p) => p.trim().replace(/^(?:series|simple|const|input)\s+/, ''))
    .map((p) => p.match(RE_PARAM))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[2]!, type: m[1] ?? null, default: m[3]?.trim() ?? null }));
}

type DocKey = { kind: 'params' | 'fields'; name: string } | 'function' | 'description' | 'returns' | 'type' | 'enum';

/** Reads the `//@` block written directly above a line. */
export function annotationsAbove(lines: string[], line: number): Annotations {
  const docs = emptyAnnotations();
  const block: string[] = [];
  for (let j = line - 1; j >= 0; j--) {
    const t = lines[j]!.trim();
    if (!t.startsWith('//')) break;
    block.unshift(t);
  }
  let lastKey: DocKey | null = null;
  for (const text of block) {
    const m = text.match(/^\/\/\s*@(\w+)\s*(.*)$/);
    if (!m) {
      const plain = text.replace(/^\/\/\s?/, '');
      if (lastKey && plain) appendDoc(docs, lastKey, plain);
      continue;
    }
    docs.raw.push(text);
    const tag = m[1]!;
    const rest = m[2]!.trim();
    if (tag === 'param' || tag === 'field') {
      const pm = rest.match(/^(\w+)\s*(.*)$/);
      if (!pm) continue;
      const bucket = tag === 'param' ? docs.params : docs.fields;
      bucket[pm[1]!] = pm[2]!.trim();
      lastKey = { kind: tag === 'param' ? 'params' : 'fields', name: pm[1]! };
    } else if (tag === 'function' || tag === 'description' || tag === 'returns' || tag === 'type' || tag === 'enum') {
      docs[tag] = rest;
      lastKey = tag;
    } else if (tag === 'variable') {
      docs.description = rest;
      lastKey = 'description';
    }
  }
  return docs;
}

function appendDoc(docs: Annotations, key: DocKey, text: string): void {
  if (typeof key === 'string') {
    docs[key] = docs[key] ? `${docs[key]} ${text}` : text;
  } else {
    const bucket = docs[key.kind];
    bucket[key.name] = bucket[key.name] ? `${bucket[key.name]} ${text}` : text;
  }
}
