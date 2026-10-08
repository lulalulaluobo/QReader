import type { DataAdapter } from "obsidian";

/** Only disposable derivatives live here. No original books or user notes. */
export class ReaderDiskCache {
  private writes: Promise<void> = Promise.resolve();
  private epoch = 0;
  constructor(private adapter: DataAdapter, readonly directory: string, private maxBytes = 128 * 1024 * 1024) {}
  async contentKey(bytes: ArrayBuffer, version: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return version + "-" + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  private path(key: string): string {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error("缓存标识无效");
    return `${this.directory}/${key}`;
  }
  async read(key: string): Promise<ArrayBuffer | null> {
    try {
      const path = this.path(key);
      if (!await this.adapter.exists(path)) return null;
      return await this.adapter.readBinary(path);
    } catch { return null; }
  }
  async write(key: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<void> {
    if (bytes.byteLength > this.maxBytes || signal?.aborted) return;
    const epoch = this.epoch;
    const job = this.writes.then(async () => {
      if (epoch !== this.epoch || signal?.aborted) return;
      const parts = this.directory.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join("/");
        if (!await this.adapter.exists(path)) await this.adapter.mkdir(path);
      }
      if (signal?.aborted || epoch !== this.epoch) return;
      await this.adapter.writeBinary(this.path(key), bytes);
      await this.trim();
    });
    this.writes = job.catch(() => {});
    try { await job; } catch { /* Cache failure must never prevent reading. */ }
  }
  async stats(): Promise<{ bytes: number; count: number }> {
    try {
      const { files } = await this.adapter.list(this.directory);
      const sizes = await Promise.all(files.map(async path => (await this.adapter.stat(path))?.size ?? 0));
      return { bytes: sizes.reduce((a, b) => a + b, 0), count: files.length };
    } catch { return { bytes: 0, count: 0 }; }
  }
  private async trim(): Promise<void> {
    const { files } = await this.adapter.list(this.directory);
    const entries = await Promise.all(files.map(async path => ({ path, stat: await this.adapter.stat(path) })));
    entries.sort((a, b) => (a.stat?.mtime ?? 0) - (b.stat?.mtime ?? 0));
    let bytes = entries.reduce((sum, item) => sum + (item.stat?.size ?? 0), 0);
    for (const item of entries) {
      if (bytes <= this.maxBytes) break;
      await this.adapter.remove(item.path); bytes -= item.stat?.size ?? 0;
    }
  }
  async clear(): Promise<void> {
    ++this.epoch;
    const job = this.writes.then(async () => {
      if (await this.adapter.exists(this.directory)) await this.adapter.rmdir(this.directory, true);
    });
    this.writes = job.catch(() => {});
    await job;
  }
}
