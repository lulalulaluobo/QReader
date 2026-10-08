import type { DataAdapter } from "obsidian";

export class ReaderFonts {
  private rules = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private urls = new Map<string, string>();
  private disposed = false;
  constructor(private adapter: DataAdapter, readonly directory: string) {}
  css(path?: string): string { return path ? this.rules.get(path) ?? "" : ""; }
  async load(path: string): Promise<void> {
    if (this.disposed) return;
    if (!path.startsWith(this.directory + "/") || path.slice(this.directory.length + 1).includes("/") || this.rules.has(path)) return;
    let pending = this.pending.get(path);
    if (!pending) {
      pending = (async () => {
        const bytes = new Uint8Array(await this.adapter.readBinary(path));
        if (this.disposed) return;
        if (bytes.length > 10 * 1024 * 1024) throw new Error("字体文件不能超过 10MB");
        const url = URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
        this.urls.set(path, url);
        this.rules.set(path, `@font-face{font-family:QReaderImported;src:url("${url}");font-display:swap;}`);
        if (this.rules.size > 3) {
          const oldest = this.rules.keys().next().value!;
          URL.revokeObjectURL(this.urls.get(oldest)!); this.urls.delete(oldest); this.rules.delete(oldest);
        }
      })();
      this.pending.set(path, pending);
      void pending.finally(() => this.pending.delete(path)).catch(() => {});
    }
    await pending;
  }
  async import(file: File): Promise<{ path: string; label: string }> {
    if (!/\.(?:ttf|otf|woff2?)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size) throw new Error("请选择不超过 10MB 的 TTF、OTF、WOFF 或 WOFF2 字体");
    const bytes = await file.arrayBuffer();
    const font = new FontFace("QReaderImportCheck", bytes);
    await font.load();
    if (this.disposed) throw new Error("字体导入已取消");
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const id = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
    const parts = this.directory.split("/");
    for (let i = 1; i <= parts.length; i++) { const path = parts.slice(0, i).join("/"); if (!await this.adapter.exists(path)) await this.adapter.mkdir(path); }
    const path = `${this.directory}/${id}.${file.name.split(".").pop()!.toLowerCase()}`;
    await this.adapter.writeBinary(path, bytes); await this.load(path);
    return { path, label: file.name };
  }
  dispose(): void {
    this.disposed = true;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear(); this.rules.clear();
  }
}
