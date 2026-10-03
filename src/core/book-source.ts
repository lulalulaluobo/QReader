import { Book } from "epubjs";
import type { NavItem } from "epubjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BookEntry, ChapterState, HealthyBookEntry, TocNode } from "../types";
import { epubChapterId, isHealthyBook } from "../types";
import { openPdf } from "../reader/pdfjs-setup";
import type { DataAdapter } from "obsidian";
import { isReviewableChapter, reviewExclusionFromSemantics } from "./review-chapters";
import { bookAsEpub } from "./book-formats";

function epubHrefKey(book: Book, href: string, base = book.path.toString()): string {
  return new URL(href, new URL(base, "https://qreader.invalid/")).href;
}

/** EPUB.js discards OPF guide and TOC-link semantics, so retain them read-only here. */
async function epubReviewMetadata(book: Book): Promise<Map<string, boolean>> {
  const metadata = new Map<string, boolean>();
  const cover = book.packaging.coverPath;
  if (cover) metadata.set(epubHrefKey(book, cover), true);
  const packageDoc = await book.load(book.path.toString()) as Document;
  for (const reference of packageDoc.querySelectorAll("guide reference[href]")) {
    const excluded = reviewExclusionFromSemantics(reference.getAttribute("type") ?? "");
    if (excluded !== undefined) metadata.set(epubHrefKey(book, reference.getAttribute("href")!), excluded);
  }
  const navPath = book.packaging.navPath;
  if (navPath) {
    metadata.set(epubHrefKey(book, navPath), true);
    const navDoc = await book.load(navPath) as Document;
    const base = epubHrefKey(book, navPath);
    for (const link of navDoc.querySelectorAll("a[href]")) {
      const item = link.closest("li");
      const excluded = reviewExclusionFromSemantics([
        link.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? link.getAttribute("epub:type") ?? "",
        link.getAttribute("role") ?? "",
        item?.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? item?.getAttribute("epub:type") ?? "",
        item?.getAttribute("role") ?? "",
      ].join(" "));
      if (excluded !== undefined) metadata.set(epubHrefKey(book, link.getAttribute("href")!, base), excluded);
    }
  }
  return metadata;
}

function epubDocumentReviewExclusion(
  book: Book, metadata: ReadonlyMap<string, boolean>, doc: Document,
  href: string, hrefEnd?: string, first = true,
): boolean | undefined {
  const body = doc.querySelector("body");
  if (!body) return undefined;
  const fragment = href.split("#")[1];
  const target = fragment ? doc.getElementById(decodeURIComponent(fragment)) : null;
  const endFragment = hrefEnd?.split("#")[1];
  const end = endFragment ? doc.getElementById(decodeURIComponent(endFragment)) : null;
  const range = doc.createRange();
  range.selectNodeContents(body);
  if (target) range.setStartBefore(target);
  if (end) range.setEndBefore(end);
  // A fragment inherits only its own ancestors, never a sibling preface elsewhere in the spine.
  for (let element = target; element && element !== body; element = element.parentElement) {
    const excluded = reviewExclusionFromSemantics([
      element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? element.getAttribute("epub:type") ?? "",
      element.getAttribute("role") ?? "",
    ].join(" "));
    if (excluded !== undefined) return excluded;
  }
  const exact = fragment ? metadata.get(epubHrefKey(book, href)) : undefined;
  if (exact !== undefined) return exact;
  let auxiliary: Element | undefined;
  for (const element of body.querySelectorAll("section,article,div,h1,h2,h3,h4,h5,h6")) {
    // Range.intersectsNode includes an element precisely at its end boundary in some DOMs.
    if (end && (element === end || (end.compareDocumentPosition(element) & 4))) continue;
    if (!range.intersectsNode(element)) continue;
    const excluded = reviewExclusionFromSemantics([
      element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? element.getAttribute("epub:type") ?? "",
      element.getAttribute("role") ?? "",
    ].join(" "));
    if (excluded === false) return false;
    if (excluded === true && !auxiliary) auxiliary = element;
  }
  if (auxiliary && (target || end || auxiliary.textContent?.trim() === body.textContent?.trim())) return true;
  for (const element of [body, doc.documentElement]) {
    const excluded = reviewExclusionFromSemantics([
      element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? element.getAttribute("epub:type") ?? "",
      element.getAttribute("role") ?? "",
    ].join(" "));
    if (excluded !== undefined) return excluded;
  }
  if (first) {
    const pageExclusion = metadata.get(epubHrefKey(book, href.split("#")[0]));
    if (pageExclusion !== undefined) return pageExclusion;
    // Cover metadata generally names an image, not its containing XHTML spine item.
    if (!body.textContent?.trim()) for (const image of body.querySelectorAll("img,image")) {
      const src = image.getAttribute("src") ?? image.getAttribute("href") ?? image.getAttribute("xlink:href");
      if (src && metadata.get(epubHrefKey(book, src, epubHrefKey(book, href))) === true) return true;
    }
  }
  return undefined;
}

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
  const reviewMetadata = await epubReviewMetadata(book);
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
      const chapter: ChapterState = {
        title: item.label || `第 ${order + 1} 章`, index: order++, spineIndex,
        href: index === 0 ? section.href : item.href,
        hrefEnd: actual[index + 1]?.href,
        questionVersions: [], answers: [], reviews: [],
      };
      const structural = epubDocumentReviewExclusion(book, reviewMetadata, doc, item.href, chapter.hrefEnd, index === 0);
      chapter.reviewExcluded = !isReviewableChapter(chapter, structural);
      chapters[id] = chapter;
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
  private reviewExclusions = new Map<string, Promise<ReadonlyMap<string, boolean>>>();
  constructor(private adapter: DataAdapter) {}

  private requireHealthy(entry: BookEntry): HealthyBookEntry {
    if (!isHealthyBook(entry)) throw new Error("书籍数据已损坏，请先恢复");
    return entry;
  }

  private async openEpub(entry: HealthyBookEntry): Promise<Book> {
    const bytes = await this.adapter.readBinary(`${entry.dir}/${entry.reading.book.fileName}`);
    const book = new Book();
    try {
      await book.open(await bookAsEpub(bytes, entry.reading.book.fileName, entry.reading.book.format), "binary");
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

  /** Legacy classification is cached by chapter locators, never written into reading.json. */
  async getReviewExclusions(entry: HealthyBookEntry): Promise<ReadonlyMap<string, boolean>> {
    if (entry.reading.book.format === "cbz") return new Map(Object.keys(entry.reading.chapters).map((id) => [id, true]));
    if (entry.reading.book.format === "pdf" || !Object.values(entry.reading.chapters).some((chapter) => chapter.reviewExcluded === undefined)) return new Map();
    const legacy = Object.entries(entry.reading.chapters).filter(([, chapter]) => chapter.reviewExcluded === undefined);
    const key = JSON.stringify([entry.dir, entry.reading.book.fileName, legacy.map(([id, chapter]) => [id, chapter.spineIndex, chapter.href, chapter.hrefEnd])]);
    let pending = this.reviewExclusions.get(key);
    if (!pending) {
      pending = (async () => {
        const book = await this.getEpub(entry);
        const metadata = await epubReviewMetadata(book);
        const docs = new Map<number, Document>();
        const exclusions = new Map<string, boolean>();
        const toc = flattenToc(book.navigation.toc);
        for (const [id, chapter] of legacy) {
          const section = chapter.spineIndex !== undefined ? book.spine.get(chapter.spineIndex) : chapter.href ? book.spine.get(chapter.href.split("#")[0]) : null;
          if (!section) continue;
          let doc = docs.get(section.index);
          if (!doc) {
            doc = await book.load(section.href) as Document;
            docs.set(section.index, doc);
          }
          let href = chapter.href ?? section.href;
          // The first fragment's saved href intentionally includes the spine's leading content.
          // Recover its semantic target without changing that locator or any saved chapter ID.
          if (!href.includes("#")) {
            const anchors = toc.filter((item) => item.href.includes("#") && book.spine.get(item.href.split("#")[0])?.index === section.index);
            anchors.sort((a, b) => {
              const left = doc!.getElementById(decodeURIComponent(a.href.split("#")[1]));
              const right = doc!.getElementById(decodeURIComponent(b.href.split("#")[1]));
              return left && right && left !== right && (left.compareDocumentPosition(right) & 4) ? -1 : 1;
            });
            if (chapter.hrefEnd || anchors.length === 1) href = anchors[0]?.href ?? href;
          }
          const excluded = epubDocumentReviewExclusion(book, metadata, doc, href, chapter.hrefEnd, !chapter.href?.includes("#"));
          if (excluded !== undefined) exclusions.set(id, excluded);
        }
        return exclusions;
      })();
      this.reviewExclusions.set(key, pending);
      void pending.catch(() => { if (this.reviewExclusions.get(key) === pending) this.reviewExclusions.delete(key); });
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
    // Invalidation also drops read-only legacy classifications for this source.
    for (const key of this.reviewExclusions.keys()) {
      const [path] = JSON.parse(key) as [string];
      if (path === idOrDir || path.endsWith(`/${idOrDir}`)) this.reviewExclusions.delete(key);
    }
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
    const paths = [...this.epubs.keys(), ...this.pdfs.keys()];
    this.reviewExclusions.clear();
    await Promise.all(paths.map((path) => this.invalidate(path)));
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
