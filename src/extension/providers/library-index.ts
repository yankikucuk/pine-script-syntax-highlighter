import * as vscode from 'vscode';
import type { ImportDecl } from '../core/document-model';
import { parseLibrary, type LibraryInfo, type LibraryLookup } from '../core/libraries';
import type { PineFacade } from '../core/pine-facade';
import type { Settings } from '../vscode/settings';

/** Finds libraries: the ones in the workspace, and the published ones when that is enabled. */
export class LibraryIndex implements LibraryLookup {
  private readonly localByUri = new Map<string, LibraryInfo>();
  private readonly remote = new Map<string, Promise<LibraryInfo | null>>();
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly facade: PineFacade,
    private readonly settings: () => Settings,
  ) {}

  start(context: vscode.ExtensionContext): void {
    void this.scan();
    this.watch(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pinescript.libraries.local.include')) {
          this.localByUri.clear();
          void this.scan();
          this.watch(context);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d.languageId === 'pinescript') this.index(d.uri, d.getText());
      }),
    );
  }

  local(): LibraryInfo[] {
    return [...this.localByUri.values()];
  }

  async search(prefix: string): Promise<LibraryInfo[]> {
    if (!this.settings().librariesRemote || prefix.length < 2) return [];
    const list = await this.facade.libList(prefix);
    return list.map((l) => ({
      id: l.libId,
      title: l.lib,
      owner: l.user,
      version: l.libId.split('/')[2] ?? l.version,
      description: l.docs || null,
      functions: [],
      types: [],
      enums: [],
      source: 'remote' as const,
    }));
  }

  forImport(imp: ImportDecl): Promise<LibraryInfo | null> {
    const id = `${imp.owner}/${imp.name}/${imp.version}`;
    const local = this.local().find((l) => l.title === imp.name || l.id === id);
    if (local) return Promise.resolve(local);
    if (!this.settings().librariesRemote) return Promise.resolve(null);
    if (!this.remote.has(id)) this.remote.set(id, this.fetchRemote(imp, id));
    return this.remote.get(id)!;
  }

  private async fetchRemote(imp: ImportDecl, id: string): Promise<LibraryInfo | null> {
    const list = await this.facade.libList(`${imp.owner}/${imp.name}/`);
    const match = list.find((l) => l.libId === id) ?? list.find((l) => l.user === imp.owner && l.lib === imp.name);
    if (!match) {
      this.remote.delete(id);
      return null;
    }
    const source = await this.facade.getScript(match.scriptIdPart, match.version);
    if (!source) {
      this.remote.delete(id);
      return null;
    }
    const lib = parseLibrary(source, id, 'remote', { owner: imp.owner, version: imp.version, description: match.docs });
    if (!lib) this.remote.delete(id);
    return lib;
  }

  private async scan(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    const files = await vscode.workspace.findFiles(this.settings().librariesInclude, '**/node_modules/**', 500);
    for (const uri of files) {
      if (uri.scheme !== 'file') continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        this.index(uri, Buffer.from(bytes).toString('utf8'));
      } catch {
        // unreadable file: skip
      }
    }
  }

  private index(uri: vscode.Uri, text: string): void {
    if (!/\blibrary\s*\(/.test(text)) {
      this.localByUri.delete(uri.toString());
      return;
    }
    const lib = parseLibrary(text, vscode.workspace.asRelativePath(uri), 'local');
    if (lib) this.localByUri.set(uri.toString(), lib);
    else this.localByUri.delete(uri.toString());
  }

  private watch(context: vscode.ExtensionContext): void {
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(this.settings().librariesInclude);
    this.watcher.onDidDelete((uri) => this.localByUri.delete(uri.toString()));
    this.watcher.onDidCreate(async (uri) => {
      try {
        this.index(uri, Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
      } catch {
        // unreadable file: skip
      }
    });
    context.subscriptions.push(this.watcher);
  }
}
