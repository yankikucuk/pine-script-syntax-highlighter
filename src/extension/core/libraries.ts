import type { EnumSymbol, FunctionSymbol, ImportDecl, TypeSymbol } from './document-model';

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
