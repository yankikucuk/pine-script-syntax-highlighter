import { buildModel, type EnumSymbol, type FunctionSymbol, type ImportDecl, type TypeSymbol } from './document-model';

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

export interface LibraryLookup {
  forImport(imp: ImportDecl): Promise<LibraryInfo | null>;
  local(): LibraryInfo[];
  search(prefix: string): Promise<LibraryInfo[]>;
}

export const noLibraries: LibraryLookup = {
  forImport: async () => null,
  local: () => [],
  search: async () => [],
};

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
