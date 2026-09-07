import type { DeclSymbol, FunctionSymbol, LineRange } from './document-model';

const VOID_CALLS =
  /^(?:plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor|fill|hline|alert|alertcondition|log\.\w+|runtime\.error|strategy\.(?:entry|exit|close|close_all|order|cancel|cancel_all|risk\.\w+)|label\.set_\w+|line\.set_\w+|box\.set_\w+|table\.(?:cell|set_\w+|clear|merge_cells)|array\.(?:push|set|unshift|clear|insert|fill|sort|reverse)|matrix\.(?:set|fill|add_row|add_col|remove_row|remove_col)|map\.(?:put|remove|clear))\s*\(/;

export function annotationBlockRange(lines: string[], declLine: number): LineRange | null {
  let start = declLine;
  while (start > 0 && /^\s*\/\//.test(lines[start - 1]!)) start--;
  if (start === declLine) return null;
  // Only count the block if it contains at least one annotation; plain comments are left alone.
  const block = lines.slice(start, declLine);
  if (!block.some((l) => /^\s*\/\/\s*@\w+/.test(l))) return null;
  return { start, end: declLine - 1 };
}

function tagOf(line: string): { tag: string; name: string | null } | null {
  const m = line.match(/^\s*\/\/\s*@(\w+)\s*(\w+)?/);
  if (!m) return null;
  const named = m[1] === 'param' || m[1] === 'field';
  return { tag: m[1]!, name: named ? (m[2] ?? null) : null };
}

function bodyReturnsValue(fn: FunctionSymbol): boolean {
  return !fn.lastLine || !VOID_CALLS.test(fn.lastLine);
}

export function docstringLines(symbol: DeclSymbol, existing: string[], indent: string): string[] {
  const wanted: { tag: string; name: string | null }[] = [];
  if (symbol.kind === 'function') {
    wanted.push({ tag: 'function', name: null });
    for (const p of symbol.params) wanted.push({ tag: 'param', name: p.name });
    if (bodyReturnsValue(symbol)) wanted.push({ tag: 'returns', name: null });
  } else if (symbol.kind === 'type') {
    wanted.push({ tag: 'type', name: null });
    for (const f of symbol.fields) wanted.push({ tag: 'field', name: f.name });
  } else {
    wanted.push({ tag: 'enum', name: null });
    for (const m of symbol.members) wanted.push({ tag: 'field', name: m.name });
  }

  const remaining = existing.map((l) => ({ line: l, key: tagOf(l) }));
  const out: string[] = [];
  for (const w of wanted) {
    const idx = remaining.findIndex((r) => r.key && r.key.tag === w.tag && r.key.name === w.name);
    if (idx >= 0) {
      out.push(indent + remaining[idx]!.line.trim());
      remaining.splice(idx, 1);
    } else if (w.tag === 'returns') {
      out.push(`${indent}//@returns `);
    } else {
      const label = w.name ?? symbol.name;
      out.push(`${indent}//@${w.tag} ${label} `);
    }
  }
  // Keep anything else the author wrote (descriptions, unknown tags, continuation lines) after the generated block.
  for (const r of remaining) out.push(indent + r.line.trim());
  return out;
}

export function needsDocstring(symbol: DeclSymbol): boolean {
  if (symbol.kind === 'function') {
    if (!symbol.docs.function && !symbol.docs.description) return true;
    if (symbol.params.some((p) => !symbol.docs.params[p.name])) return true;
    return bodyReturnsValue(symbol) && !symbol.docs.returns;
  }
  if (symbol.kind === 'type') return !symbol.docs.type || symbol.fields.some((f) => !symbol.docs.fields[f.name]);
  return !symbol.docs.enum || symbol.members.some((m) => !symbol.docs.fields[m.name]);
}
