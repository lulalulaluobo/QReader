// EPUB rendering stays inside script-disabled iframes. Position and annotations
// are retained independently of a rendition, including during mode rebuilds.
import type { Book, Rendition, Location } from "epubjs";
import { EpubCFI } from "epubjs";
import type Section from "epubjs/types/section";
import type { AnnotationRecord, ChapterState, ReadMode, ReadingLayout } from "../types";
import type { EngineHooks, EngineLocation, EngineSelection, ReaderEngine } from "./engine";
import { epubChapterId } from "../types";

const HL_CLASS = "qr-hl";
const HL_STYLES = { fill: "#FDE68A", "fill-opacity": "0.55", "mix-blend-mode": "multiply" };
interface ContentsLike {
  document: Document;
  window: Window;
  sectionIndex: number;
  cfiFromRange(range: Range): string;
}
type RestorePoint = { cfi?: string | null; percent?: number; chapterId?: string | null };

export class EpubEngine implements ReaderEngine {
  readonly format = "epub" as const;
  private rendition: Rendition | null = null;
  private container: HTMLElement | null = null;
  private mode: ReadMode;
  private layout: ReadingLayout;
  private theme: "light" | "dark";
  private marks = new Map<string, AnnotationRecord>();
  private attached = new Set<string>();
  private chapterIds = new Map<ChapterState, string>();
  private boundaries = new Map<ChapterState, string>();
  private cfiComparator = new EpubCFI();
  private ro: ResizeObserver | null = null;
  private resizeTimer: number | undefined;
  private destroyed = false;
  private restoring = false;
  private generation = 0;
  private spineLen = 1;
  private position: RestorePoint;
  private keyboard = (event: KeyboardEvent) => this.handleKey(event);
  private sanitize = (doc: Document) => {
    for (const element of doc.querySelectorAll("script, iframe, object, embed, form, meta[http-equiv='refresh']")) element.remove();
    for (const meta of doc.querySelectorAll("meta[http-equiv]")) {
      if (meta.getAttribute("http-equiv")?.toLowerCase() === "refresh") meta.remove();
    }
    for (const element of doc.querySelectorAll("*")) {
      for (const attr of Array.from(element.attributes)) {
        if (/^on/i.test(attr.name) || attr.name === "srcdoc") element.removeAttribute(attr.name);
      }
    }
    const policy = doc.createElement("meta");
    policy.setAttribute("http-equiv", "Content-Security-Policy");
    policy.setAttribute("content", "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; script-src 'none'; connect-src 'none'; form-action 'none'");
    const head = doc.head ?? doc.querySelector("head");
    if (head) head.prepend(policy);
  };

  constructor(
    private book: Book,
    private chapters: ChapterState[],
    start: RestorePoint,
    private hooks: EngineHooks,
    annotations: AnnotationRecord[],
    opts: { mode: ReadMode; layout: ReadingLayout; theme: "light" | "dark" }
  ) {
    this.position = { ...start };
    this.mode = opts.mode;
    this.layout = opts.layout;
    this.theme = opts.theme;
    this.chapters = [...chapters].sort((a, b) => a.index - b.index);
    const ordinals = new Map<number, number>();
    for (const chapter of this.chapters) {
      if (chapter.spineIndex === undefined) continue;
      const ordinal = ordinals.get(chapter.spineIndex) ?? 0;
      this.chapterIds.set(chapter, ordinal === 0 ? epubChapterId(chapter.spineIndex) : `${epubChapterId(chapter.spineIndex)}-${ordinal}`);
      ordinals.set(chapter.spineIndex, ordinal + 1);
    }
    for (const annotation of annotations) this.marks.set(annotation.id, annotation);
  }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    container.tabIndex = 0;
    container.addEventListener("keydown", this.keyboard);
    this.book.spine.hooks.content.register(this.sanitize);
    this.spineLen = Math.max(1, (await this.book.loaded.spine).length);
    this.book.spine.each((section: Section) => {
      if (section.document) this.sanitize(section.document);
    });
    // Phone-sized text segments keep percentage fallback near the saved page,
    // including books whose chapters are shorter than a conventional print page.
    if (!this.book.locations.length()) await this.book.locations.generate(256);
    if (this.destroyed) return;
    const host = document.createElement("div");
    host.className = "qr-epub-host";
    container.appendChild(host);
    await this.buildRendition(host, this.position);
    this.ro = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.resize(), 250);
    });
    this.ro.observe(container);
  }

  private chapterById(id: string): ChapterState | undefined {
    return this.chapters.find((chapter) => this.chapterIds.get(chapter) === id);
  }

  private chapterForCfi(cfi: string): string | undefined {
    const parsed = new EpubCFI(cfi);
    let found: ChapterState | undefined;
    for (const chapter of this.chapters) {
      if (chapter.spineIndex !== parsed.spinePos) continue;
      const boundary = this.boundaries.get(chapter);
      if (!found || (boundary && this.cfiComparator.compare(parsed, boundary) >= 0)) found = chapter;
    }
    return found ? this.chapterIds.get(found) : undefined;
  }

  private async buildRendition(host: HTMLElement, point: RestorePoint): Promise<void> {
    const generation = ++this.generation;
    this.restoring = true;
    const rendition = this.book.renderTo(host, {
      width: "100%", height: "100%", spread: "none",
      flow: this.mode === "scrolled" ? "scrolled-doc" : "paginated",
      manager: this.mode === "scrolled" ? "continuous" : "default",
      allowScriptedContent: false,
    });
    this.rendition = rendition;
    this.attached.clear();
    this.applyTheme();
    rendition.on("relocated", (location: Location) => {
      if (generation === this.generation && !this.destroyed && !this.restoring) this.handleRelocated(location);
    });
    rendition.on("selected", (cfi: string, contents: ContentsLike) => {
      if (generation === this.generation && !this.destroyed) this.handleSelected(cfi, contents);
    });
    rendition.hooks.content.register((contents: ContentsLike) => this.bindContents(contents));
    try {
      let displayed = false;
      if (point.cfi) {
        try { await rendition.display(point.cfi); displayed = true; } catch { /* Try the saved percentage next. */ }
      }
      if (!displayed && typeof point.percent === "number" && Number.isFinite(point.percent)) {
        const cfi = this.book.locations.cfiFromPercentage(Math.max(0, Math.min(1, point.percent)));
        if (cfi) {
          try { await rendition.display(cfi); displayed = true; } catch { /* Fall through to the chapter start. */ }
        }
      }
      if (!displayed) {
        const chapter = (point.chapterId && this.chapterById(point.chapterId)) || this.chapters[0];
        const item = chapter?.spineIndex !== undefined ? this.book.spine.get(chapter.spineIndex) : this.book.spine.first();
        await rendition.display(item?.href);
      }
      if (this.destroyed || generation !== this.generation) return;
      for (const annotation of this.marks.values()) this.attachHighlight(annotation);
      // reportLocation resolves on epub.js's animation-frame relocation. Keep the
      // intermediate default chapter suppressed throughout that frame.
      await rendition.reportLocation();
      this.restoring = false;
      if (rendition.location?.start) this.handleRelocated(rendition.location);
    } finally {
      if (generation === this.generation) this.restoring = false;
    }
  }

  private bindContents(contents: ContentsLike): void {
    const doc = contents.document;
    for (const chapter of this.chapters) {
      if (chapter.spineIndex !== contents.sectionIndex) continue;
      const fragment = chapter.href?.split("#")[1];
      if (!fragment) continue;
      const anchor = doc.getElementById(decodeURIComponent(fragment));
      if (!anchor) continue;
      const boundary = doc.createRange();
      boundary.selectNodeContents(anchor);
      boundary.collapse(true);
      this.boundaries.set(chapter, contents.cfiFromRange(boundary));
    }
    let touch: { x: number; y: number; time: number } | null = null;
    let swiped = false;
    doc.addEventListener("keydown", this.keyboard);
    doc.addEventListener("touchstart", (event) => {
      const first = event.touches[0];
      touch = first && event.touches.length === 1 ? { x: first.clientX, y: first.clientY, time: Date.now() } : null;
      swiped = false;
    }, { passive: true });
    doc.addEventListener("touchend", (event) => {
      const first = event.changedTouches[0];
      const selected = contents.window.getSelection();
      if (!touch || !first || this.mode !== "paginated" || (selected && !selected.isCollapsed)) return;
      const dx = first.clientX - touch.x;
      const dy = first.clientY - touch.y;
      if (Date.now() - touch.time < 700 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
        swiped = true;
        this.navigate(dx < 0);
      }
      touch = null;
    }, { passive: true });
    doc.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const element = target?.nodeType === Node.ELEMENT_NODE ? target : null;
      const link = element?.closest("a");
      if (link) {
        const href = link.getAttribute("href") ?? "";
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) && !href.startsWith("blob:")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      if (swiped || element?.closest(`.${HL_CLASS}`)) { swiped = false; return; }
      const selection = contents.window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const width = contents.window.innerWidth;
      const height = contents.window.innerHeight;
      if (event.clientX > width / 3 && event.clientX < width * 2 / 3 && event.clientY > height / 4 && event.clientY < height * 3 / 4) this.hooks.onZoneTap();
      else this.hooks.onSurfaceClick();
    }, true);
  }

  private navigate(forward: boolean): void {
    void (forward ? this.next() : this.prev()).catch((error: unknown) => this.reportError(error));
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.nodeType === Node.ELEMENT_NODE && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); this.navigate(true); }
    else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); this.navigate(false); }
  }

  private applyTheme(): void {
    const background = this.theme === "dark" ? "#1e1e1e" : "#ffffff";
    const color = this.theme === "dark" ? "#d4d4d4" : "#2f2f2f";
    this.rendition?.themes.default({
      "html, body": { background: `${background} !important`, color: `${color} !important` },
      "body, p, div, li, blockquote, td, span": {
        "font-size": `${this.layout.fontSize}px !important`,
        "line-height": `${this.layout.lineHeight} !important`,
        color: `${color} !important`,
      },
      "body": { "font-family": "var(--font-text, system-ui), sans-serif !important", padding: "0 12px !important" },
      "img, svg": { "max-width": "100% !important", "height": "auto" },
      "a": { color: this.theme === "dark" ? "#93c5fd !important" : "#2563eb !important" },
    });
  }

  private handleRelocated(location: Location): void {
    const start = location.start;
    if (!start || typeof start.index !== "number") return;
    const measured = this.book.locations.percentageFromCfi(start.cfi);
    const percent = Number.isFinite(measured) && measured >= 0 ? measured : start.index / this.spineLen;
    const out: EngineLocation = { chapterId: this.chapterForCfi(start.cfi) ?? null, percent: Math.max(0, Math.min(1, percent)), cfi: start.cfi };
    this.position = out;
    this.hooks.onLocation(out);
  }

  private handleSelected(cfi: string, contents: ContentsLike): void {
    const selection = contents.window.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    const prefix = contents.document.createRange();
    prefix.selectNodeContents(contents.document.body);
    prefix.setEnd(range.startContainer, range.startOffset);
    const match = /epubcfi\(\/6\/(\d+)/.exec(cfi);
    const spine = match ? (Number(match[1]) - 2) / 2 : 0;
    this.hooks.onSelect({ text: selection.toString().trim(), chapterId: this.chapterForCfi(cfi), cfi, sortKey: spine * 1_000_000_000 + prefix.toString().length });
  }

  private attachHighlight(annotation: AnnotationRecord): void {
    if (!annotation.cfi || !this.rendition || this.attached.has(annotation.id)) return;
    const id = annotation.id;
    this.rendition.annotations.add("highlight", annotation.cfi, { id }, () => {
      if (this.marks.has(id)) this.hooks.onAnnotationClick(id);
    }, HL_CLASS, HL_STYLES);
    this.attached.add(id);
  }

  addHighlight(annotation: AnnotationRecord): void {
    const previous = this.marks.get(annotation.id);
    if (previous?.cfi) this.rendition?.annotations.remove(previous.cfi, "highlight");
    this.attached.delete(annotation.id);
    this.marks.set(annotation.id, annotation);
    this.attachHighlight(annotation);
  }

  removeHighlight(annotation: AnnotationRecord): void {
    const cfi = this.marks.get(annotation.id)?.cfi ?? annotation.cfi;
    this.marks.delete(annotation.id);
    this.attached.delete(annotation.id);
    if (cfi) this.rendition?.annotations.remove(cfi, "highlight");
  }

  async goToChapter(chapterId: string, targetHref?: string): Promise<void> {
    const chapter = this.chapterById(chapterId);
    if (!chapter || chapter.spineIndex === undefined || !this.rendition) return;
    await this.rendition.display(targetHref ?? chapter.href ?? this.book.spine.get(chapter.spineIndex).href);
  }

  async next(): Promise<void> {
    if (this.mode === "scrolled") this.scrollBy(0.85);
    else await this.rendition?.next();
  }
  async prev(): Promise<void> {
    if (this.mode === "scrolled") this.scrollBy(-0.85);
    else await this.rendition?.prev();
  }
  private scrollBy(fraction: number): void {
    const scroller = this.container?.querySelector<HTMLElement>(".epub-container");
    scroller?.scrollBy({ top: scroller.clientHeight * fraction, behavior: "smooth" });
  }
  getMode(): ReadMode { return this.mode; }

  async setMode(mode: ReadMode): Promise<void> {
    if (mode === this.mode || !this.rendition || !this.container) return;
    const point = { ...this.position, cfi: this.rendition.location?.start?.cfi ?? this.position.cfi };
    this.restoring = true;
    this.mode = mode;
    this.generation++;
    this.rendition.destroy();
    this.rendition = null;
    const host = this.container.querySelector<HTMLElement>(".qr-epub-host");
    if (!host) throw new Error("EPUB 阅读容器已移除");
    host.replaceChildren();
    await this.buildRendition(host, point);
  }

  async applyLayout(layout: ReadingLayout, theme: "light" | "dark"): Promise<void> {
    const cfi = this.rendition?.location?.start?.cfi ?? this.position.cfi;
    this.layout = layout;
    this.theme = theme;
    this.restoring = true;
    try {
      this.applyTheme();
      if (cfi && this.rendition) await this.rendition.display(cfi);
      await this.rendition?.reportLocation();
    } finally { this.restoring = false; }
    if (this.rendition?.location?.start) this.handleRelocated(this.rendition.location);
  }

  async getSelectionContext(selection: EngineSelection): Promise<{ before: string; after: string }> {
    if (!selection.cfi) return { before: "", after: "" };
    const range = await this.book.getRange(selection.cfi);
    const doc = range.startContainer.ownerDocument;
    if (!doc?.body) return { before: "", after: "" };
    const before = doc.createRange();
    before.selectNodeContents(doc.body);
    before.setEnd(range.startContainer, range.startOffset);
    const after = doc.createRange();
    after.selectNodeContents(doc.body);
    after.setStart(range.endContainer, range.endOffset);
    return { before: before.toString().slice(-300), after: after.toString().slice(0, 300) };
  }

  resize(): void {
    const container = this.container;
    if (!container || this.destroyed) return;
    this.rendition?.resize(container.clientWidth, container.clientHeight);
  }
  private reportError(error: unknown): void { this.hooks.onError?.(error instanceof Error ? error : new Error(String(error))); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    window.clearTimeout(this.resizeTimer);
    this.ro?.disconnect();
    this.book.spine.hooks.content.deregister(this.sanitize);
    this.container?.removeEventListener("keydown", this.keyboard);
    this.rendition?.destroy();
    this.rendition = null;
    this.container?.replaceChildren();
  }
}
