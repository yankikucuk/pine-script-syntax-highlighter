import type { EnumSymbol, FunctionSymbol, ParamDecl, TypeSymbol } from './document-model';
import type { RefEntry, ReferenceIndex } from './reference';

const fence = (code: string) => '```pine\n' + code + '\n```';

/** The one-line detail shown beside a completion item. */
export function entryDetail(entry: RefEntry): string {
  if (entry.kind === 'function') return entry.overloads[0]?.syntax ?? `${entry.name}()`;
  if (entry.type) return entry.type;
  return entry.kind;
}

/** The hover card for a built-in: signature, description, parameters, remarks and a reference link. */
export function entryMarkdown(entry: RefEntry, ref: ReferenceIndex, overloadIndex = 0): string {
  const parts: string[] = [];
  if (entry.kind === 'function') {
    const overload = entry.overloads[overloadIndex] ?? entry.overloads[0];
    const others = entry.overloads.length > 1 ? `\n\n_${entry.overloads.length} overloads_` : '';
    parts.push(fence(overload?.syntax ?? `${entry.name}()`) + others);
    if (entry.description) parts.push(entry.description);
    if (overload && overload.params.length) {
      parts.push(
        '**Parameters**\n\n' + overload.params.map((p) => `- \`${p.name}\` (${p.type}) ${p.description}`).join('\n'),
      );
    }
    if (overload?.returns?.description || overload?.returns?.type) {
      parts.push(`**Returns** ${overload.returns.description || overload.returns.type}`);
    }
  } else {
    const label =
      entry.kind === 'type'
        ? `(type) ${entry.name}`
        : `(${entry.kind}) ${entry.name}${entry.type ? `: ${entry.type}` : ''}`;
    parts.push(fence(label));
    if (entry.description) parts.push(entry.description);
    if (entry.fields.length)
      parts.push('**Fields**\n\n' + entry.fields.map((f) => `- \`${f.name}\` (${f.type}) ${f.description}`).join('\n'));
    if (entry.kind === 'keyword' || entry.kind === 'operator') {
      const syntax = entry.overloads[0]?.syntax;
      if (syntax) parts.push(fence(syntax));
    }
  }
  if (entry.remarks) parts.push(`**Remarks** ${entry.remarks}`);
  parts.push(`[Reference](${ref.url(entry)})`);
  return parts.join('\n\n');
}

function paramLabel(p: ParamDecl): string {
  return `${p.type ? `${p.type} ` : ''}${p.name}${p.default !== null ? ` = ${p.default}` : ''}`;
}

/** `name(type param = default, ...)` for a user function. */
export function functionSignatureLabel(fn: FunctionSymbol): string {
  return `${fn.name}(${fn.params.map(paramLabel).join(', ')})`;
}

/** The hover card for a user function, using whatever `//@` documentation it carries. */
export function functionMarkdown(fn: FunctionSymbol, origin?: string): string {
  const parts = [fence(`${fn.isExport ? 'export ' : ''}${fn.isMethod ? 'method ' : ''}${functionSignatureLabel(fn)}`)];
  if (origin) parts.push(`_${origin}_`);
  const summary = fn.docs.function ?? fn.docs.description;
  if (summary) parts.push(summary);
  const documented = fn.params.filter((p) => fn.docs.params[p.name]);
  if (documented.length)
    parts.push('**Parameters**\n\n' + documented.map((p) => `- \`${p.name}\` ${fn.docs.params[p.name]}`).join('\n'));
  if (fn.docs.returns) parts.push(`**Returns** ${fn.docs.returns}`);
  return parts.join('\n\n');
}

/** The hover card for a user type and its fields. */
export function typeMarkdown(t: TypeSymbol, origin?: string): string {
  const parts = [fence(`${t.isExport ? 'export ' : ''}type ${t.name}`)];
  if (origin) parts.push(`_${origin}_`);
  const summary = t.docs.type ?? t.docs.description;
  if (summary) parts.push(summary);
  if (t.fields.length) {
    parts.push(
      '**Fields**\n\n' +
        t.fields
          .map((f) => `- \`${f.name}\` (${f.type})${t.docs.fields[f.name] ? ` ${t.docs.fields[f.name]}` : ''}`)
          .join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** The hover card for a user enum and its members. */
export function enumMarkdown(e: EnumSymbol, origin?: string): string {
  const parts = [fence(`${e.isExport ? 'export ' : ''}enum ${e.name}`)];
  if (origin) parts.push(`_${origin}_`);
  const summary = e.docs.enum ?? e.docs.description;
  if (summary) parts.push(summary);
  if (e.members.length) {
    parts.push(
      '**Members**\n\n' +
        e.members
          .map(
            (m) =>
              `- \`${m.name}\`${m.title ? ` ${m.title}` : ''}${e.docs.fields[m.name] ? ` ${e.docs.fields[m.name]}` : ''}`,
          )
          .join('\n'),
    );
  }
  return parts.join('\n\n');
}
