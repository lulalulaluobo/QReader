import type { FsLike } from "./fs";
import { JsonStore } from "./json-store";
import type { ThinkingFile, ThoughtThread, ThoughtItem, TraceRef, TraceSource } from "./thought-data";
import { renderThoughtMarkdown, traceKey, validateThinking } from "./thought-data";
import { genId, sanitizeFolderName } from "../util";

export class ThinkingManager {
  private stores = new Map<string, Promise<JsonStore<ThinkingFile>>>();
  constructor(private fs: FsLike, private root: () => Promise<string>, private resolve: (ref: TraceRef) => TraceSource | undefined, private notify: () => void) {}
  private async store(force = false, fixedRoot?: string): Promise<JsonStore<ThinkingFile>> {
    const root = fixedRoot ?? await this.root();
    const path = `${root}/.qreader/thinking.json`;
    if (force) this.stores.delete(path);
    let job = this.stores.get(path);
    if (!job) {
      job = (async () => {
        const loaded = await JsonStore.open(this.fs, path, validateThinking);
        return loaded.value || loaded.damaged ? loaded.store : JsonStore.forNew(this.fs, path, validateThinking, { version: 1, threads: [] });
      })();
      this.stores.set(path, job);
      void job.catch(() => { if (this.stores.get(path) === job) this.stores.delete(path); });
    }
    return job;
  }
  async load(force = false): Promise<ThinkingFile> {
    const store = await this.store(force);
    if (store.damaged || !store.value) throw new Error("思考线数据已损坏，原文件保留，请修复或显式恢复备份");
    return store.value;
  }
  async restoreBackup(): Promise<void> {
    const store = await this.store(true);
    await store.restoreRecovery(); this.notify();
  }
  async saveThread(id: string | undefined, title: string, judgment: string, unresolved: string, items: ThoughtItem[] = []): Promise<string> {
    const root = await this.root();
    const store = await this.store(false, root);
    const now = new Date().toISOString();
    const nextId = id ?? genId("thought");
    await this.fs.mkdir(`${root}/.qreader`);
    if (root !== await this.root()) throw new Error("阅读库已切换，请重新打开");
    await store.mutate(value => {
      const existing = id ? value.threads.find(thread => thread.id === id) : undefined;
      if (id && !existing) throw new Error("思考线已不存在，请重新打开");
      if (existing) Object.assign(existing, { title: title.trim(), judgment, unresolved, updatedAt: now });
      else {
        for (const item of items) if (!this.resolve(item.ref)) throw new Error("原笔记或版本已变化，请重新选择");
        value.threads.push({ id: nextId, title: title.trim(), judgment, unresolved, items, createdAt: now, updatedAt: now });
      }
    });
    this.notify(); return nextId;
  }
  async addItems(id: string, items: ThoughtItem[]): Promise<void> {
    const store = await this.store();
    await store.mutate(value => {
      const thread = value.threads.find(thread => thread.id === id);
      if (!thread) throw new Error("思考线已不存在，请重新打开");
      for (const item of items) {
        if (!this.resolve(item.ref)) throw new Error("原笔记或版本已变化，请重新选择");
        if (!thread.items.some(saved => traceKey(saved.ref) === traceKey(item.ref))) thread.items.push(item);
      }
      thread.updatedAt = new Date().toISOString();
    });
    this.notify();
  }
  async removeItem(id: string, ref: TraceRef): Promise<void> {
    const store = await this.store();
    await store.mutate(value => {
      const thread = value.threads.find(thread => thread.id === id);
      if (!thread) throw new Error("思考线已不存在，请重新打开");
      thread.items = thread.items.filter(item => traceKey(item.ref) !== traceKey(ref));
      thread.updatedAt = new Date().toISOString();
    });
    this.notify();
  }
  async deleteThread(id: string): Promise<void> {
    const store = await this.store();
    await store.mutate(value => { value.threads = value.threads.filter(thread => thread.id !== id); });
    this.notify();
  }
  async exportMarkdown(thread: ThoughtThread, sources: TraceSource[], language: "zh-CN" | "en" = "zh-CN", vault?: string): Promise<string> {
    const root = await this.root();
    const dir = `${root}/思考线导出`;
    await this.fs.mkdir(dir);
    const path = `${dir}/${sanitizeFolderName(thread.title).slice(0, 60)}-${genId("snapshot")}.md`;
    if (await this.fs.exists(path)) throw new Error("导出文件已存在，请重试");
    const text = renderThoughtMarkdown(thread, sources, language, vault);
    await this.fs.write(path, text);
    if (await this.fs.read(path) !== text) throw new Error("思考线导出校验失败，请重试");
    return path;
  }
}
