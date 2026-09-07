import { enclosingCall, type CallInfo } from './call-resolver';
import { isInStringOrComment, type TokenizedLine } from './tokenizer';

export type CompletionContext =
  | { kind: 'none' }
  | { kind: 'annotation'; prefix: string }
  | { kind: 'import-path'; prefix: string }
  | { kind: 'member'; receiver: string; prefix: string }
  | { kind: 'named-arg'; call: CallInfo; prefix: string }
  | { kind: 'identifier'; prefix: string };

const RE_ANNOTATION = /\/\/\s*@(\w*)$/;
const RE_IMPORT = /^\s*import\s+([\w\-/.]*)$/;
const RE_MEMBER = /([A-Za-z_][\w.]*)\.(\w*)$/;
const RE_WORD = /(\w*)$/;

export function completionContext(
  tokenLines: TokenizedLine[],
  lineText: string,
  line: number,
  col: number,
): CompletionContext {
  const before = lineText.slice(0, col);
  const annotation = before.match(RE_ANNOTATION);
  if (annotation) return { kind: 'annotation', prefix: annotation[1]! };

  const tl = tokenLines[line];
  if (tl && isInStringOrComment(tl, col)) return { kind: 'none' };

  const imp = before.match(RE_IMPORT);
  if (imp) return { kind: 'import-path', prefix: imp[1]! };
  if (/^\s*import\s+\S+\s/.test(before)) return { kind: 'none' };

  const member = before.match(RE_MEMBER);
  if (member) return { kind: 'member', receiver: member[1]!, prefix: member[2]! };

  const prefix = before.match(RE_WORD)![1]!;
  const call = enclosingCall(tokenLines, line, col);
  if (call && !call.namedArg) {
    const sinceSeparator = before.slice(0, col - prefix.length).trimEnd();
    if (sinceSeparator.endsWith('(') || sinceSeparator.endsWith(',')) return { kind: 'named-arg', call, prefix };
  }
  return { kind: 'identifier', prefix };
}
