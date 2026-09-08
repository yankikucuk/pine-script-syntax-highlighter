import { buildModel, type EnumSymbol, type FunctionSymbol, type ImportDecl, type TypeSymbol } from './document-model';

/** A Pine library and the symbols it exports, from the workspace or from TradingView. */
export interface LibraryInfo {
  id: string;
  title: string;
  owner: string | null;
  version: string | null;
  description: string | null;
  functions: FunctionSymbol[];
  types: TypeSymbol[];
  enums: EnumSymbol[];
  source: 'local' | 'remote';
}

/** How the providers reach libraries, so tests can supply their own. */
export interface LibraryLookup {
  forImport(imp: ImportDecl): Promise<LibraryInfo | null>;
  local(): LibraryInfo[];
  search(prefix: string): Promise<LibraryInfo[]>;
}

/** A lookup that finds nothing, for tests and for when library support is switched off. */
export const noLibraries: LibraryLookup = {
  forImport: async () => null,
  local: () => [],
  search: async () => [],
};

/** Reads a library script into its exported symbols, or null when the script is not a library. */
export function parseLibrary(
  text: string,
  id: string,
  source: 'local' | 'remote',
  meta: { owner?: string; version?: string; description?: string } = {},
): LibraryInfo | null {
  const model = buildModel(text);
  if (model.scriptKind !== 'library') return null;
  const descriptionLine = text.split(/\r?\n/).find((l) => /^\/\/\s*@description\b/.test(l));
  return {
    id,
    title: model.libraryTitle ?? id,
    owner: meta.owner ?? null,
    version: meta.version ?? null,
    description:
      meta.description || (descriptionLine ? descriptionLine.replace(/^\/\/\s*@description\s*/, '').trim() : null),
    functions: model.functions.filter((f) => f.isExport),
    types: model.types.filter((t) => t.isExport),
    enums: model.enums.filter((e) => e.isExport),
    source,
  };
}
