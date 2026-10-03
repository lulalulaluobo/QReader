import { Book } from "epubjs";
import type { NavItem } from "epubjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BookEntry, ChapterState, HealthyBookEntry, TocNode } from "../types";
import { epubChapterId, isHealthyBook } from "../types";
import { openPdf } from "../reader/pdfjs-setup";
import type { DataAdapter } from "obsidian";

export function flattenToc(items: NavItem[] | undefined, depth = 0): { label: string; href: string; depth: number }[] {
  const out: { label: string; href: string; depth: number }[] = [];
  for (const item of items ?? []) {
    out.push({ label: item.label.trim(), href: item.href, depth });
    out.push(...flattenToc(item.subitems, depth + 1));
  }
  return out;
}

export function tocNodesFromBook(book: Book, chapters?: Record<string, ChapterState>): TocNode[] {
  const build = (items: NavItem[]): TocNode[] => items.map((item) => {
    const section = book.spine.get(item.href.split("#")[0]);
    const matched = chapters && Object.entries(chapters).find(([, chapter]) => chapter.href === item.href);
    const firstId = section ? epubChapterId(section.index) : undefined;
    return {
      title: item.label.trim() || "（无标题）",
      href: item.href,
      chapterId: matched?.[0] ?? (firstId && (!chapters || chapters[firstId]) ? firstId : undefined),
      children: item.subitems?.length ? build(item.subitems) : undefined,
    };
  });
  return build(book.navigation.toc);
}

/** TOC fragments represent actual chapters even when several share one spine. */
export async function buildEpubChapters(book: Book): Promise<Record<string, ChapterState>> {
  await book.loaded.navigation;
  const spineItems = await book.loaded.spine;
  const toc = flattenToc(book.navigation.toc);
  const chapters: Record<string, ChapterState> = {};
  let order = 0;
  for (let spineIndex = 0; spineIndex < spineItems.length; spineIndex++) {
    const section = book.spine.get(spineIndex);
    if (!section || !section.linear) continue;
    const raw = await book.load(section.href);
    const doc = raw as Document;
    if (!doc.documentElement || typeof doc.createRange !== "function") throw new Error("EPUB 章节文档无效");
    const entries = toc.filter((item) => book.spine.get(item.href.split("#")[0])?.index === spineIndex);
    const unique = entries.filter((item, index) => entries.findIndex((other) => other.href === item.href) === index);
    const anchors = unique.filter((item) => item.href.includes("#"));
    anchors.sort((a, b) => {
      const left = doc.getElementById(decodeURIComponent(a.href.split("#")[1]));
      const right = doc.getElementById(decodeURIComponent(b.href.split("#")[1]));
      if (!left || !right) throw new Error("EPUB 目录锚点不存在");
      return left.compareDocumentPosition(right) & 4 ? -1 : left === right ? 0 : 1;
    });
    // A non-fragment wrapper titles the first chapter; it is not another copy of its children.
    const actual = anchors.length ? anchors : unique.slice(0, 1);
    if (!actual.length) actual.push({ href: section.href, label: doc.querySelector("h1,h2,h3,h4,h5,h6")?.textContent?.trim() || `第 ${spineIndex + 1} 节`, depth: 0 });
    actual.forEach((item, index) => {
      const id = epubChapterId(spineIndex, index);
      chapters[id] = {
        title: item.label || `第 ${order + 1} 章`, index: order++, spineIndex,
        href: index === 0 ? section.href : item.href,
        hrefEnd: actual[index + 1]?.href,
        questionVersions: [], answers: [], reviews: [],
      };
    });
  }
  if (!Object.keys(chapters).length) throw new Error("EPUB 不包含可阅读的主线章节");
  return chapters;
}

export async function epubChapterText(book: Book, spineIndex: number, href?: string, hrefEnd?: string): Promise<string> {
  const section = book.spine.get(spineIndex);
  if (!section) throw new Error(`EPUB spine ${spineIndex} 不存在`);
  const raw = await book.load(section.href);
  const doc = raw as Document;
  const body = doc.querySelector("body");
  if (!body) throw new Error("EPUB 章节缺少正文");
  const range = doc.createRange();
  range.selectNodeContents(body);
  for (const [position, target] of [["start", href], ["end", hrefEnd]] as const) {
    const fragment = target?.split("#")[1];
    if (!fragment) continue;
    const element = doc.getElementById(decodeURIComponent(fragment));
    if (!element) throw new Error(`EPUB 目录锚点不存在: ${fragment}`);
    if (position === "start") range.setStartBefore(element);
    else range.setEndBefore(element);
  }
  const content = range.cloneContents();
  content.querySelectorAll("script,style,nav,[hidden], [aria-hidden='true']").forEach((element) => element.remove());
  content.querySelectorAll("p,div,section,article,h1,h2,h3,h4,h5,h6,li,br").forEach((element) => element.appendChild(doc.createTextNode("\n")));
  return (content.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Reader-owned sources never get evicted by extraction of another book. */
export class BookCache {
  private epubs = new Map<string, Promise<Book>>();
  private pdfs = new Map<string, Promise<PDFDocumentProxy>>();
  constructor(private adapter: DataAdapter) {}

  private requireHealthy(entry: BookEntry): HealthyBookEntry {
    if (!isHealthyBook(entry)) throw new Error("书籍数据已损坏，请先恢复");
    return entry;
  }

  private async openEpub(entry: HealthyBookEntry): Promise<Book> {
    const bytes = await this.adapter.readBinary(`${entry.dir}/${entry.reading.book.fileName}`);
    const book = new Book();
    try {
      await book.open(bytes, "binary");
      await book.ready;
      await book.loaded.navigation;
      return book;
    } catch (error) { book.destroy(); throw error; }
  }

  private async openPdf(entry: HealthyBookEntry): Promise<PDFDocumentProxy> {
    const bytes = await this.adapter.readBinary(`${entry.dir}/${entry.reading.book.fileName}`);
    return openPdf(bytes);
  }

  getEpub(entry: BookEntry): Promise<Book> {
    const healthy = this.requireHealthy(entry);
    let pending = this.epubs.get(entry.dir);
    if (!pending) {
      pending = this.openEpub(healthy);
      this.epubs.set(entry.dir, pending);
      void pending.catch(() => { if (this.epubs.get(entry.dir) === pending) this.epubs.delete(entry.dir); });
    }
    return pending;
  }
  getPdf(entry: BookEntry): Promise<PDFDocumentProxy> {
    const healthy = this.requireHealthy(entry);
    let pending = this.pdfs.get(entry.dir);
    if (!pending) {
      pending = this.openPdf(healthy);
      this.pdfs.set(entry.dir, pending);
      void pending.catch(() => { if (this.pdfs.get(entry.dir) === pending) this.pdfs.delete(entry.dir); });
    }
    return pending;
  }

  async withEpub<T>(entry: BookEntry, use: (book: Book) => Promise<T>): Promise<T> {
    const book = await this.openEpub(this.requireHealthy(entry));
    try { return await use(book); } finally { book.destroy(); }
  }
  async withPdf<T>(entry: BookEntry, use: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
    const doc = await this.openPdf(this.requireHealthy(entry));
    try { return await use(doc); } finally { await doc.loadingTask.destroy(); }
  }

  async invalidate(idOrDir: string): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [path, pending] of this.epubs) if (path === idOrDir || path.endsWith(`/${idOrDir}`)) {
      this.epubs.delete(path);
      jobs.push(pending.then((book) => book.destroy(), () => {}));
    }
    for (const [path, pending] of this.pdfs) if (path === idOrDir || path.endsWith(`/${idOrDir}`)) {
      this.pdfs.delete(path);
      jobs.push(pending.then((doc) => doc.loadingTask.destroy(), () => {}));
    }
    await Promise.all(jobs);
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.epubs.keys(), ...this.pdfs.keys()].map((path) => this.invalidate(path)));
  }
}

export async function pdfPagesText(doc: PDFDocumentProxy, startPage: number, endPage: number): Promise<string> {
  const chunks: string[] = [];
  for (let p = startPage; p <= Math.min(endPage, doc.numPages); p++) {
    const page = await doc.getPage(p);
    try {
      const text = await page.getTextContent();
      chunks.push(text.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim());
    } finally { page.cleanup(); }
  }
  return chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
