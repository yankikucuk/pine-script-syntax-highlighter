import { argumentSpan, renamedTo, suggestNames, type QuickFix } from './quick-fix';
import type { ReferenceIndex } from './reference';
import {
  calleeOf,
  isImportPath,
  isMemberAccess,
  isNamedArgument,
  occurrencesOf,
  sourceIndex,
  type SymbolSource,
} from './symbols';
import { nearest } from './text';
import type { Token, TokenizedLine } from './tokenizer';

/** How loudly a rule speaks. `hint` renders faded rather than as a warning. */
export type LintSeverity = 'error' | 'warning' | 'information' | 'hint';

/** One finding, with the fix that resolves it when there is an unambiguous one. */
export interface LintIssue {
  rule: string;
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: LintSeverity;
  /** Renders the range faded, the way editors show dead code. */
  unnecessary: boolean;
  fix: QuickFix | null;
}

/** A document analysed once, shared by every rule. */
export interface LintSource extends SymbolSource {
  lines: string[];
}

/** The Pine version this extension documents and checks against. */
export const TARGET_VERSION = 6;

/** Calls the compiler rejects anywhere but the top level. */
const TOP_LEVEL_ONLY = new Set([
  'plot',
  'plotshape',
  'plotchar',
  'plotarrow',
  'plotcandle',
  'plotbar',
  'hline',
  'fill',
  'bgcolor',
  'barcolor',
  'alertcondition',
  'indicator',
  'strategy',
  'library',
]);

/** Names that are conventionally declared without being read. */
const IGNORED_PREFIX = '_';

/** Runs every rule over a document. Nothing here touches the network. */
export function lint(source: LintSource, ref: ReferenceIndex): LintIssue[] {
  const issues: LintIssue[] = [...versionIssues(source), ...tokenIssues(source, ref), ...unusedIssues(source)];
  return issues.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}

function versionIssues(source: LintSource): LintIssue[] {
  const { version } = source.model;
  if (version === null) {
    return [
      {
        rule: 'missing-version',
        line: 0,
        startCol: 0,
        endCol: source.lines[0]?.length ?? 0,
        message: `This script has no version pragma, so TradingView compiles it as an old version. Add //@version=${TARGET_VERSION}.`,
        severity: 'warning',
        unnecessary: false,
        fix: {
          title: `Add \`//@version=${TARGET_VERSION}\``,
          preferred: true,
          edits: [{ startLine: 0, startCol: 0, endLine: 0, endCol: 0, newText: `//@version=${TARGET_VERSION}\n` }],
        },
      },
    ];
  }
  if (version >= TARGET_VERSION) return [];
  const line = source.lines.findIndex((l) => /^\/\/@version\s*=/.test(l));
  const text = source.lines[line] ?? '';
  return [
    {
      rule: 'old-version',
      line: Math.max(0, line),
      startCol: 0,
      endCol: text.length,
      message: `This script targets v${version}. TradingView compiles v${TARGET_VERSION}, and this extension documents v${TARGET_VERSION}.`,
      severity: 'warning',
      unnecessary: false,
      fix: {
        title: `Change the pragma to v${TARGET_VERSION}`,
        preferred: true,
        edits: [
          {
            startLine: Math.max(0, line),
            startCol: 0,
            endLine: Math.max(0, line),
            endCol: text.length,
            newText: `//@version=${TARGET_VERSION}`,
          },
        ],
      },
    },
  ];
}

/** One pass over the tokens, covering the rules that read a call or a name in place. */
function tokenIssues(source: LintSource, ref: ReferenceIndex): LintIssue[] {
  const index = sourceIndex(source);
  const { flat } = index;
  const bound = boundNames(source);
  const issues: LintIssue[] = [];
  const seenArguments = new Map<number, Set<string>>();

  for (let i = 0; i < flat.length; i++) {
    const token = flat[i]!;
    if (token.kind !== 'ident') continue;

    if (isNamedArgument(flat, i)) {
      const callee = calleeOf(flat, i);
      const start = callStart(flat, i);
      if (start !== null) {
        const used = seenArguments.get(start) ?? new Set<string>();
        if (used.has(token.text)) issues.push(duplicateArgument(token));
        used.add(token.text);
        seenArguments.set(start, used);
      }
      if (callee) {
        const unknown = unknownArgument(source, token, callee, ref);
        if (unknown) issues.push(unknown);
      }
      continue;
    }
    if (isImportPath(index, i) || isMemberAccess(flat, i)) continue;

    if (TOP_LEVEL_ONLY.has(token.text) && flat[i + 1]?.kind === 'open') {
      const local = localScopeCall(source, token);
      if (local) issues.push(local);
      continue;
    }

    const legacy = legacyName(source, ref, token, bound);
    if (legacy) issues.push(legacy);
  }
  return issues;
}

function duplicateArgument(token: Token): LintIssue {
  return {
    rule: 'duplicate-argument',
    line: token.line,
    startCol: token.start,
    endCol: token.end,
    message: `The argument \`${token.text}\` is given twice in this call.`,
    severity: 'error',
    unnecessary: false,
    fix: null,
  };
}

/** Flags a named argument no overload of the built-in accepts, which is how v4 options were dropped. */
function unknownArgument(source: LintSource, token: Token, callee: string, ref: ReferenceIndex): LintIssue | null {
  const entry = ref.get(callee, 'function');
  if (!entry || !entry.overloads.length) return null;
  const parameters = [...new Set(entry.overloads.flatMap((o) => o.params.map((p) => p.name)))];
  if (!parameters.length || parameters.includes(token.text)) return null;
  const [closest] = nearest(token.text, parameters);
  return {
    rule: 'unknown-argument',
    line: token.line,
    startCol: token.start,
    endCol: token.end,
    message: closest
      ? `\`${callee}()\` has no argument called \`${token.text}\`. Did you mean \`${closest}\`?`
      : `\`${callee}()\` has no argument called \`${token.text}\`.`,
    severity: 'warning',
    unnecessary: false,
    fix: closest
      ? {
          title: `Rename the argument to \`${closest}\``,
          preferred: true,
          edits: [
            { startLine: token.line, startCol: token.start, endLine: token.line, endCol: token.end, newText: closest },
          ],
        }
      : removalFix(source, token),
  };
}

/** Offers to drop an argument that has no near miss, which is how options removed in v5 read. */
function removalFix(source: LintSource, token: Token): QuickFix | null {
  const span = argumentSpan(source.lines[token.line] ?? '', token.start);
  if (!span) return null;
  return {
    title: `Remove the \`${token.text}\` argument`,
    preferred: true,
    edits: [{ startLine: token.line, startCol: span.start, endLine: token.line, endCol: span.end, newText: '' }],
  };
}

function localScopeCall(source: LintSource, token: Token): LintIssue | null {
  if (source.tokens[token.line]!.depthAtStart > 0) return null;
  const text = source.lines[token.line] ?? '';
  if (!/^\s/.test(text)) return null;
  return {
    rule: 'local-scope-call',
    line: token.line,
    startCol: token.start,
    endCol: token.end,
    message: `\`${token.text}()\` only works at the top level of a script, not inside a local block.`,
    severity: 'error',
    unnecessary: false,
    fix: null,
  };
}

/** Flags a bare name that moved into a namespace in v5, which is the commonest v4 leftover. */
function legacyName(
  source: LintSource,
  ref: ReferenceIndex,
  token: Token,
  bound: ReadonlySet<string>,
): LintIssue | null {
  if (token.text.includes('.') || bound.has(token.text) || ref.get(token.text)) return null;
  // Only a certain replacement is worth reporting: a namespace move, or a documented rename.
  const renamed = renamedTo(token.text);
  const [suggested] = suggestNames(token.text, source.model, ref);
  const replacement = renamed ?? (suggested?.includes('.') ? suggested : undefined);
  if (!replacement) return null;
  return {
    rule: 'legacy-name',
    line: token.line,
    startCol: token.start,
    endCol: token.end,
    message: `\`${token.text}\` is not a v${TARGET_VERSION} name. It is \`${replacement}\` now.`,
    severity: 'warning',
    unnecessary: false,
    fix: {
      title: `Change to \`${replacement}\``,
      preferred: true,
      edits: [
        { startLine: token.line, startCol: token.start, endLine: token.line, endCol: token.end, newText: replacement },
      ],
    },
  };
}

/** Declarations that are never read: variables, parameters and imports. */
function unusedIssues(source: LintSource): LintIssue[] {
  const issues: LintIssue[] = [];
  const { model } = source;

  for (const variable of model.variables) {
    if (variable.name.startsWith(IGNORED_PREFIX)) continue;
    const at = position(source, variable.line, variable.name);
    if (!at) continue;
    const uses = occurrencesOf(source, {
      name: variable.name,
      kind: 'variable',
      declaration: { ...at, isDeclaration: true },
      scope: variable.scope,
      owner: null,
    });
    if (uses.length <= 1) issues.push(unused('unused-variable', at, `\`${variable.name}\` is never used.`));
  }

  for (const fn of model.functions) {
    for (const parameter of fn.params) {
      if (parameter.name.startsWith(IGNORED_PREFIX)) continue;
      const at = position(source, fn.line, parameter.name);
      if (!at) continue;
      const uses = occurrencesOf(source, {
        name: parameter.name,
        kind: 'parameter',
        declaration: { ...at, isDeclaration: true },
        scope: fn.range,
        owner: fn.name,
      });
      if (uses.length <= 1)
        issues.push(unused('unused-parameter', at, `\`${parameter.name}\` is never used in \`${fn.name}\`.`));
    }
  }

  for (const imported of model.imports) {
    if (!imported.alias) continue;
    const at = position(source, imported.line, imported.alias);
    if (!at) continue;
    const uses = occurrencesOf(source, {
      name: imported.alias,
      kind: 'import',
      declaration: { ...at, isDeclaration: true },
      scope: { start: 0, end: source.lines.length - 1 },
      owner: null,
    });
    if (uses.length <= 1) issues.push(unused('unused-import', at, `\`${imported.alias}\` is imported but never used.`));
  }
  return issues;
}

function unused(rule: string, at: { line: number; startCol: number; endCol: number }, message: string): LintIssue {
  return { rule, ...at, message, severity: 'hint', unnecessary: true, fix: null };
}

/** The range of a name on a line, taken from the tokens rather than a text search. */
function position(
  source: LintSource,
  line: number,
  name: string,
): { line: number; startCol: number; endCol: number } | null {
  const token = source.tokens[line]?.tokens.find((t) => t.kind === 'ident' && t.text === name);
  return token ? { line, startCol: token.start, endCol: token.end } : null;
}

/** Every name the document binds, including the loop variables the model does not record. */
function boundNames(source: LintSource): Set<string> {
  const { model } = source;
  const names = new Set<string>();
  for (const fn of model.functions) {
    names.add(fn.name);
    for (const parameter of fn.params) names.add(parameter.name);
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
  for (const name of forInVariables(source.tokens)) names.add(name);
  return names;
}

/** `for name in collection` binds a name the document model does not collect. */
function forInVariables(lines: TokenizedLine[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const significant = line.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
    if (significant[0]?.text !== 'for') continue;
    for (let i = 1; i < significant.length; i++) {
      if (significant[i]!.text !== 'in') continue;
      for (let j = 1; j < i; j++) if (significant[j]!.kind === 'ident') names.push(significant[j]!.text);
      break;
    }
  }
  return names;
}

/** The index of the `(` that opens the call a token sits in, used to group its arguments. */
function callStart(flat: Token[], index: number): number | null {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const token = flat[i]!;
    if (token.kind === 'close') depth++;
    else if (token.kind === 'open') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return null;
}
