import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLibrary } from '../../src/extension/core/libraries';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseLibrary', () => {
  it('keeps only exports and reads the description', () => {
    const lib = parseLibrary(fixture('library.pine'), 'yankikucuk/MaHelpers/2', 'local', {
      owner: 'yankikucuk',
      version: '2',
    })!;
    expect(lib.title).toBe('MaHelpers');
    expect(lib.description).toBe('Helpers for moving averages.');
    expect(lib.functions.map((f) => f.name)).toEqual(['weighted']);
    expect(lib.types.map((t) => t.name)).toEqual(['Level']);
    expect(lib.enums.map((e) => e.name)).toEqual(['Side']);
  });

  it('returns null for non-libraries', () => {
    expect(parseLibrary(fixture('consumer.pine'), 'x', 'local')).toBeNull();
  });
});
