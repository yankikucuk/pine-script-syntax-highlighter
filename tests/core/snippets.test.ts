import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type Snippet = { prefix: string | string[]; description: string; body: string | string[] };

const file = new URL('../../snippets/pinescript.code-snippets', import.meta.url);
const snippets = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Snippet>;
const entries = Object.entries(snippets);
const bodyOf = (s: Snippet): string => (Array.isArray(s.body) ? s.body.join('\n') : s.body);

/** Walks the snippet syntax and throws on an unbalanced or malformed placeholder. */
function checkPlaceholders(text: string): void {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '$' && text[i + 1] === '{') {
      const m = /^\$\{(\d+|[A-Z_]+)([:|}])/.exec(text.slice(i));
      if (!m) throw new Error(`malformed placeholder at ${i}: ${text.slice(i, i + 20)}`);
      if (m[2] === '|') {
        const end = text.indexOf('|}', i);
        if (end < 0) throw new Error(`unterminated choice at ${i}`);
        i = end + 1;
        continue;
      }
      if (m[2] === '}') {
        i += m[0].length - 1;
        continue;
      }
      depth++;
      i += m[0].length - 1;
      continue;
    }
    if (c === '}' && depth > 0) depth--;
  }
  if (depth !== 0) throw new Error(`unbalanced placeholder braces (${depth})`);
}

describe('snippets', () => {
  it('ships a large snippet set', () => {
    expect(entries.length).toBeGreaterThanOrEqual(90);
  });

  it('has unique prefixes', () => {
    const prefixes = entries.flatMap(([, s]) => (Array.isArray(s.prefix) ? s.prefix : [s.prefix]));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it.each(entries)('%s is well formed', (_name, snippet) => {
    const body = bodyOf(snippet);
    expect(snippet.description.length).toBeGreaterThan(0);
    expect(() => checkPlaceholders(body)).not.toThrow();
    expect(body).not.toContain('\t');
    expect(body).not.toMatch(/@version=[0-5]\b/);
    for (const line of body.split('\n')) expect(line).not.toMatch(/\s+$/);
  });
});
