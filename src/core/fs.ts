// Filesystem abstraction over the Obsidian vault adapter.
// Kept as an interface so the JSON store can be smoke-tested outside Obsidian.

export interface FsLike {
  readonly queueScope?: object;
  stat?(path: string): Promise<{ mtime: number } | null>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

import type { DataAdapter } from "obsidian";

export class VaultFs implements FsLike {
  readonly queueScope: object;
  constructor(private adapter: DataAdapter) { this.queueScope = adapter; }

  stat(path: string): Promise<{ mtime: number } | null> { return this.adapter.stat(path); }

  read(path: string): Promise<string> {
    return this.adapter.read(path);
  }
  write(path: string, data: string): Promise<void> {
    return this.adapter.write(path, data);
  }
  exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }
  remove(path: string): Promise<void> {
    return this.adapter.remove(path);
  }
  async mkdir(path: string): Promise<void> {
    if (!path || /^(?:[\\/]|[A-Za-z]:)/.test(path) || path.split(/[\\/]/).some((part) => part === ".." || part === ".")) throw new Error("目录必须是安全的 Vault 相对路径");
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (await this.adapter.exists(current)) continue;
      try { await this.adapter.mkdir(current); }
      catch (error) {
        if (!(await this.adapter.exists(current))) throw error;
      }
    }
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const res = await this.adapter.list(path);
    return { files: res.files, folders: res.folders };
  }
}
