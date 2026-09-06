/**
 * Pine Script v6 TextMate grammar, expressed as data.
 *
 * `scripts/build-grammar.mjs` turns this module into
 * `syntaxes/pinescript.tmLanguage.json`. Never edit the JSON by hand.
 *
 * Built-in identifiers live in `src/data/*.json`, grouped by namespace.
 * They are extracted from the official language reference:
 * https://www.tradingview.com/pine-script-reference/v6/
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const data = (name) => JSON.parse(readFileSync(join(here, 'data', `${name}.json`), 'utf8'));

const functions = data('functions');
const variables = data('variables');
const constants = data('constants');
const annotations = data('annotations');

// ---------------------------------------------------------------------------
// Language-level vocabulary
// ---------------------------------------------------------------------------

const KEYWORDS = {
  control: ['if', 'else', 'switch', 'for', 'while', 'once', 'continue', 'break'],
  loop: ['to', 'by', 'in'],
  logical: ['and', 'or', 'not'],
  storage: ['var', 'varip', 'export', 'method'],
  declaration: ['type', 'enum'],
  import: ['import', 'as'],
  qualifier: ['series', 'simple', 'const', 'input'],
};

const TYPES = [
  'int',
  'float',
  'bool',
  'string',
  'color',
  'line',
  'label',
  'box',
  'table',
  'linefill',
  'polyline',
  'array',
  'matrix',
  'map',
  'chart.point',
  'footprint',
  'volume_row',
];

const LANGUAGE_CONSTANTS = ['true', 'false', 'na'];

// Types double as cast functions (`int(x)`) and object constructors, so they
// must not also be listed as plain built-in functions or variables.
const TYPE_SET = new Set(TYPES);
for (const list of [functions, variables]) {
  list[''] = list[''].filter((n) => !TYPE_SET.has(n) && !LANGUAGE_CONSTANTS.includes(n));
}

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (list) =>
  [...new Set(list)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(esc)
    .join('|');
const words = (list) => `\\b(${alt(list)})\\b`;

/** `(?<![\w.])` keeps `foo.close` from matching the bare built-in `close`. */
const NOT_MEMBER = '(?<![\\w.])';
const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * Build one rule per namespace: `ns.member`.
 * @param {Record<string, string[]>} groups
 * @param {string} scope  scope for the member part
 * @param {string} tail   lookahead appended after the member (e.g. call parens)
 */
function namespaced(groups, scope, tail = '') {
  return Object.entries(groups)
    .filter(([ns, members]) => ns !== '' && members.length > 0)
    .sort(([a], [b]) => b.length - a.length || a.localeCompare(b))
    .map(([ns, members]) => ({
      match: `${NOT_MEMBER}(${esc(ns)})(\\.)(${alt(members)})\\b${tail}`,
      captures: {
        1: { name: 'support.class.pine' },
        2: { name: 'punctuation.accessor.pine' },
        3: { name: scope },
      },
    }));
}

const bare = (groups, scope, tail = '') => ({
  match: `${NOT_MEMBER}(${alt(groups[''])})\\b${tail}`,
  name: scope,
});

const CALL = '(?=\\s*(?:<[^<>]*>\\s*)?\\()';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const repository = {
  // -- comments & compiler annotations ---------------------------------------
  comments: {
    patterns: [
      {
        name: 'comment.line.double-slash.pine',
        begin: '//',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.pine' } },
        end: '$',
        patterns: [
          {
            match: '(@version)\\s*(=)\\s*(\\d+)',
            captures: {
              1: { name: 'storage.type.annotation.version.pine' },
              2: { name: 'keyword.operator.assignment.pine' },
              3: { name: 'constant.numeric.integer.pine' },
            },
          },
          {
            match: `(${alt(annotations.filter((a) => a !== '@version'))})\\b`,
            name: 'storage.type.annotation.pine',
          },
          {
            match: '`[^`]*`',
            name: 'markup.inline.raw.pine',
          },
        ],
      },
    ],
  },

  // -- strings -----------------------------------------------------------------
  strings: {
    patterns: [
      tripleString('"', 'double'),
      tripleString("'", 'single'),
      quotedString('"', 'double'),
      quotedString("'", 'single'),
    ],
  },

  'string-content': {
    patterns: [
      { match: '\\\\.', name: 'constant.character.escape.pine' },
      {
        // str.format placeholders: {0}, {1,number,#.##}, {2,date,short}
        match: '\\{\\d+(?:\\s*,\\s*[^{}]*)?\\}',
        name: 'constant.other.placeholder.pine',
      },
    ],
  },

  // -- numbers & colors --------------------------------------------------------
  numbers: {
    patterns: [
      {
        match: '(?<![\\w.])(#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?)\\b',
        name: 'constant.other.color.hex.pine',
      },
      {
        match: '(?<![\\w.])(?:\\d+\\.\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?\\b|(?<![\\w.])\\d+[eE][+-]?\\d+\\b',
        name: 'constant.numeric.float.pine',
      },
      {
        match: '(?<![\\w.])\\d+\\b(?!\\.\\d)',
        name: 'constant.numeric.integer.pine',
      },
    ],
  },

  // -- declarations ------------------------------------------------------------
  declarations: {
    patterns: [
      {
        // type Point / export type Point
        match: `^\\s*(?:(export)\\s+)?(type)\\s+(${IDENT})`,
        captures: {
          1: { name: 'storage.modifier.export.pine' },
          2: { name: 'storage.type.declaration.pine' },
          3: { name: 'entity.name.type.pine' },
        },
      },
      {
        // enum Signal / export enum Signal
        match: `^\\s*(?:(export)\\s+)?(enum)\\s+(${IDENT})`,
        captures: {
          1: { name: 'storage.modifier.export.pine' },
          2: { name: 'storage.type.declaration.enum.pine' },
          3: { name: 'entity.name.type.enum.pine' },
        },
      },
      {
        // import user/library/1 as alias
        match: `^\\s*(import)\\s+([\\w-]+/${IDENT}/\\d+)(?:\\s+(as)\\s+(${IDENT}))?`,
        captures: {
          1: { name: 'keyword.control.import.pine' },
          2: { name: 'entity.name.namespace.import.pine' },
          3: { name: 'keyword.control.import.as.pine' },
          4: { name: 'entity.name.namespace.alias.pine' },
        },
      },
      {
        // f(x) => ...   |  export method name(this) => ...
        // Single-line signature. Multi-line signatures fall back to the generic
        // function-call rule, which still highlights the name.
        match: `^\\s*(?:(export)\\s+)?(?:(method)\\s+)?(${IDENT})\\s*(?=\\((?:[^()]|\\([^()]*\\))*\\)\\s*=>)`,
        captures: {
          1: { name: 'storage.modifier.export.pine' },
          2: { name: 'storage.modifier.method.pine' },
          3: { name: 'entity.name.function.pine' },
        },
      },
      {
        // for i = 0 to 10 by 2  |  for [i, v] in arr
        begin: '^\\s*(for)\\b',
        beginCaptures: { 1: { name: 'keyword.control.loop.pine' } },
        end: '$',
        patterns: [{ match: words(KEYWORDS.loop), name: 'keyword.control.loop.pine' }, { include: '$self' }],
      },
    ],
  },

  // -- keywords ----------------------------------------------------------------
  keywords: {
    patterns: [
      { match: words(KEYWORDS.control), name: 'keyword.control.pine' },
      { match: words(KEYWORDS.logical), name: 'keyword.operator.logical.pine' },
      { match: words(KEYWORDS.storage), name: 'storage.modifier.pine' },
      { match: words(KEYWORDS.declaration), name: 'storage.type.declaration.pine' },
      { match: words(KEYWORDS.import), name: 'keyword.control.import.pine' },
      { match: `${words(KEYWORDS.qualifier)}(?!\\.)`, name: 'storage.modifier.qualifier.pine' },
    ],
  },

  // -- types -------------------------------------------------------------------
  types: {
    patterns: [
      {
        // array<float>, map<string, Point>, matrix<int>, array.new<float>()
        begin: '(?<=\\barray|\\bmatrix|\\bmap|\\bnew)(<)',
        beginCaptures: { 1: { name: 'punctuation.definition.generic.begin.pine' } },
        end: '(>)',
        endCaptures: { 1: { name: 'punctuation.definition.generic.end.pine' } },
        name: 'meta.generic.pine',
        patterns: [
          { include: '#types' },
          { match: ',', name: 'punctuation.separator.comma.pine' },
          { match: `\\b(${IDENT})\\b`, name: 'entity.name.type.pine' },
        ],
      },
      {
        match: `${NOT_MEMBER}(${alt(TYPES)})\\b(?!\\.(?!new\\b))`,
        name: 'support.type.pine',
      },
      {
        // UDT constructor:  Point.new(...)
        match: `${NOT_MEMBER}(${IDENT})(\\.)(new)${CALL}`,
        captures: {
          1: { name: 'entity.name.type.pine' },
          2: { name: 'punctuation.accessor.pine' },
          3: { name: 'support.function.constructor.pine' },
        },
      },
    ],
  },

  // -- built-ins ---------------------------------------------------------------
  'language-constants': {
    patterns: [{ match: `${NOT_MEMBER}(${alt(LANGUAGE_CONSTANTS)})\\b`, name: 'constant.language.pine' }],
  },

  'builtin-constants': {
    patterns: namespaced(constants, 'support.constant.pine'),
  },

  'builtin-functions': {
    patterns: [...namespaced(functions, 'support.function.pine', CALL), bare(functions, 'support.function.pine', CALL)],
  },

  'builtin-variables': {
    patterns: [...namespaced(variables, 'support.variable.pine'), bare(variables, 'support.variable.pine')],
  },

  // -- user code ---------------------------------------------------------------
  'member-access': {
    patterns: [
      {
        // obj.method(...)  |  lib.fn(...)
        match: `(\\.)(${IDENT})${CALL}`,
        captures: {
          1: { name: 'punctuation.accessor.pine' },
          2: { name: 'entity.name.function.member.pine' },
        },
      },
      {
        // obj.field
        match: `(\\.)(${IDENT})\\b`,
        captures: {
          1: { name: 'punctuation.accessor.pine' },
          2: { name: 'variable.other.member.pine' },
        },
      },
    ],
  },

  'function-call': {
    patterns: [
      {
        match: `${NOT_MEMBER}(${IDENT})${CALL}`,
        captures: { 1: { name: 'entity.name.function.call.pine' } },
      },
    ],
  },

  variables: {
    patterns: [
      {
        // x = ..., x := ..., x += ...
        match: `${NOT_MEMBER}(${IDENT})(?=\\s*(?::=|[-+*/%]?=)(?![=>]))`,
        captures: { 1: { name: 'variable.other.assignment.pine' } },
      },
      {
        // [a, b] = f()
        begin: '(?<![\\w\\]\\)])(\\[)(?=[^\\]]*\\]\\s*=(?![=>]))',
        beginCaptures: { 1: { name: 'punctuation.definition.tuple.begin.pine' } },
        end: '(\\])',
        endCaptures: { 1: { name: 'punctuation.definition.tuple.end.pine' } },
        name: 'meta.tuple.destructuring.pine',
        patterns: [
          { match: `\\b(${IDENT})\\b`, name: 'variable.other.assignment.pine' },
          { match: ',', name: 'punctuation.separator.comma.pine' },
        ],
      },
      { match: `${NOT_MEMBER}${IDENT}\\b`, name: 'variable.other.pine' },
    ],
  },

  parens: {
    patterns: [
      {
        begin: '\\(',
        beginCaptures: { 0: { name: 'punctuation.section.parens.begin.pine' } },
        end: '\\)',
        endCaptures: { 0: { name: 'punctuation.section.parens.end.pine' } },
        name: 'meta.parens.pine',
        patterns: [
          {
            // named argument / parameter:  length = 14
            match: `${NOT_MEMBER}(${IDENT})(?=\\s*=(?![=>]))`,
            captures: { 1: { name: 'variable.parameter.pine' } },
          },
          { include: '$self' },
        ],
      },
    ],
  },

  // -- operators & punctuation -------------------------------------------------
  operators: {
    patterns: [
      { match: '=>', name: 'keyword.operator.arrow.pine' },
      { match: ':=|[-+*/%]=|=(?![=>])', name: 'keyword.operator.assignment.pine' },
      { match: '==|!=|<=|>=|<|>', name: 'keyword.operator.comparison.pine' },
      { match: '[-+*/%]', name: 'keyword.operator.arithmetic.pine' },
      { match: '\\?|:', name: 'keyword.operator.ternary.pine' },
    ],
  },

  punctuation: {
    patterns: [
      { match: ',', name: 'punctuation.separator.comma.pine' },
      { match: '\\[', name: 'punctuation.section.brackets.begin.pine' },
      { match: '\\]', name: 'punctuation.section.brackets.end.pine' },
    ],
  },
};

function tripleString(quote, kind) {
  const q = esc(quote).repeat(3);
  return {
    name: `string.quoted.triple.${kind}.pine`,
    begin: q,
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.pine' } },
    end: q,
    endCaptures: { 0: { name: 'punctuation.definition.string.end.pine' } },
    patterns: [{ include: '#string-content' }],
  };
}

function quotedString(quote, kind) {
  const q = esc(quote);
  return {
    name: `string.quoted.${kind}.pine`,
    begin: q,
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.pine' } },
    end: `${q}|$`,
    endCaptures: { 0: { name: 'punctuation.definition.string.end.pine' } },
    patterns: [{ include: '#string-content' }],
  };
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

export const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'Pine Script',
  scopeName: 'source.pine',
  fileTypes: ['pine', 'pinescript'],
  firstLineMatch: '^//@version=\\d+',
  patterns: [
    { include: '#comments' },
    { include: '#strings' },
    { include: '#numbers' },
    { include: '#declarations' },
    { include: '#keywords' },
    { include: '#language-constants' },
    { include: '#builtin-constants' },
    { include: '#builtin-functions' },
    { include: '#builtin-variables' },
    { include: '#types' },
    { include: '#member-access' },
    { include: '#function-call' },
    { include: '#variables' },
    { include: '#parens' },
    { include: '#operators' },
    { include: '#punctuation' },
  ],
  repository,
};
