import type { CompileDiagnostic } from './diagnostics';
import type { DocumentModel } from './document-model';
import { ReferenceIndex } from './reference';
import { nearest } from './text';
import { tokenize, wordAt, type Token } from './tokenizer';

export interface QuickFixEdit {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
}

export interface QuickFix {
  title: string;
  edits: QuickFixEdit[];
  /** Marks the single obvious fix so the editor can apply it without a menu. */
  preferred: boolean;
}

/** Compiler codes the quick fixes react to. */
const CODE = {
  unknownFunction: 'CE10271',
  undeclaredIdentifier: 'CE10272',
  naWithoutType: 'CE10097',
  unknownArgument: 'CE10120',
  typeMismatch: 'CE10173',
  shadowsBuiltIn: 'CW10011',
} as const;

/** Names that moved somewhere other than a namespace when Pine went from v4 to v5. */
const RENAMED = new Map([['study', 'indicator']]);

/** The v6 name of a built-in that was renamed outright, rather than moved into a namespace. */
export function renamedTo(name: string): string | undefined {
  return RENAMED.get(name);
}

/** Types that can be declared with a keyword, offered when a value is `na`. */
const DECLARABLE = ['float', 'int', 'bool', 'string', 'color'];

const MAX_SUGGESTIONS = 3;

/** Builds the fixes offered for one compiler diagnostic. */
export function quickFixes(
  issue: CompileDiagnostic,
  lines: string[],
  model: DocumentModel,
  ref: ReferenceIndex,
): QuickFix[] {
  switch (issue.code) {
    case CODE.unknownFunction:
    case CODE.undeclaredIdentifier:
      return renameToKnownSymbol(issue, lines, model, ref);
    case CODE.naWithoutType:
      return declareWithType(issue, lines);
    case CODE.unknownArgument:
      return fixArgumentName(issue, lines, ref);
    case CODE.typeMismatch:
      return fixDeclaredType(issue, lines);
    case CODE.shadowsBuiltIn:
      return renameShadow(issue, lines, model);
    default:
      return addVersionPragma(issue, lines);
  }
}

/** Replaces a name the compiler does not know with the closest one it does. */
function renameToKnownSymbol(
  issue: CompileDiagnostic,
  lines: string[],
  model: DocumentModel,
  ref: ReferenceIndex,
): QuickFix[] {
  const word = wordAt(lines[issue.line] ?? '', issue.startCol);
  const name = issue.ctx?.fullName ?? issue.ctx?.identifier ?? word?.text;
  if (!word || !name || word.text !== name) return [];

  const suggestions = suggestNames(name, model, ref);
  return suggestions.slice(0, MAX_SUGGESTIONS).map((suggestion, index) => ({
    title: `Change to \`${suggestion}\``,
    preferred: index === 0 && suggestions.length === 1,
    edits: [
      { startLine: issue.line, startCol: word.start, endLine: issue.line, endCol: word.end, newText: suggestion },
    ],
  }));
}

/** The names worth offering in place of one the compiler does not know, best first. */
export function suggestNames(name: string, model: DocumentModel, ref: ReferenceIndex): string[] {
  const suggestions: string[] = [];
  const add = (candidate: string) => {
    if (candidate !== name && !suggestions.includes(candidate)) suggestions.push(candidate);
  };
  const renamed = RENAMED.get(name);
  if (renamed) add(renamed);
  if (!name.includes('.')) {
    // Most v4 built-ins simply moved into a namespace: `sma` became `ta.sma`.
    for (const namespace of ref.childNamespaces('')) if (ref.get(`${namespace}.${name}`)) add(`${namespace}.${name}`);
  }
  for (const candidate of nearest(name, candidateNames(name, model, ref))) add(candidate);
  return suggestions;
}

function candidateNames(name: string, model: DocumentModel, ref: ReferenceIndex): string[] {
  const dot = name.lastIndexOf('.');
  if (dot > 0) return ref.members(name.slice(0, dot)).map((e) => e.name);
  return [
    ...ref.bare().map((e) => e.name),
    ...ref.childNamespaces(''),
    ...model.functions.map((f) => f.name),
    ...model.types.map((t) => t.name),
    ...model.enums.map((e) => e.name),
    ...model.variables.map((v) => v.name),
  ];
}

/** Adds the type keyword Pine needs when a variable is initialised with `na`. */
function declareWithType(issue: CompileDiagnostic, lines: string[]): QuickFix[] {
  const text = lines[issue.line] ?? '';
  const match = /^(\s*)((?:var|varip)\s+)?([A-Za-z_]\w*)\s*(?::?=)/.exec(text);
  if (!match) return [];
  const column = match[1]!.length + (match[2]?.length ?? 0);
  return DECLARABLE.map((type) => ({
    title: `Declare \`${match[3]}\` as ${type}`,
    preferred: false,
    edits: [{ startLine: issue.line, startCol: column, endLine: issue.line, endCol: column, newText: `${type} ` }],
  }));
}

/** Corrects, or removes, a named argument the function does not accept. */
function fixArgumentName(issue: CompileDiagnostic, lines: string[], ref: ReferenceIndex): QuickFix[] {
  const text = lines[issue.line] ?? '';
  const word = wordAt(text, issue.startCol);
  const name = issue.ctx?.name ?? word?.text;
  if (!word || !name || word.text !== name) return [];

  const entry = issue.ctx?.signature ? ref.get(issue.ctx.signature, 'function') : undefined;
  const parameters = [...new Set((entry?.overloads ?? []).flatMap((o) => o.params.map((p) => p.name)))];
  const fixes: QuickFix[] = nearest(name, parameters)
    .slice(0, MAX_SUGGESTIONS)
    .map((parameter) => ({
      title: `Rename the argument to \`${parameter}\``,
      preferred: false,
      edits: [
        { startLine: issue.line, startCol: word.start, endLine: issue.line, endCol: word.end, newText: parameter },
      ],
    }));

  const removal = argumentSpan(text, word.start);
  if (removal) {
    fixes.push({
      title: `Remove the \`${name}\` argument`,
      preferred: false,
      edits: [
        { startLine: issue.line, startCol: removal.start, endLine: issue.line, endCol: removal.end, newText: '' },
      ],
    });
  }
  if (fixes.length === 1) fixes[0]!.preferred = true;
  return fixes;
}

/**
 * Finds the text to delete to drop a named argument, including the comma that separates it.
 * Returns null when the argument does not fit on the line, where a blind cut would not be safe.
 */
// eslint-disable-next-line -- shared with the offline rules
export function argumentSpan(text: string, nameStart: number): { start: number; end: number } | null {
  const tokens = tokenize(text)[0]!.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
  const index = tokens.findIndex((t) => t.start === nameStart);
  if (index < 0 || tokens[index + 1]?.text !== '=') return null;

  let depth = 0;
  for (let i = index + 2; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === 'open') depth++;
    else if (token.kind === 'close') {
      if (depth === 0) {
        // The last argument in the call takes the comma in front of it with it.
        const previousComma = lastCommaBefore(tokens, index);
        return previousComma ? { start: previousComma.start, end: tokens[i - 1]!.end } : null;
      }
      depth--;
    } else if (token.kind === 'comma' && depth === 0) {
      let end = token.end;
      while (text[end] === ' ') end++;
      return { start: nameStart, end };
    }
  }
  return null;
}

function lastCommaBefore(tokens: Token[], index: number): Token | null {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind === 'comma') return token;
    if (token.kind === 'open') return null;
  }
  return null;
}

/** Widens a declared type keyword to the type of the value being assigned. */
function fixDeclaredType(issue: CompileDiagnostic, lines: string[]): QuickFix[] {
  const assigned = issue.ctx?.assignedValueType;
  const declared = issue.ctx?.ownValueType;
  const variable = issue.ctx?.variableName;
  if (!assigned || !declared || !variable) return [];
  const wanted = ReferenceIndex.baseType(assigned);
  const current = ReferenceIndex.baseType(declared);
  if (wanted === current) return [];

  const text = lines[issue.line] ?? '';
  const match = new RegExp(`\\b${current}\\b(?=[^=]*\\b${variable}\\b)`).exec(text);
  if (!match) return [];
  return [
    {
      title: `Change the declared type to \`${wanted}\``,
      preferred: true,
      edits: [
        {
          startLine: issue.line,
          startCol: match.index,
          endLine: issue.line,
          endCol: match.index + current.length,
          newText: wanted,
        },
      ],
    },
  ];
}

/** Renames every use of a variable that hides a built-in of the same name. */
function renameShadow(issue: CompileDiagnostic, lines: string[], model: DocumentModel): QuickFix[] {
  const name = issue.ctx?.variableName ?? wordAt(lines[issue.line] ?? '', issue.startCol)?.text;
  if (!name) return [];
  const taken = new Set(model.variables.map((v) => v.name));
  let replacement = `${name}Value`;
  for (let n = 1; taken.has(replacement); n++) replacement = `${name}Value${n}`;

  const edits: QuickFixEdit[] = [];
  tokenize(lines.join('\n')).forEach((line, number) => {
    for (const token of line.tokens) {
      if (token.kind === 'ident' && token.text === name) {
        edits.push({
          startLine: number,
          startCol: token.start,
          endLine: number,
          endCol: token.end,
          newText: replacement,
        });
      }
    }
  });
  if (!edits.length) return [];
  return [{ title: `Rename \`${name}\` to \`${replacement}\``, preferred: true, edits }];
}

/** Adds the version pragma when the compiler refuses the script for want of one. */
function addVersionPragma(issue: CompileDiagnostic, lines: string[]): QuickFix[] {
  if (issue.code !== null || !/supported versions/i.test(issue.message)) return [];
  if (lines.some((line) => /^\s*\/\/\s*@version\s*=/.test(line))) return [];
  return [
    {
      title: 'Add `//@version=6`',
      preferred: true,
      edits: [{ startLine: 0, startCol: 0, endLine: 0, endCol: 0, newText: '//@version=6\n' }],
    },
  ];
}
