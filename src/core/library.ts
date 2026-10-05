import { App, Notice, normalizePath } from "obsidian";
import { Book } from "epubjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AnnotationRecord, BookEntry, BookFormat, BookReadStatus, ChapterState, HealthyBookEntry, ReadingFile, TocNode } from "../types";
import { isHealthyBook, pdfChapterId } from "../types";
import { sanitizeFolderName } from "../util";
import { JsonStore, validateReading } from "./json-store";
import { VaultFs } from "./fs";
import { renderAnnotationsMd } from "./md-notes";
import { BookCache, buildEpubChapters, epubChapterText, pdfPagesText, tocNodesFromBook } from "./book-source";
import { openPdf } from "../reader/pdfjs-setup";
import { BOOK_EXTENSION, bookAsEpub, detectBookFormat } from "./book-formats";
import { translate } from "../i18n";
import type { AppLanguage } from "../i18n";

export const ANNOTATIONS_MD = "批注.md";
export const READING_JSON = "reading.json";
export interface LibraryDeps {
  app: App;
  libraryPath(): string;
  language(): AppLanguage;
  configDir: string;
  pluginId: string;
  notifyChanged(): void;
}

export class LibraryManager {
  private fs: VaultFs;
  private entriesById = new Map<string, BookEntry>();
  private activeRoot = "";
  private rootGeneration = 0;
  private scanned = false;
  private scanJob: Promise<BookEntry[]> | null = null;
  private importChain: Promise<void> = Promise.resolve();
  private coverMem = new Map<string, string>();

  constructor(private deps: LibraryDeps, public cache: BookCache) { this.fs = new VaultFs(deps.app.vault.adapter); }

  private root(): string {
    const raw = this.deps.libraryPath().trim();
    if (!raw || /^(?:[\\/]|[A-Za-z]:)/.test(raw) || raw.split(/[\\/]/).some((part) => part === ".." || part === ".")) throw new Error("书库必须是 Vault 内的相对路径，不能包含 . 或 ..");
    const root = normalizePath(raw);
    if (root !== this.activeRoot) {
      this.activeRoot = root; this.rootGeneration++;
      this.entriesById.clear(); this.coverMem.clear(); this.scanned = false; this.scanJob = null;
    }
    return root;
  }

  async ensureRoot(): Promise<string> {
    const root = this.root();
    await this.fs.mkdir(root);
    return root;
  }

  scan(force = false): Promise<BookEntry[]> {
    const root = this.root();
    const generation = this.rootGeneration;
    if (this.scanJob) return force ? this.scanJob.then(() => this.scan(true)) : this.scanJob;
    if (this.scanned && !force) return Promise.resolve(this.all());
    const job = (async () => {
      await this.fs.mkdir(root);
      const { folders } = await this.fs.list(root);
      const found = new Map<string, BookEntry>();
      for (const dir of folders) {
        const id = dir.slice(dir.lastIndexOf("/") + 1);
        const path = `${dir}/${READING_JSON}`;
        if (!(await this.fs.exists(path))) {
          const contents = await this.fs.list(dir);
          if (contents.files.some((file) => BOOK_EXTENSION.test(file))) {
            const missing = await JsonStore.open(this.fs, path, validateReading);
            found.set(id, { id, dir, reading: null, store: missing.store, damaged: true });
          }
          continue;
        }
        const existing = this.entriesById.get(id);
        if (existing && isHealthyBook(existing) && !existing.store.damaged && (!force || existing.store instanceof JsonStore && await existing.store.matchesDisk())) { found.set(id, existing); continue; }
        const loaded = await JsonStore.open(this.fs, path, validateReading);
        if (loaded.damaged) found.set(id, { id, dir, reading: loaded.value, store: loaded.store, damaged: true });
        else if (loaded.value) found.set(id, { id, dir, reading: loaded.value, store: loaded.store });
      }
      this.root();
      if (this.rootGeneration !== generation) return this.scan();
      // Imports that completed while the listing was in flight must not disappear.
      for (const [id, entry] of this.entriesById) {
        const loaded = found.get(id);
        if (!loaded && !folders.includes(entry.dir) && await this.fs.exists(`${entry.dir}/${READING_JSON}`)) found.set(id, entry);
        else if (loaded && isHealthyBook(loaded) && isHealthyBook(entry) && entry.store instanceof JsonStore && await entry.store.matchesDisk()) found.set(id, entry);
      }
      for (const [id, entry] of found) if (!(await this.fs.exists(entry.dir))) found.delete(id);
      this.root();
      if (this.rootGeneration !== generation) return this.scan();
      this.entriesById = found; this.scanned = true;
      return this.all();
    })();
    this.scanJob = job;
    void job.finally(() => { if (this.scanJob === job) this.scanJob = null; }).catch(() => {});
    return job;
  }

  get(id: string): BookEntry | undefined {
    this.root();
    return this.entriesById.get(id);
  }
  all(): BookEntry[] {
    this.root();
    return [...this.entriesById.values()];
  }
  sortedByRecent(): BookEntry[] {
    return this.all().sort((a, b) => (Date.parse(b.reading?.progress.lastReadAt || "") || 0) - (Date.parse(a.reading?.progress.lastReadAt || "") || 0));
  }

  private healthy(entry: BookEntry): HealthyBookEntry {
    if (!isHealthyBook(entry)) throw new Error("书籍数据已损坏，请显式恢复或重建");
    if (entry.dir !== `${this.root()}/${entry.id}`) throw new Error("书库路径已改变，请从新书库重新打开书籍");
    if (this.entriesById.get(entry.id) !== entry) throw new Error("书籍数据已重新加载，请重新打开书籍");
    return entry;
  }

  importBook(fileName: string, bytes: ArrayBuffer): Promise<{ entry: HealthyBookEntry; created: boolean }> {
    const job = this.importChain.then(() => this.doImport(fileName, bytes), () => this.doImport(fileName, bytes));
    this.importChain = job.then(() => {}, () => {});
    return job;
  }

  private async doImport(fileName: string, bytes: ArrayBuffer): Promise<{ entry: HealthyBookEntry; created: boolean }> {
    await this.scan();
    const root = await this.ensureRoot();
    const generation = this.rootGeneration;
    const format = await detectBookFormat(fileName, bytes);
    const baseName = fileName.split(/[\\/]/).pop() ?? "";
    const safeName = `${sanitizeFolderName(baseName.replace(BOOK_EXTENSION, "")) || "原书"}.${format}`;
    new Notice(translate(this.deps.language(), "正在导入《{0}》……", baseName));
    const { reading, cover } = await readBook(bytes, safeName, format);
    this.root();
    if (generation !== this.rootGeneration) throw new Error("导入期间书库路径发生变化，请重试");
    const base = sanitizeFolderName(reading.book.title) || "未命名书籍";
    let id = base;
    for (let n = 2; await this.fs.exists(`${root}/${id}`); n++) id = `${base} (${n})`;
    const dir = `${root}/${id}`;
    await this.fs.mkdir(dir);
    await this.deps.app.vault.adapter.writeBinary(`${dir}/${safeName}`, bytes);
    const store = JsonStore.forNew(this.fs, `${dir}/${READING_JSON}`, validateReading, reading);
    await store.mutate(() => {}, (value) => this.fs.write(`${dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    const entry: HealthyBookEntry = { id, dir, reading, store };
    if (cover) await this.saveCover(entry, cover);
    this.root();
    if (generation !== this.rootGeneration) throw new Error("导入已保存在原书库，但书库路径已改变，请从原书库打开");
    this.entriesById.set(id, entry);
    this.deps.notifyChanged();
    new Notice(translate(this.deps.language(), "已导入《{0}》", reading.book.title));
    return { entry, created: true };
  }

  async restoreBroken(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error("书籍不存在");
    await entry.store.restoreRecovery();
    this.entriesById.delete(id);
    await this.scan(true);
    const restored = this.get(id);
    if (restored && isHealthyBook(restored)) await this.syncAnnotationsMd(restored);
    this.deps.notifyChanged();
  }

  async resetBroken(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error("书籍不存在");
    const { files } = await this.fs.list(entry.dir);
    const originals = files.filter((path) => BOOK_EXTENSION.test(path));
    if (originals.length !== 1) throw new Error("无法唯一确定原书文件，请保留一份 EPUB、PDF、FB2、MOBI、AZW3 或 CBZ 后重试");
    const path = originals[0];
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const bytes = await this.deps.app.vault.adapter.readBinary(path);
    const { reading, cover } = await readBook(bytes, fileName, await detectBookFormat(fileName, bytes));
    const mdPath = `${entry.dir}/${ANNOTATIONS_MD}`;
    if (await this.fs.exists(mdPath)) {
      let backup = `${mdPath}.before-reset`;
      for (let n = 1; await this.fs.exists(backup); n++) backup = `${mdPath}.before-reset.${n}`;
      await this.fs.write(backup, await this.fs.read(mdPath));
    }
    await entry.store.reset(reading);
    await this.cache.invalidate(entry.dir);
    this.entriesById.delete(id);
    await this.scan(true);
    const rebuilt = this.get(id);
    if (rebuilt && isHealthyBook(rebuilt)) {
      await this.syncAnnotationsMd(rebuilt);
      if (cover) await this.saveCover(rebuilt, cover);
    }
    this.deps.notifyChanged();
  }

  async deleteBook(entry: BookEntry): Promise<void> {
    if (entry.dir !== `${this.root()}/${entry.id}`) throw new Error("书库路径已改变");
    await this.cache.invalidate(entry.dir);
    await this.deps.app.vault.adapter.rmdir(entry.dir, true);
    this.entriesById.delete(entry.id);
    this.coverMem.delete(entry.dir);
    const cover = await this.coverPath(entry);
    if (await this.fs.exists(cover)) await this.fs.remove(cover);
    this.deps.notifyChanged();
  }

  private async coverPath(entry: BookEntry): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.dir));
    let key = "";
    for (const byte of new Uint8Array(digest)) key += byte.toString(16).padStart(2, "0");
    return normalizePath(`${this.deps.configDir}/plugins/${this.deps.pluginId}/cover-cache/${key}.txt`);
  }
  private async saveCover(entry: BookEntry, data: string, cachedPath?: string): Promise<void> {
    const path = cachedPath ?? await this.coverPath(entry);
    await this.fs.mkdir(path.slice(0, path.lastIndexOf("/")));
    await this.fs.write(path, data);
    this.coverMem.set(entry.dir, data);
  }
  async getCover(entry: BookEntry): Promise<string | null> {
    const cached = this.coverMem.get(entry.dir);
    if (cached) return cached;
    const path = await this.coverPath(entry);
    if (await this.fs.exists(path)) {
      const data = await this.fs.read(path);
      if (!data.startsWith("data:image/")) throw new Error("封面缓存已损坏");
      this.coverMem.set(entry.dir, data); return data;
    }
    if (!isHealthyBook(entry)) return null;
    const cover = entry.reading.book.format !== "pdf"
      ? await this.cache.withEpub(entry, epubCover)
      : await this.cache.withPdf(entry, renderPdfCover);
    if (cover) await this.saveCover(entry, cover, path);
    return cover;
  }

  async getChapterText(entry: BookEntry, chapterId: string): Promise<string> {
    const healthy = this.healthy(entry);
    const chapter = healthy.reading.chapters[chapterId];
    if (!chapter) throw new Error("章节不存在");
    if (healthy.reading.book.format === "cbz") throw new Error("CBZ 为图片书，不提供正文提取、问题生成或文字批注");
    const text = healthy.reading.book.format !== "pdf"
      ? await this.cache.withEpub(healthy, (book) => epubChapterText(book, chapter.spineIndex ?? 0, chapter.href, chapter.hrefEnd))
      : await this.cache.withPdf(healthy, (doc) => {
        if (!chapter.pdfStartPage || !chapter.pdfEndPage) throw new Error("PDF 章节页码范围缺失");
        return pdfPagesText(doc, chapter.pdfStartPage, chapter.pdfEndPage);
      });
    if (!text.trim()) throw new Error("本章无法提取正文；图片章节及扫描版 PDF 需要文字层，QReader 不提供 OCR");
    return text;
  }
  async getToc(entry: BookEntry): Promise<TocNode[]> {
    const healthy = this.healthy(entry);
    if (healthy.reading.book.format !== "pdf") return this.cache.withEpub(healthy, async (book) => tocNodesFromBook(book, healthy.reading.chapters));
    const chapters = Object.entries(healthy.reading.chapters).sort((a, b) => a[1].index - b[1].index);
    return this.cache.withPdf(healthy, async (doc) => {
      const outline = await doc.getOutline();
      if (!outline?.length) return chapters.map(([id, chapter]) => ({ title: chapter.title, page: chapter.pdfStartPage, chapterId: id }));
      const build = async (items: OutlineItem[]): Promise<TocNode[]> => {
        const nodes: TocNode[] = [];
        for (const item of items) {
          const page = await outlineDestPage(doc, item.dest);
          const chapter = page === null ? undefined : chapters.find(([, state]) => state.pdfStartPage !== undefined && state.pdfEndPage !== undefined && page >= state.pdfStartPage && page <= state.pdfEndPage);
          nodes.push({ title: item.title.trim() || "（无标题）", page: page ?? undefined, chapterId: chapter?.[0], children: item.items.length ? await build(item.items) : undefined });
        }
        return nodes;
      };
      const nodes = await build(outline);
      nodes.push(...chapters.filter(([, chapter]) => chapter.custom).map(([id, chapter]) => ({ title: chapter.title, page: chapter.pdfStartPage, chapterId: id })));
      return nodes;
    });
  }

  async saveProgress(entry: BookEntry, progress: Partial<ReadingFile["progress"]> & { chapterId: string | null }): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate((value) => { Object.assign(value.progress, progress, { lastReadAt: new Date().toISOString() }); });
  }

  async updateBookOrganization(entry: BookEntry, patch: { readStatus?: BookReadStatus; category?: string | null }): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate((value) => {
      if (patch.readStatus !== undefined) value.book.readStatus = patch.readStatus;
      if (patch.category !== undefined) {
        const category = patch.category?.trim();
        if (category) value.book.category = category;
        else delete value.book.category;
      }
    });
    this.deps.notifyChanged();
  }

  async saveAnnotation(entry: BookEntry, draft: Omit<AnnotationRecord, "createdAt" | "updatedAt">): Promise<AnnotationRecord> {
    const healthy = this.healthy(entry);
    if (healthy.reading.book.format === "cbz") throw new Error("CBZ 为图片书，不支持文字批注");
    const record: AnnotationRecord = { ...draft, createdAt: new Date().toISOString() };
    await healthy.store.mutate((value) => { value.annotations.push(record); }, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    this.deps.notifyChanged();
    return record;
  }
  async updateAnnotation(entry: BookEntry, id: string, patch: Partial<Pick<AnnotationRecord, "kind" | "color" | "note" | "aiExplanation">>): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate((value) => {
      const record = value.annotations.find((annotation) => annotation.id === id);
      if (!record) throw new Error("批注不存在");
      Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    }, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    this.deps.notifyChanged();
  }
  async clearAnnotation(entry: BookEntry, id: string): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate((value) => {
      const record = value.annotations.find((annotation) => annotation.id === id);
      if (!record) throw new Error("批注不存在");
      delete record.note;
      delete record.aiExplanation;
      record.kind = "highlight";
      record.updatedAt = new Date().toISOString();
    }, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    this.deps.notifyChanged();
  }
  async deleteAnnotation(entry: BookEntry, id: string): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate((value) => { value.annotations = value.annotations.filter((annotation) => annotation.id !== id); }, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    this.deps.notifyChanged();
  }
  async syncAnnotationsMd(entry: BookEntry): Promise<void> {
    const healthy = this.healthy(entry);
    await healthy.store.mutate(() => {}, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
  }

  async createPdfChapter(entry: BookEntry, title: string, startPage: number, endPage: number): Promise<string> {
    const healthy = this.healthy(entry);
    const pages = healthy.reading.book.numPages;
    if (healthy.reading.book.format !== "pdf" || !pages || !Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage || endPage > pages || !title.trim()) throw new Error("PDF 章节名称或页码范围无效");
    const id = pdfChapterId(startPage);
    await healthy.store.mutate((value) => {
      const existing = value.chapters[id];
      if (existing) Object.assign(existing, { title: title.trim(), pdfStartPage: startPage, pdfEndPage: endPage, custom: true });
      else value.chapters[id] = { title: title.trim(), index: 0, pdfStartPage: startPage, pdfEndPage: endPage, custom: true, questionVersions: [], answers: [], reviews: [] };
      const ordered = Object.values(value.chapters).sort((a, b) => (a.pdfStartPage ?? 0) - (b.pdfStartPage ?? 0));
      ordered.forEach((chapter, index) => {
        chapter.index = index;
        const next = ordered[index + 1]?.pdfStartPage;
        if (next && (chapter.pdfEndPage ?? 0) >= next) chapter.pdfEndPage = next - 1;
      });
    }, (value) => this.fs.write(`${entry.dir}/${ANNOTATIONS_MD}`, renderAnnotationsMd(value)));
    this.deps.notifyChanged(); return id;
  }
}


async function readBook(bytes: ArrayBuffer, fileName: string, format: BookFormat): Promise<{ reading: ReadingFile; cover: string | null }> {
  let title = fileName.replace(BOOK_EXTENSION, "");
  let author = "";
  let chapters: Record<string, ChapterState>;
  let spineLength: number | undefined;
  let numPages: number | undefined;
  let cover: string | null;
  if (format !== "pdf") {
    const book = new Book();
    try {
      await book.open(await bookAsEpub(bytes, fileName, format), "binary"); await book.ready; await book.loaded.navigation;
      const meta = await book.loaded.metadata;
      title = meta.title.trim() || title; author = meta.creator.trim();
      spineLength = (await book.loaded.spine).length;
      chapters = await buildEpubChapters(book);
      if (format === "cbz") for (const chapter of Object.values(chapters)) chapter.reviewExcluded = true;
      cover = await epubCover(book);
    } finally { book.destroy(); }
  } else {
    // PDF.js transfers its input to the worker; import still needs the original bytes.
    const doc = await openPdf(bytes.slice(0));
    try {
      numPages = doc.numPages;
      const meta = await doc.getMetadata();
      const info: unknown = meta.info;
      if (typeof info === "object" && info !== null) {
        if ("Title" in info && typeof info.Title === "string") title = info.Title.trim() || title;
        if ("Author" in info && typeof info.Author === "string") author = info.Author.trim();
      }
      chapters = await pdfChaptersFromOutline(doc);
      cover = await renderPdfCover(doc);
    } finally { await doc.loadingTask.destroy(); }
  }
  const first = Object.entries(chapters).sort((a, b) => a[1].index - b[1].index)[0];
  return {
    reading: { version: 1, book: { title, author, format, fileName, spineLength, numPages }, progress: { chapterId: first?.[0] ?? null, percent: 0, cfi: null, pdfPage: 1, pdfPageFraction: 0, lastReadAt: "" }, chapters, annotations: [], importedAt: new Date().toISOString() }, cover,
  };
}

interface OutlineItem { title: string; dest: unknown; items: OutlineItem[] }
export async function pdfChaptersFromOutline(doc: PDFDocumentProxy): Promise<Record<string, ChapterState>> {
  const outline = await doc.getOutline();
  const resolved: { title: string; page: number }[] = [];
  const walk = async (items: OutlineItem[]): Promise<void> => {
    for (const item of items) {
      const page = await outlineDestPage(doc, item.dest);
      if (page !== null && page >= 1 && page <= doc.numPages) resolved.push({ title: item.title.trim() || `第 ${page} 页`, page });
      await walk(item.items);
    }
  };
  if (outline) await walk(outline.length === 1 && outline[0].items.length ? outline[0].items : outline);
  resolved.sort((a, b) => a.page - b.page);
  const unique = resolved.filter((item, index) => resolved.findIndex((other) => other.page === item.page) === index);
  const chapters: Record<string, ChapterState> = {};
  unique.forEach((item, index) => {
    chapters[pdfChapterId(item.page)] = { title: item.title, index, pdfStartPage: item.page, pdfEndPage: (unique[index + 1]?.page ?? doc.numPages + 1) - 1, questionVersions: [], answers: [], reviews: [] };
  });
  return chapters;
}
async function outlineDestPage(doc: PDFDocumentProxy, original: unknown): Promise<number | null> {
  const destination: unknown = typeof original === "string" ? await doc.getDestination(original) : original;
  if (!Array.isArray(destination) || !destination.length) return null;
  const reference: unknown = destination[0];
  if (typeof reference === "number" && Number.isInteger(reference)) return reference + 1;
  if (typeof reference === "object" && reference !== null && "num" in reference && "gen" in reference && typeof reference.num === "number" && typeof reference.gen === "number") return await doc.getPageIndex({ num: reference.num, gen: reference.gen }) + 1;
  return null;
}
async function epubCover(book: Book): Promise<string | null> {
  const url = await book.coverUrl();
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  if (!url.startsWith("blob:")) throw new Error("EPUB 封面不是内嵌资源");
  const response = await fetch(url);
  if (!response.ok) throw new Error("EPUB 封面读取失败");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("EPUB 封面编码失败"));
    reader.onerror = () => reject(new Error("EPUB 封面读取失败"));
    reader.readAsDataURL(blob);
  });
}
async function renderPdfCover(doc: PDFDocumentProxy): Promise<string | null> {
  const page = await doc.getPage(1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(400 / base.width, 600 / base.height, 2) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 PDF 封面画布");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally { page.cleanup(); }
}
