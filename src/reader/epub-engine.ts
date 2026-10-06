// EPUB rendering stays inside script-disabled iframes. Position and annotations
// are retained independently of a rendition, including during mode rebuilds.
import type { Book, Rendition, Location } from "epubjs";
import { EpubCFI } from "epubjs";
import type Section from "epubjs/types/section";
import type { AnnotationRecord, BookFormat, ChapterState, ReadMode, ReadingLayout, ReadingColors } from "../types";
import type { EngineHooks, EngineLocation, EngineSelection, ReaderEngine, SpeechBatch, SpeechSegment } from "./engine";
import { epubSpeechSegments } from "./speech-text";
import { speechHighlight } from "./speech-highlight";
import { epubChapterId } from "../types";
import { HIGHLIGHT_COLORS, READING_FONTS } from "../settings";
import { WordLayer } from "./word-layer";
import type { VocabularyWord } from "../core/vocabulary";

const HL_CLASS = "qr-hl";
interface ContentsLike {
  document: Document;
  window: Window;
  sectionIndex: number;
  cfiFromRange(range: Range): string;
  addStylesheetCss(css: string, key?: string): boolean;
}
type RestorePoint = { cfi?: string | null; percent?: number; chapterId?: string | null };

export class EpubEngine implements ReaderEngine {
  readonly format: Exclude<BookFormat, "pdf">;
  readonly reflowable: boolean;
  private rendition: Rendition | null = null;
  private contentHook: Book["spine"]["hooks"]["content"] | null = null;
  private container: HTMLElement | null = null;
  private wordLayers = new Map<Document, WordLayer>();
  private vocabulary: readonly VocabularyWord[] = [];
  private vocabularyHighlight = true;
  private vocabularyThreshold = 5;
  private mode: ReadMode;
  private layout: ReadingLayout;
  private theme: ReadingColors;
  private readingCss = "";
  private marks = new Map<string, AnnotationRecord>();
  private attached = new Set<string>();
  private chapterIds = new Map<ChapterState, string>();
  private boundaries = new Map<ChapterState, string>();
  private cfiComparator = new EpubCFI();
  private ro: ResizeObserver | null = null;
  private resizeTimer: number | undefined;
  private destroyed = false;
  private restoring = false;
  private suspended = false;
  private generation = 0;
  private renderedMargin = 0;
  private spineLen = 1;
  private position: RestorePoint;
  private speechGeneration = 0;
  private speechSegment: SpeechSegment | null = null;
  private speechFollowing = true;
  private speechPageEnd: string | null = null;
  private navigation: Promise<void> = Promise.resolve();
  private resizePoint: { cfi: string; offset: number | null } | null = null;
  private removeSpeechMark: (() => void) | null = null;
  // Only the rendition owns paginated scrolling. Native selection/focus scrolling
  // can otherwise leave a fractional-page offset that next/prev never removes.
  private selectionScroll: { left: number; top: number } | null = null;
  private pageScroll = { left: 0, top: 0 };
  private selectionScroller: HTMLElement | null = null;
  private guardSelectionScroll = () => {
    if (this.restoring || !this.selectionScroll || !this.selectionScroller) return;
    const { left, top } = this.selectionScroll;
    if (this.selectionScroller.scrollLeft !== left) this.selectionScroller.scrollLeft = left;
    if (this.selectionScroller.scrollTop !== top) this.selectionScroller.scrollTop = top;
  };
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
    opts: { mode: ReadMode; layout: ReadingLayout; theme: ReadingColors; format: Exclude<BookFormat, "pdf"> }
  ) {
    this.format = opts.format;
    this.reflowable = this.book.packaging.metadata.layout !== "pre-paginated";
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
    for (const annotation of annotations) this.marks.set(annotation.id, { ...annotation });
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.destroyed) return;
    this.container = container;
    container.tabIndex = 0;
    container.addEventListener("keydown", this.keyboard);
    this.contentHook = this.book.spine.hooks.content;
    this.contentHook.register(this.sanitize);
    this.spineLen = Math.max(1, (await this.book.loaded.spine).length);
    if (this.destroyed) return;
    this.book.spine.each((section: Section) => {
      if (section.document) this.sanitize(section.document);
    });
    // Phone-sized text segments keep percentage fallback near the saved page,
    // including books whose chapters are shorter than a conventional print page.
    if (this.book.packaging.metadata.layout !== "pre-paginated" && !this.book.locations.length()) {
      await this.book.locations.generate(256);
    }
    if (this.destroyed) return;
    const host = document.createElement("div");
    host.className = "qr-epub-host";
    host.addEventListener("wheel", () => this.manualNavigation(), { passive: true });
    container.appendChild(host);
    await this.buildRendition(host, this.position);
    if (this.destroyed) return;
    this.ro = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      if (!container.clientWidth || !container.clientHeight) {
        this.suspended = true;
        return;
      }
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
    // epub.js 的分页左右 padding 来自 gap / 2，不能只用书内 CSS 覆盖。
    this.renderedMargin = this.layout.pageMargin;
    const options = {
      width: "100%", height: "100%", spread: "none",
      flow: this.mode === "scrolled" ? "scrolled-doc" : "paginated",
      manager: this.mode === "scrolled" ? "continuous" : "default",
      gap: this.reflowable ? this.renderedMargin * 2 : undefined,
      allowScriptedContent: false,
    };
    const rendition = this.book.renderTo(host, options);
    this.rendition = rendition;
    this.attached.clear();
    this.selectionScroller?.removeEventListener("scroll", this.guardSelectionScroll);
    this.selectionScroller = null;
    this.selectionScroll = null;
    this.applyTheme();
    rendition.on("resized", () => {
      if (generation !== this.generation || this.destroyed) return;
      const cfi = this.resizePoint?.cfi ?? this.position.cfi;
      // EPUB.js emits this before restoring location.start.cfi. Replace its stale fallback.
      if (cfi && rendition.location?.start) rendition.location.start.cfi = cfi;
    });
    rendition.on("relocated", (location: Location) => {
      if (generation !== this.generation || this.destroyed) return;
      for (const [doc, layer] of this.wordLayers) {
        if (!doc.defaultView?.frameElement?.isConnected) { layer.flush(); layer.destroy(); this.wordLayers.delete(doc); }
        else layer.refresh();
      }
      if (!this.restoring) {
        this.restoreResizePoint();
        this.handleRelocated(location);
      }
      this.paintSpeech();
    });
    rendition.on("selected", (cfi: string, contents: ContentsLike) => {
      if (generation === this.generation && !this.destroyed) this.handleSelected(cfi, contents);
    });
    rendition.hooks.content.register((contents: ContentsLike) => { if (generation === this.generation && !this.destroyed) this.bindContents(contents); });
    try {
      let displayed = false;
      let restoredCfi = false;
      if (point.cfi) {
        try { await rendition.display(point.cfi); displayed = restoredCfi = true; } catch { /* Try the saved percentage next. */ }
      }
      if (!displayed && typeof point.percent === "number" && Number.isFinite(point.percent)) {
        if (this.book.packaging.metadata.layout === "pre-paginated") {
          const index = Math.max(0, Math.min(this.spineLen - 1, Math.ceil(point.percent * this.spineLen) - 1));
          await rendition.display(this.book.spine.get(index).href);
          displayed = true;
        }
        if (!displayed) {
          const cfi = this.book.locations.cfiFromPercentage(Math.max(0, Math.min(1, point.percent)));
          if (cfi) {
            try { await rendition.display(cfi); displayed = true; } catch { /* Fall through to the chapter start. */ }
          }
        }
      }
      if (!displayed) {
        const chapter = (point.chapterId && this.chapterById(point.chapterId)) || this.chapters[0];
        const item = chapter?.spineIndex !== undefined ? this.book.spine.get(chapter.spineIndex) : this.book.spine.first();
        await rendition.display(item?.href);
      }
      if (this.destroyed || generation !== this.generation) return;
      if (this.mode === "paginated") {
        this.selectionScroller = host.querySelector<HTMLElement>(".epub-container");
        this.selectionScroller?.addEventListener("scroll", this.guardSelectionScroll);
      }
      for (const annotation of this.marks.values()) this.attachHighlight(annotation);
      // reportLocation resolves on epub.js's animation-frame relocation. Keep the
      // intermediate default chapter suppressed throughout that frame.
      await rendition.reportLocation();
      if (restoredCfi && point.cfi && !this.destroyed && generation === this.generation) {
        // Converted books can finish their first layout after the initial CFI
        // display. Reapply the saved target once that layout has been measured.
        await rendition.display(point.cfi);
        await rendition.reportLocation();
      }
      this.restoring = false;
      if (rendition.location?.start) this.handleRelocated(rendition.location);
    } finally {
      if (generation === this.generation) this.restoring = false;
    }
  }

  private bindContents(contents: ContentsLike): void {
    const doc = contents.document;
    this.wordLayers.get(doc)?.destroy();
    if (this.container && this.format !== "cbz") {
      const words = new WordLayer(doc, doc.body, this.container, `epub:${contents.sectionIndex}`, this.hooks.onWordExposure);
      this.wordLayers.set(doc, words);
      words.set(this.vocabulary, this.vocabularyHighlight, this.vocabularyThreshold);
    }
    contents.addStylesheetCss(this.readingCss, "qreader-reading");
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
    const rememberPage = () => {
      if (this.mode !== "paginated" || !this.selectionScroller || this.selectionScroll) return;
      this.pageScroll = { left: this.selectionScroller.scrollLeft, top: this.selectionScroller.scrollTop };
    };
    doc.addEventListener("pointerdown", rememberPage, { passive: true });
    doc.addEventListener("touchstart", rememberPage, { passive: true });
    doc.addEventListener("selectionchange", () => {
      if (this.mode !== "paginated" || this.restoring || this.destroyed) return;
      const selected = contents.window.getSelection();
      if (selected && !selected.isCollapsed) {
        this.selectionScroll ??= { ...this.pageScroll };
        this.guardSelectionScroll();
      } else {
        this.guardSelectionScroll();
        this.selectionScroll = null;
      }
    });
    let touch: { x: number; y: number; time: number } | null = null;
    let swiped = false;
    doc.addEventListener("keydown", this.keyboard);
    doc.addEventListener("wheel", () => this.manualNavigation(), { passive: true });
    doc.addEventListener("touchmove", (event) => {
      const first = event.touches[0];
      if (touch && first && Math.hypot(first.clientX - touch.x, first.clientY - touch.y) > 10) this.manualNavigation();
    }, { passive: true });
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
        return;
      }
      if (swiped || element?.closest(`.${HL_CLASS}`)) { swiped = false; return; }
      const selection = contents.window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const surface = this.container?.getBoundingClientRect();
      const frame = contents.window.frameElement?.getBoundingClientRect();
      if (!surface || !frame) return;
      const hostX = frame.left + event.clientX;
      const hostY = frame.top + event.clientY;
      // EPUB.js proxies SVG mark events through the iframe. Hit-test before the
      // centre-tap handler so opening a highlight never also reveals the chrome.
      for (const mark of this.container!.querySelectorAll(`.${HL_CLASS} rect`)) {
        const rect = mark.getBoundingClientRect();
        const id = mark.parentElement?.getAttribute("data-id");
        if (id && hostX >= rect.left && hostX <= rect.right && hostY >= rect.top && hostY <= rect.bottom) {
          this.hooks.onAnnotationClick(id, rect);
          return;
        }
      }
      const x = (hostX - surface.left) / surface.width;
      const y = (hostY - surface.top) / surface.height;
      if (x > 1 / 3 && x < 2 / 3 && y > 0.25 && y < 0.75) this.hooks.onZoneTap();
      else this.hooks.onSurfaceClick();
    }, true);
    doc.addEventListener("contextmenu", (event) => {
      if (!contents.window.getSelection()?.isCollapsed) event.preventDefault();
    });
  }

  private navigate(forward: boolean): void {
    void (forward ? this.next() : this.prev()).catch((error: unknown) => this.reportError(error));
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.nodeType === Node.ELEMENT_NODE && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.hooks.onZoneTap(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) this.manualNavigation();
    if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); this.navigate(true); }
    else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); this.navigate(false); }
  }

  private applyTheme(): void {
    const { background, foreground, dark } = this.theme;
    if (!this.reflowable) {
      this.readingCss = `html, body { background: ${background} !important; }`;
    } else {
      const font = READING_FONTS[this.layout.fontFamily];
      const family = font ? `font-family: ${font} !important;` : "";
      this.readingCss = `
        html, body { background: ${background} !important; color: ${foreground} !important; }
        body, p, div, li, blockquote, td, span {
          font-size: ${this.layout.fontSize}px !important;
          line-height: ${this.layout.lineHeight} !important;
          color: ${foreground} !important; ${family}
        }
        body { padding: 28px ${this.layout.pageMargin}px 48px !important; overflow-wrap: anywhere; }
        p { text-indent: ${this.layout.paragraphIndent ? "2em" : "0"} !important; }
        img, svg { max-width: 100% !important; height: auto; }
        h1, h2, h3, h4, h5, h6, figcaption, dt { color: ${foreground} !important; ${family} }
        a { color: ${dark ? "#93c5fd" : "#2563eb"} !important; }
      `;
    }
    // addStylesheetRules 会累积旧规则；命名 CSS 整体替换才能真正恢复原书字体。
    const contents = (this.rendition?.getContents() ?? []) as unknown as ContentsLike[];
    for (const content of contents) content.addStylesheetCss(this.readingCss, "qreader-reading");
  }

  private visibleCfi(fallback: string, end = false): string {
    const surface = this.container?.getBoundingClientRect();
    if (!this.reflowable || !surface?.width || !surface.height) return fallback;
    const contents = (this.rendition?.getContents() ?? []) as unknown as ContentsLike[];
    for (const content of end ? [...contents].reverse() : contents) {
      const doc = content.document;
      const frame = content.window.frameElement?.getBoundingClientRect();
      if (!frame || !doc.body || !doc.caretRangeFromPoint ||
          frame.right <= surface.left || frame.left >= surface.right ||
          frame.bottom <= surface.top || frame.top >= surface.bottom) continue;
      const padding = content.window.getComputedStyle(doc.body);
      const rightToLeft = padding.direction === "rtl" || padding.writingMode === "vertical-rl";
      const x = rightToLeft !== end
        ? Math.min(frame.right, surface.right) - frame.left - parseFloat(padding.paddingRight) - 1
        : Math.max(frame.left, surface.left) - frame.left + parseFloat(padding.paddingLeft) + 1;
      const top = Math.max(frame.top, surface.top) - frame.top;
      const y = end ? Math.min(frame.bottom, surface.bottom) - frame.top - 2 : top + parseFloat(padding.paddingTop) + 1;
      // Page-end CFIs must use visible characters; EPUB.js splits on spaces and
      // can otherwise map a long Chinese paragraph's page end back to its start.
      for (let point = y; point >= top; point -= 8) {
        const range = doc.caretRangeFromPoint(x, point);
        if (range?.startContainer.nodeType === Node.TEXT_NODE && doc.body.contains(range.startContainer)) {
          if (!end) return content.cfiFromRange(range);
          // A trailing caret can mean the beginning of the next wrapped line.
          // Store the last visible character, so that line's first sentence returns on time.
          const length = range.startContainer.textContent?.length ?? 0;
          for (const offset of [Math.min(range.startOffset, length - 1), range.startOffset - 1]) {
            if (offset < 0 || offset >= length) continue;
            const character = range.cloneRange();
            character.setStart(range.startContainer, offset); character.setEnd(range.startContainer, offset + 1);
            const rect = character.getClientRects()[0];
            if (rect && rect.left + frame.left >= surface.left - 2 && rect.left + frame.left < surface.right - 1 &&
                rect.top + frame.top < surface.bottom - 1 && rect.bottom + frame.top > surface.top) {
              character.collapse(true);
              return content.cfiFromRange(character);
            }
          }
        }
        if (!end) break;
      }
    }
    return fallback;
  }

  private handleRelocated(location: Location): void {
    const start = location.start;
    if (!this.container?.clientWidth || !this.container.clientHeight) this.suspended = true;
    if (this.suspended) return;
    if (!start || typeof start.index !== "number") return;
    if (this.selectionScroll) {
      this.guardSelectionScroll();
      return;
    }
    if (this.selectionScroller) {
      this.pageScroll = { left: this.selectionScroller.scrollLeft, top: this.selectionScroller.scrollTop };
    }
    // EPUB.js 按空格拆词，长中文段落会把后续页报告成段首。用可见文字的
    // 原生 caret 生成同一种 CFI，避免新增定位格式或改写旧批注。
    const cfi = this.visibleCfi(start.cfi);
    // Rendition 在 resize 时复用 start.cfi；也让其保留精确位置，不能退回段首。
    start.cfi = cfi;
    const measured = this.reflowable ? this.book.locations.percentageFromCfi(cfi) : -1;
    const percent = !this.reflowable
      ? (start.index + 1) / this.spineLen
      : Number.isFinite(measured) && measured >= 0 ? measured : start.index / this.spineLen;
    const out: EngineLocation = { chapterId: this.chapterForCfi(cfi) ?? null, percent: Math.max(0, Math.min(1, percent)), cfi };
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
    const frame = contents.window.frameElement?.getBoundingClientRect();
    const surface = this.container?.getBoundingClientRect();
    const rect = frame && surface ? Array.from(range.getClientRects()).find((rect) =>
      rect.width > 0 && rect.height > 0 && frame.left + rect.right > surface.left &&
      frame.left + rect.left < surface.right && frame.top + rect.bottom > surface.top &&
      frame.top + rect.top < surface.bottom
    ) : undefined;
    const anchor = frame && surface && rect ? {
      left: Math.max(surface.left, frame.left + rect.left),
      right: Math.min(surface.right, frame.left + rect.right),
      top: Math.max(surface.top, frame.top + rect.top),
      bottom: Math.min(surface.bottom, frame.top + rect.bottom),
    } : undefined;
    this.hooks.onSelect({ text: selection.toString().trim(), copyText: selection.toString(), paragraphId: this.wordLayers.get(contents.document)?.paragraphId(range.startContainer), chapterId: this.chapterForCfi(cfi), cfi, sortKey: spine * 1_000_000_000 + prefix.toString().length, anchor });
  }

  private attachHighlight(annotation: AnnotationRecord): void {
    if (!annotation.cfi || !this.rendition || this.attached.has(annotation.id)) return;
    const id = annotation.id;
    const color = HIGHLIGHT_COLORS[annotation.color ?? "yellow"];
    this.rendition.annotations.add("highlight", annotation.cfi, { id }, (event: Event) => {
      event.stopPropagation();
      const target = event.currentTarget as Element | null;
      const anchor = target?.getBoundingClientRect();
      if (this.marks.has(id)) this.hooks.onAnnotationClick(id, anchor);
    }, HL_CLASS, {
      fill: color.fill, "fill-opacity": "0.28",
      stroke: "none", "stroke-width": "0",
      "mix-blend-mode": "normal",
    });
    this.attached.add(id);
  }

  addHighlight(annotation: AnnotationRecord): void {
    const previous = this.marks.get(annotation.id);
    if (previous?.cfi) this.rendition?.annotations.remove(previous.cfi, "highlight");
    this.attached.delete(annotation.id);
    this.marks.set(annotation.id, { ...annotation });
    this.attachHighlight(annotation);
  }

  removeHighlight(annotation: AnnotationRecord): void {
    const cfi = this.marks.get(annotation.id)?.cfi ?? annotation.cfi;
    this.marks.delete(annotation.id);
    this.attached.delete(annotation.id);
    if (cfi) this.rendition?.annotations.remove(cfi, "highlight");
  }

  async goToChapter(chapterId: string, targetHref?: string): Promise<void> {
    this.manualNavigation();
    const chapter = this.chapterById(chapterId);
    if (!chapter || chapter.spineIndex === undefined || !this.rendition) return;
    await this.enqueueNavigation(async () => {
      this.flushVocabulary(); this.clearSelection();
      await this.rendition?.display(targetHref ?? chapter.href ?? this.book.spine.get(chapter.spineIndex).href);
    });
  }

  async goToAnnotation(annotation: AnnotationRecord): Promise<void> {
    this.manualNavigation();
    if (!annotation.cfi || !this.rendition) throw new Error("这条批注没有可用的原文位置");
    await this.enqueueNavigation(async () => {
      this.flushVocabulary(); this.clearSelection();
      await this.rendition?.display(annotation.cfi!);
    });
  }

  async next(): Promise<void> {
    this.manualNavigation();
    await this.enqueueNavigation(async () => {
      this.flushVocabulary(); this.clearSelection();
      if (this.mode === "scrolled") this.scrollBy(0.85);
      else await this.rendition?.next();
    });
  }
  async prev(): Promise<void> {
    this.manualNavigation();
    await this.enqueueNavigation(async () => {
      this.flushVocabulary(); this.clearSelection();
      if (this.mode === "scrolled") this.scrollBy(-0.85);
      else await this.rendition?.prev();
    });
  }
  private scrollBy(fraction: number): void {
    const scroller = this.container?.querySelector<HTMLElement>(".epub-container");
    scroller?.scrollBy({ top: scroller.clientHeight * fraction, behavior: "auto" });
  }
  private manualNavigation(): void {
    this.resizePoint = null;
    this.hooks.onManualNavigation?.();
  }
  private enqueueNavigation(action: () => Promise<void>): Promise<void> {
    const next = this.navigation.then(async () => { if (!this.destroyed) await action(); });
    this.navigation = next.catch(() => undefined);
    return next;
  }
  getMode(): ReadMode { return this.mode; }

  async setMode(mode: ReadMode): Promise<void> {
    if (mode === this.mode || !this.rendition || !this.container) return;
    await this.enqueueNavigation(async () => {
      this.clearSelection();
      this.resizePoint = null;
      this.mode = mode;
      await this.rebuildRendition();
    });
  }

  private async rebuildRendition(): Promise<void> {
    for (const layer of this.wordLayers.values()) layer.destroy();
    this.wordLayers.clear();
    const cfi = this.position.cfi ?? this.rendition?.location?.start?.cfi;
    const point = { ...this.position, cfi };
    this.suspended = false;
    this.restoring = true;
    this.generation++;
    this.rendition?.destroy();
    this.rendition = null;
    const host = this.container?.querySelector<HTMLElement>(".qr-epub-host");
    if (!host) throw new Error("EPUB 阅读容器已移除");
    host.replaceChildren();
    await this.buildRendition(host, point);
  }

  async applyLayout(layout: ReadingLayout, theme: ReadingColors): Promise<void> {
    this.clearSelection();
    // 隐藏再显示后浏览器可能已把 scrollLeft 归零；已记录的 CFI 才是恢复依据。
    const cfi = this.position.cfi ?? this.rendition?.location?.start?.cfi;
    this.layout = layout;
    this.theme = theme;
    if (this.container && (!this.container.clientWidth || !this.container.clientHeight)) {
      this.suspended = true;
      return;
    }
    // 隐藏时 EPUB.js 会把 iframe 暂时缩成一页；恢复后重建，不能在未重排的 DOM 上定位。
    if (this.suspended || this.reflowable && this.rendition && layout.pageMargin !== this.renderedMargin) {
      await this.rebuildRendition();
      return;
    }
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
  async speechText(unit?: number, from?: SpeechSegment): Promise<SpeechBatch> {
    if (this.destroyed || this.format === "cbz") return { segments: [], next: null };
    if (unit === undefined && from && !from.cfi) throw new Error("选文无法定位，请重新选择文字。");
    const selected = unit === undefined && from?.cfi ? new EpubCFI(from.cfi) : null;
    selected?.collapse(true);
    const fallback = this.position.cfi ?? this.rendition?.location?.start?.cfi;
    const cfi = selected?.toString() ?? (unit === undefined && fallback ? this.visibleCfi(fallback) : undefined);
    const index = unit ?? (cfi ? new EpubCFI(cfi).spinePos : 0);
    const section = this.book.spine.get(index);
    if (!section) return { segments: [], next: null };
    // EPUB.js's declaration says Document; its actual load result is documentElement.
    await section.load(this.book.load.bind(this.book));
    const doc = section.document;
    let next: number | null = null;
    this.book.spine.each((candidate: Section) => {
      if (next === null && candidate.index > index && candidate.linear !== false) next = candidate.index;
    });
    return { segments: epubSpeechSegments(doc, section.cfiBase, cfi), next };
  }
  async followSpeech(segment: SpeechSegment): Promise<void> {
    const rendition = this.rendition;
    if (!segment.cfi || !rendition || this.destroyed) return;
    const start = new EpubCFI(segment.cfi); start.collapse(true);
    if (!this.speechFollowing && (!this.speechPageEnd || this.cfiComparator.compare(start, this.speechPageEnd) > 0)) {
      this.speechFollowing = true;
    }
    this.speechSegment = segment;
    const generation = ++this.speechGeneration;
    this.removeSpeechMark?.(); this.removeSpeechMark = null;
    if (!this.speechFollowing) { this.paintSpeech(); return; }
    await this.enqueueNavigation(async () => {
      if (generation !== this.speechGeneration || !this.speechFollowing || this.destroyed || rendition !== this.rendition) return;
      const cfi = new EpubCFI(segment.cfi);
      const contents = (rendition.getContents() ?? []) as unknown as ContentsLike[];
      const current = contents.find((content) => content.sectionIndex === cfi.spinePos);
      let visible = false;
      if (current && this.container) {
        const range = cfi.toRange(current.document);
        const rect = range.getClientRects()[0];
        const frame = current.window.frameElement?.getBoundingClientRect();
        const viewport = this.container.getBoundingClientRect();
        visible = !!rect && !!frame && rect.left + frame.left >= viewport.left - 2 && rect.top + frame.top >= viewport.top - 2
          && rect.left + frame.left < viewport.right - 2 && rect.top + frame.top < viewport.bottom - 2;
      }
      if (!visible) {
        // An explicit start wins over the viewport snapshot taken when the player opened.
        this.resizePoint = { cfi: start.toString(), offset: 0 };
        await rendition.display(start.toString());
      }
      if (generation !== this.speechGeneration || this.destroyed || rendition !== this.rendition) return;
      this.paintSpeech();
    });
  }
  setSpeechFollowing(enabled: boolean): void {
    this.speechFollowing = enabled;
    if (!enabled) ++this.speechGeneration;
  }
  private paintSpeech(): void {
    if (!this.speechSegment?.cfi || !this.rendition || this.destroyed) return;
    const cfi = new EpubCFI(this.speechSegment.cfi);
    const shown = ((this.rendition.getContents() ?? []) as unknown as ContentsLike[]).find((content) => content.sectionIndex === cfi.spinePos);
    if (!shown) return;
    this.removeSpeechMark?.(); this.removeSpeechMark = null;
    const range = cfi.toRange(shown.document);
    this.removeSpeechMark = speechHighlight(shown.document, [range]);
    const rect = range.getClientRects()[0];
    const frame = shown.window.frameElement?.getBoundingClientRect();
    const viewport = this.container?.getBoundingClientRect();
    if (this.speechFollowing && rect && frame && viewport && rect.left + frame.left >= viewport.left - 2 &&
        rect.left + frame.left < viewport.right - 2 && rect.top + frame.top >= viewport.top - 2 && rect.top + frame.top < viewport.bottom - 2) {
      const end = this.rendition.location?.end?.cfi;
      // Keep the spoken page boundary frozen while the reader browses elsewhere.
      if (end) this.speechPageEnd = this.visibleCfi(end, true);
    }
  }
  clearSpeech(): void {
    this.speechSegment = null;
    this.speechPageEnd = null;
    ++this.speechGeneration; this.removeSpeechMark?.(); this.removeSpeechMark = null;
  }
  clearSelection(): void {
    this.guardSelectionScroll();
    this.selectionScroll = null;
    // EPUB.js returns an array; its Rendition declaration incorrectly says Contents.
    const contents = (this.rendition?.getContents() ?? []) as unknown as ContentsLike[];
    for (const content of contents) content.window.getSelection()?.removeAllRanges();
  }

  prepareResize(): void {
    const fallback = this.position.cfi ?? this.rendition?.location?.start?.cfi;
    if (!fallback || this.destroyed || this.restoring) return;
    const cfi = this.visibleCfi(fallback);
    this.resizePoint = { cfi, offset: this.cfiOffset(cfi) };
    if (this.rendition?.location?.start) this.rendition.location.start.cfi = cfi;
  }
  private cfiOffset(cfi: string): number | null {
    if (!this.container || !this.rendition) return null;
    const parsed = new EpubCFI(cfi);
    const contents = (this.rendition.getContents() ?? []) as unknown as ContentsLike[];
    const content = contents.find((c) => c.sectionIndex === parsed.spinePos);
    const frame = content?.window.frameElement?.getBoundingClientRect();
    if (!content || !frame) return null;
    // Image pages and unloaded/converted sections may have no DOM range for this CFI.
    let range: Range | null;
    try { range = parsed.toRange(content.document); } catch { return null; }
    const rect = range?.getClientRects()[0];
    return rect ? rect.top + frame.top - this.container.getBoundingClientRect().top : null;
  }
  private restoreResizePoint(): void {
    const point = this.resizePoint;
    if (!point) return;
    const offset = this.cfiOffset(point.cfi);
    if (offset === null) return;
    this.resizePoint = null;
    if (this.mode === "scrolled" && point.offset !== null) {
      const scroller = this.container?.querySelector<HTMLElement>(".epub-container");
      scroller?.scrollBy({ top: offset - point.offset, behavior: "auto" });
    }
  }
  resize(): void {
    const container = this.container;
    if (!container || this.destroyed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) {
      this.suspended = true;
      return;
    }
    if (this.restoring) return;
    if (this.suspended) {
      void this.rebuildRendition().catch((error: unknown) => this.reportError(error));
      return;
    }
    this.clearSelection();
    if (!this.resizePoint) this.prepareResize();
    const rendition = this.rendition as (Rendition & { resize(width: number, height: number, cfi?: string): void }) | null;
    rendition?.resize(width, height, this.resizePoint?.cfi);
  }
  private reportError(error: unknown): void { this.hooks.onError?.(error instanceof Error ? error : new Error(String(error))); }
  destroy(): void {
    if (this.destroyed) return;
    this.clearSpeech();
    this.destroyed = true;
    for (const layer of this.wordLayers.values()) layer.destroy();
    this.wordLayers.clear();
    this.generation++;
    window.clearTimeout(this.resizeTimer);
    this.selectionScroller?.removeEventListener("scroll", this.guardSelectionScroll);
    this.selectionScroller = null;
    this.ro?.disconnect();
    this.contentHook?.deregister(this.sanitize);
    this.contentHook = null;
    this.container?.removeEventListener("keydown", this.keyboard);
    this.rendition?.destroy();
    this.rendition = null;
    this.container?.replaceChildren();
  }
  setVocabulary(words: readonly VocabularyWord[], highlight: boolean, threshold: number): void {
    this.vocabulary = words; this.vocabularyHighlight = highlight;
    this.vocabularyThreshold = threshold;
    for (const layer of this.wordLayers.values()) layer.set(words, highlight, threshold);
  }
  noteVocabularyLookup(word: string, paragraphId?: string): void { for (const layer of this.wordLayers.values()) layer.noteLookup(word, paragraphId); }
  flushVocabulary(): void { for (const layer of this.wordLayers.values()) layer.flush(); }
}
