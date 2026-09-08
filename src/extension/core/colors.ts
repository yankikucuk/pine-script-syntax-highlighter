import type { ReferenceIndex } from './reference';
import type { Token, TokenizedLine } from './tokenizer';

/** A colour with each channel from 0 to 1, matching the editor's colour type. */
export interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** One colour found in the document, and the range the picker should replace. */
export interface ColorSpot {
  line: number;
  startCol: number;
  endCol: number;
  color: Rgba;
}

const RE_HEX = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;
const RE_CONSTANT_VALUE = /#([0-9a-fA-F]{6})/;

let namedColors: Map<string, Rgba> | undefined;

/** The built-in colour constants, read from the reference so they stay in step with it. */
function constants(ref: ReferenceIndex): Map<string, Rgba> {
  if (namedColors) return namedColors;
  namedColors = new Map();
  for (const entry of ref.members('color')) {
    if (entry.kind !== 'constant') continue;
    const match = RE_CONSTANT_VALUE.exec(entry.description);
    if (match) namedColors.set(entry.name, fromHex(match[1]!, null));
  }
  return namedColors;
}

/** Finds every colour the editor can show a swatch for. */
export function findColors(tokens: TokenizedLine[], ref: ReferenceIndex): ColorSpot[] {
  const named = constants(ref);
  const spots: ColorSpot[] = [];
  for (let line = 0; line < tokens.length; line++) {
    const significant = tokens[line]!.tokens.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
    for (let i = 0; i < significant.length; i++) {
      const token = significant[i]!;
      if (token.kind === 'number' && token.text.startsWith('#')) {
        const color = parseHex(token.text);
        if (color) spots.push({ line, startCol: token.start, endCol: token.end, color });
        continue;
      }
      if (token.kind !== 'ident') continue;
      if (significant[i + 1]?.kind === 'open' && (token.text === 'color.new' || token.text === 'color.rgb')) {
        const call = readCall(significant, i, named);
        if (call) {
          spots.push({ line, startCol: token.start, endCol: call.end, color: call.color });
          i = call.lastToken;
          continue;
        }
      }
      const constant = named.get(token.text);
      if (constant) spots.push({ line, startCol: token.start, endCol: token.end, color: constant });
    }
  }
  return spots;
}

/** The ways the picked colour can be written back, most idiomatic first. */
export function colorPresentations(color: Rgba): string[] {
  const transparency = Math.round((1 - color.alpha) * 100);
  const channels = [color.red, color.green, color.blue].map(to255);
  const rgb = transparency === 0 ? channels.join(', ') : `${channels.join(', ')}, ${transparency}`;
  return [toHex(color), `color.rgb(${rgb})`];
}

interface ParsedCall {
  color: Rgba;
  end: number;
  lastToken: number;
}

/** Reads `color.new(base, transparency)` or `color.rgb(r, g, b, transparency)` on a single line. */
function readCall(tokens: Token[], index: number, named: Map<string, Rgba>): ParsedCall | null {
  const args = readArguments(tokens, index + 1);
  if (!args) return null;
  const name = tokens[index]!.text;
  const color = name === 'color.new' ? fromNew(args.values, named) : fromRgb(args.values.map((v) => v && numberOf(v)));
  if (!color) return null;
  return { color, end: args.end, lastToken: args.lastToken };
}

function fromNew(values: (Token | null)[], named: Map<string, Rgba>): Rgba | null {
  const base = values[0];
  if (!base) return null;
  const color = base.kind === 'ident' ? (named.get(base.text) ?? null) : parseHex(base.text);
  if (!color) return null;
  const transparency = values.length > 1 ? numberOf(values[1] ?? null) : 0;
  if (transparency === null) return null;
  return { ...color, alpha: clamp01(1 - transparency / 100) };
}

function fromRgb(values: (number | null)[]): Rgba | null {
  if (values.length < 3 || values.slice(0, 3).some((v) => v === null)) return null;
  const transparency = values.length > 3 ? values[3] : 0;
  if (transparency === null || transparency === undefined) return null;
  return {
    red: clamp01(values[0]! / 255),
    green: clamp01(values[1]! / 255),
    blue: clamp01(values[2]! / 255),
    alpha: clamp01(1 - transparency / 100),
  };
}

interface Arguments {
  /** One token per argument, or null when the argument is not a plain literal. */
  values: (Token | null)[];
  end: number;
  lastToken: number;
}

/**
 * Splits the arguments of a call whose `(` is at `open`. Named arguments are accepted, and any
 * argument that is more than a single literal is reported as null so the caller can give up.
 */
function readArguments(tokens: Token[], open: number): Arguments | null {
  const values: (Token | null)[] = [];
  let current: Token[] = [];
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === 'open') {
      depth++;
      if (depth === 1) continue;
    } else if (token.kind === 'close') {
      depth--;
      if (depth === 0) {
        values.push(single(current));
        return { values, end: token.end, lastToken: i };
      }
    } else if (token.kind === 'comma' && depth === 1) {
      values.push(single(current));
      current = [];
      continue;
    }
    current.push(token);
  }
  return null;
}

/** Reduces one argument to its literal, dropping a `name =` prefix and rejecting anything else. */
function single(tokens: Token[]): Token | null {
  const parts = tokens[1]?.text === '=' ? tokens.slice(2) : tokens;
  if (parts.length !== 1) return null;
  const token = parts[0]!;
  return token.kind === 'number' || token.kind === 'ident' ? token : null;
}

function numberOf(token: Token | null): number | null {
  if (!token || token.kind !== 'number' || token.text.startsWith('#')) return null;
  const value = Number(token.text);
  return Number.isFinite(value) ? value : null;
}

function parseHex(text: string): Rgba | null {
  const match = RE_HEX.exec(text);
  return match ? fromHex(match[1]!, match[2] ?? null) : null;
}

function fromHex(rgb: string, alpha: string | null): Rgba {
  return {
    red: parseInt(rgb.slice(0, 2), 16) / 255,
    green: parseInt(rgb.slice(2, 4), 16) / 255,
    blue: parseInt(rgb.slice(4, 6), 16) / 255,
    alpha: alpha === null ? 1 : parseInt(alpha, 16) / 255,
  };
}

function toHex(color: Rgba): string {
  const pair = (value: number) => to255(value).toString(16).padStart(2, '0').toUpperCase();
  const base = `#${pair(color.red)}${pair(color.green)}${pair(color.blue)}`;
  return color.alpha >= 1 ? base : `${base}${pair(color.alpha)}`;
}

function to255(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
