// PDF canvas and PDF.js TextLayer share a viewport. Scrolled mode creates cheap
// estimated placeholders; only nearby pages acquire proxies, canvases and text.
import { pdfjsLib } from "./pdfjs-setup";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { AnnotationRecord, ChapterState, PdfItemRange, ReadMode, ReadingLayout, ReadingColors } from "../types";
import { pdfChapterId } from "../types";
import type { EngineHooks, EngineLocation, EngineSelection, ReaderEngine, SpeechBatch, SpeechSegment, SearchResult } from "./engine";
import { searchPdf } from "./search";
import { pdfSpeechSegments } from "./speech-text";
import { speechHighlight } from "./speech-highlight";
import { HIGHLIGHT_COLORS } from "../settings";
import { WordLayer } from "./word-layer";
import { animatePageOffset } from "./page-motion";
import { bindPageDrag, type PageDrag } from "./page-gesture";
import type { VocabularyWord } from "../core/vocabulary";

interface PageDims { width: number; height: number; }
interface RenderState {
  wrapper: HTMLElement;
  generation: number;
  promise: Promise<void>;
  cancelled: boolean;
  task?: RenderTask;
  textLayer?: InstanceType<typeof pdfjsLib.TextLayer>;
  page?: PDFPageProxy;
}

export class PdfEngine implements ReaderEngine {
  readonly format = "pdf" as const;
  readonly reflowable = false;
  private container: HTMLElement | null = null;
  private wordLayers = new Map<number, WordLayer>();
  private vocabulary: readonly VocabularyWord[] = [];
  private vocabularyHighlight = true;
  private vocabularyThreshold = 5;
  private scroller: HTMLElement | null = null;
  private wrappers = new Map<number, HTMLElement>();
  private renders = new Map<number, RenderState>();
  private dims = new Map<number, PageDims>();
  private items = new Map<number, TextItem[]>();
  private marks = new Map<string, AnnotationRecord>();
  private observer: IntersectionObserver | null = null;
  private mode: ReadMode;
  private currentPage: number;
  private currentPageFraction: number;
  private destroyed = false;
  private pageTurnController: AbortController | null = null;
  private generation = 0;
  private rebuilding = false;
  private scrollTimer: number | undefined;
  private resizeTimer: number | undefined;
  private selectionTimer: number | undefined;
  private selectionSignature = "";
  private speechGeneration = 0;
  private speechSegment: SpeechSegment | null = null;
  private speechFollowing = true;
  private speechPageEnd: { page: number; item: number; end: number } | null = null;
  private navigation: Promise<void> = Promise.resolve();
  private pendingNavigation = 0;
  private pageDrag: PageDrag | null = null;
  private dragCleanup: (() => void) | null = null;
  private resizePoint: { page: number; fraction: number } | null = null;
  private removeSpeechMark: (() => void) | null = null;
  private removeSearchMark: (() => void) | null = null;
  private zoom = 1;
  private zoomMode: "width" | "page" | "custom" = "width";
  private ro: ResizeObserver | null = null;
  private touchStart: { x: number; y: number; time: number } | null = null;
  private swiped = false;
  private selectionListener = () => {
    window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => this.processSelection(), 180);
  };

  constructor(
    private doc: PDFDocumentProxy,
    private chapters: ChapterState[],
    start: { pdfPage?: number | null; fraction?: number | null },
    private hooks: EngineHooks,
    annotations: AnnotationRecord[],
    opts: { mode: ReadMode }
  ) {
    this.mode = opts.mode;
    this.currentPage = Math.max(1, Math.min(start.pdfPage ?? 1, doc.numPages));
    this.currentPageFraction = Math.max(0, Math.min(start.fraction ?? 0, 1));
    for (const annotation of annotations) this.marks.set(annotation.id, { ...annotation });
  }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    const scroller = document.createElement("div");
    scroller.className = "qr-pdf-scroll";
    scroller.tabIndex = 0;
    container.appendChild(scroller);
    this.scroller = scroller;
    scroller.addEventListener("scroll", () => {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = window.setTimeout(() => {
        if (this.rebuilding) return;
        this.reportLocation();
        if (this.mode === "scrolled") {
          for (let page = Math.max(1, this.currentPage - 1); page <= Math.min(this.doc.numPages, this.currentPage + 1); page++) {
            if (!this.renders.has(page)) this.renderBackground(page);
          }
        }
      }, 100);
    });
    scroller.addEventListener("click", (event) => this.handleClick(event));
    scroller.addEventListener("keydown", (event) => this.handleKey(event));
    scroller.addEventListener("wheel", () => this.manualNavigation(), { passive: true });
    scroller.addEventListener("mouseup", this.selectionListener);
    scroller.addEventListener("contextmenu", (event) => {
      if (!window.getSelection()?.isCollapsed) event.preventDefault();
    });
    scroller.addEventListener("touchstart", (event) => {
      // Pagination owns body swipes; do not also open Obsidian's sidebars.
      if (this.mode === "paginated") event.stopPropagation();
      const first = event.touches[0];
      this.touchStart = first && event.touches.length === 1 ? { x: first.clientX, y: first.clientY, time: Date.now() } : null;
      this.swiped = false;
    }, { passive: true });
    scroller.addEventListener("touchmove", (event) => {
      const first = event.touches[0];
      if (this.touchStart && first && Math.hypot(first.clientX - this.touchStart.x, first.clientY - this.touchStart.y) > 10) this.manualNavigation();
    }, { passive: true });
    scroller.addEventListener("touchend", this.selectionListener, { passive: true });
    scroller.style.touchAction = "pan-y pinch-zoom";
    this.dragCleanup = bindPageDrag(scroller, {
      enabled: () => this.mode === "paginated" && !this.destroyed && !this.rebuilding && !this.pendingNavigation
        && this.zoomMode !== "custom",
      width: () => scroller.clientWidth,
      selected: () => !!scroller.ownerDocument.getSelection() && !scroller.ownerDocument.getSelection()!.isCollapsed,
      claim: () => { this.swiped = true; },
      interrupt: () => this.pageDrag?.cancel(),
      start: drag => this.startPageDrag(drag),
    });
    document.addEventListener("selectionchange", this.selectionListener);
    await this.rebuild();
    if (this.destroyed) return;
    this.ro = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.resize(), 250);
    });
    this.ro.observe(container);
  }

  private availableWidth(dims?: PageDims): number {
    const width = Math.max(100, (this.container?.clientWidth ?? 600) - 32);
    if (this.zoomMode === "page" && dims) return Math.min(width, Math.max(100, (this.container?.clientHeight ?? 800) - 32) * dims.width / dims.height);
    return width * this.zoom;
  }

  private async pageDims(pageNumber: number): Promise<PageDims> {
    const known = this.dims.get(pageNumber);
    if (known) return known;
    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const dims = { width: viewport.width, height: viewport.height };
    this.dims.set(pageNumber, dims);
    return dims;
  }

  private makeWrapper(page: number, dims: PageDims): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "qr-pdf-page";
    wrapper.dataset.page = String(page);
    wrapper.style.position = "relative";
    const width = this.availableWidth(dims);
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${dims.height * width / dims.width}px`;
    this.wrappers.set(page, wrapper);
    return wrapper;
  }

  private async rebuild(): Promise<void> {
    const scroller = this.scroller;
    if (!scroller || this.destroyed) return;
    this.clearSearch();
    this.pageDrag?.cancel();
    this.pageTurnController?.abort();
    const page = this.currentPage;
    const fraction = this.currentPageFraction;
    const generation = ++this.generation;
    this.rebuilding = true;
    this.observer?.disconnect();
    this.observer = null;
    for (const number of Array.from(this.renders.keys())) this.dropPage(number);
    this.wrappers.clear();
    scroller.replaceChildren();
    scroller.style.paddingBottom = "";
    const estimate = await this.pageDims(page);
    if (this.destroyed || generation !== this.generation) return;
    if (this.mode === "paginated") {
      scroller.appendChild(this.makeWrapper(page, estimate));
    } else {
      const fragment = document.createDocumentFragment();
      for (let n = 1; n <= this.doc.numPages; n++) fragment.appendChild(this.makeWrapper(n, this.dims.get(n) ?? estimate));
      scroller.appendChild(fragment);
    }
    try {
      await this.renderPage(page);
      if (this.destroyed || generation !== this.generation) return;
      this.restoreScroll(page, fraction);
      if (this.mode === "scrolled") {
        this.observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) continue;
            const number = Number(entry.target.dataset.page);
            if (entry.isIntersecting) this.renderBackground(number);
            else this.dropPage(number);
          }
        }, { root: scroller, rootMargin: "500px 0px" });
        for (const wrapper of this.wrappers.values()) this.observer.observe(wrapper);
      }
      this.rebuilding = false;
      this.reportLocation();
    } finally {
      if (generation === this.generation) this.rebuilding = false;
    }
  }

  private restoreScroll(page: number, fraction: number): void {
    const wrapper = this.wrappers.get(page);
    if (!wrapper || !this.scroller) return;
    const rect = wrapper.getBoundingClientRect();
    const scroller = this.scroller;
    const viewportTop = scroller.getBoundingClientRect().top;
    const target = scroller.scrollTop + rect.top - viewportTop + fraction * rect.height;
    const last = scroller.lastElementChild;
    if (!last) return;
    // scrollHeight is at least clientHeight, hiding the unused space below a
    // short page. Use the actual content bottom to avoid clamping saved offsets.
    const contentBottom = scroller.scrollTop + last.getBoundingClientRect().bottom - viewportTop +
      (Number.parseFloat(getComputedStyle(last).marginBottom) || 0);
    scroller.style.paddingBottom = `${Math.max(0, Math.ceil(target + scroller.clientHeight - contentBottom))}px`;
    scroller.scrollTop = target;
  }

  private renderBackground(page: number): void {
    void this.renderPage(page).catch((error: unknown) => {
      if (!this.destroyed) this.hooks.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private renderPage(page: number): Promise<void> {
    const wrapper = this.wrappers.get(page);
    if (!wrapper || this.destroyed) return Promise.resolve();
    const current = this.renders.get(page);
    if (current && current.wrapper === wrapper && !current.cancelled) return current.promise;
    const state: RenderState = { wrapper, generation: this.generation, cancelled: false, promise: Promise.resolve() };
    this.renders.set(page, state);
    state.promise = this.drawPage(page, state);
    return state.promise;
  }

  private isCurrent(page: number, state: RenderState): boolean {
    return !this.destroyed && !state.cancelled && state.generation === this.generation && this.wrappers.get(page) === state.wrapper && this.renders.get(page) === state;
  }

  private async drawPage(number: number, state: RenderState): Promise<void> {
    const wrapper = state.wrapper;
    try {
      const page = await this.doc.getPage(number);
      if (!this.isCurrent(number, state)) return;
      state.page = page;
      const base = page.getViewport({ scale: 1 });
      this.dims.set(number, { width: base.width, height: base.height });
      const scale = this.availableWidth({ width: base.width, height: base.height }) / base.width;
      const viewport = page.getViewport({ scale });
      const anchor = this.readLocation();
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;
      if (!this.rebuilding && this.mode === "scrolled") this.restoreScroll(anchor.page, anchor.fraction);
      wrapper.replaceChildren();
      const canvas = document.createElement("canvas");
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      wrapper.appendChild(canvas);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建 PDF 页面画布");
      state.task = page.render({ canvas, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await state.task.promise;
      if (!this.isCurrent(number, state)) return;
      const content = await page.getTextContent();
      if (!this.isCurrent(number, state)) return;
      const items = content.items.filter((item): item is TextItem => "str" in item);
      this.items.set(number, items);
      const layer = document.createElement("div");
      layer.className = "qr-pdf-text textLayer";
      layer.style.setProperty("--total-scale-factor", String(scale * viewport.userUnit));
      layer.style.setProperty("--scale-factor", String(scale));
      layer.style.setProperty("--scale-round-x", "1px");
      layer.style.setProperty("--scale-round-y", "1px");
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.lineHeight = "1";
      layer.style.letterSpacing = "normal";
      layer.style.wordSpacing = "normal";
      layer.style.transformOrigin = "0 0";
      layer.style.zIndex = "2";
      layer.style.overflow = "clip";
      layer.style.setProperty("text-size-adjust", "none");
      layer.style.setProperty("-webkit-text-size-adjust", "none");
      layer.style.setProperty("--text-scale-factor", "calc(var(--total-scale-factor) * var(--min-font-size))");
      layer.style.setProperty("--min-font-size-inv", "calc(1 / var(--min-font-size))");
      wrapper.appendChild(layer);
      state.textLayer = new pdfjsLib.TextLayer({ textContentSource: content, container: layer, viewport });
      // Explicit pixel dimensions and transforms also support browsers without
      // CSS round(), while retaining PDF.js's own glyph placement.
      layer.style.width = `${viewport.rotation % 180 === 0 ? viewport.width : viewport.height}px`;
      layer.style.height = `${viewport.rotation % 180 === 0 ? viewport.height : viewport.width}px`;
      if (viewport.rotation === 90) layer.style.transform = "rotate(90deg) translateY(-100%)";
      else if (viewport.rotation === 180) layer.style.transform = "rotate(180deg) translate(-100%, -100%)";
      else if (viewport.rotation === 270) layer.style.transform = "rotate(270deg) translateX(-100%)";
      await state.textLayer.render();
      if (!this.isCurrent(number, state)) return;
      let paragraph = 0;
      let previousY: number | undefined;
      state.textLayer.textDivs.forEach((span, index) => {
        const item = items[index];
        const y = item?.transform[5];
        if (y !== undefined && previousY !== undefined && Math.abs(y - previousY) > Math.max(1, item?.height ?? 12) * 1.8) paragraph++;
        if (y !== undefined) previousY = y;
        span.dataset.qrParagraph = `pdf:${number}:${paragraph}`;
        span.dataset.i = String(index);
        span.style.position = "absolute";
        span.style.color = "transparent";
        span.style.whiteSpace = "pre";
        span.style.transformOrigin = "0 0";
        span.style.fontSize = "calc(var(--text-scale-factor) * var(--font-height))";
        span.style.transform = "rotate(var(--rotate, 0deg)) scaleX(var(--scale-x, 1)) scale(var(--min-font-size-inv))";
        span.style.userSelect = "text";
        span.style.setProperty("-webkit-user-select", "text");
      });
      for (const br of layer.querySelectorAll("br")) { br.style.position = "absolute"; br.style.color = "transparent"; }
      wrapper.dataset.rendered = "true";
      if (this.speechSegment?.pdfPage === number) this.paintSpeech(false);
      if (this.scroller) {
        const words = new WordLayer(layer.ownerDocument, layer, this.scroller, `pdf:${number}`, this.hooks.onWordExposure, true);
        this.wordLayers.set(number, words);
        words.setPaused(!!this.pageDrag);
        words.set(this.vocabulary, this.vocabularyHighlight, this.vocabularyThreshold);
      }
      this.paintHighlights(number);
      // Retain at most eight fully rendered pages even with very small pages.
      if (this.mode === "scrolled" && this.renders.size > 8) {
        const excess = Array.from(this.renders.keys()).sort((a, b) => Math.abs(b - this.currentPage) - Math.abs(a - this.currentPage));
        while (this.renders.size > 8 && excess.length) {
          const farthest = excess.shift();
          if (farthest !== undefined && farthest !== number) this.dropPage(farthest);
        }
      }
    } catch (error) {
      if (!this.isCurrent(number, state)) return;
      this.renders.delete(number);
      delete wrapper.dataset.rendered;
      wrapper.replaceChildren();
      const message = document.createElement("div");
      message.className = "qr-pdf-render-error";
      message.textContent = `第 ${number} 页渲染失败：${error instanceof Error ? error.message : String(error)}`;
      wrapper.appendChild(message);
      throw error;
    }
  }

  private dropPage(number: number): void {
    this.wordLayers.get(number)?.destroy(); this.wordLayers.delete(number);
    const state = this.renders.get(number);
    if (state) {
      state.cancelled = true;
      state.task?.cancel();
      state.textLayer?.cancel();
      this.renders.delete(number);
      void state.promise.finally(() => state.page?.cleanup()).catch(() => undefined);
    }
    const wrapper = this.wrappers.get(number);
    if (wrapper) {
      for (const canvas of wrapper.querySelectorAll("canvas")) { canvas.width = 0; canvas.height = 0; }
      wrapper.replaceChildren();
      delete wrapper.dataset.rendered;
    }
    this.items.delete(number);
  }

  private processSelection(): void {
    if (this.destroyed) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) { this.selectionSignature = ""; return; }
    for (const [page, wrapper] of this.wrappers) {
      const spans = wrapper.querySelectorAll<HTMLElement>(".qr-pdf-text [data-i]");
      if (!spans.length) continue;
      const ranges: PdfItemRange[] = [];
      const parts: string[] = [];
      const pageRect = wrapper.getBoundingClientRect();
      for (const span of spans) {
        for (let r = 0; r < selection.rangeCount; r++) {
          const userRange = selection.getRangeAt(r);
          if (!userRange.intersectsNode(span)) continue;
          const range = document.createRange();
          range.selectNodeContents(span);
          if (span.contains(userRange.startContainer)) range.setStart(userRange.startContainer, userRange.startOffset);
          if (span.contains(userRange.endContainer)) range.setEnd(userRange.endContainer, userRange.endOffset);
          const text = range.toString();
          if (!text) continue;
          const prefix = document.createRange();
          prefix.selectNodeContents(span);
          prefix.setEnd(range.startContainer, range.startOffset);
          const start = prefix.toString().length;
          const item = Number(span.dataset.i);
          const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
            x: (rect.left - pageRect.left) / pageRect.width,
            y: (rect.top - pageRect.top) / pageRect.height,
            width: rect.width / pageRect.width,
            height: rect.height / pageRect.height,
          }));
          ranges.push({ item, start, end: start + text.length, rects });
          parts.push(text);
        }
      }
      if (!ranges.length) continue;
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      const signature = `${page}:${ranges.map((range) => `${range.item}:${range.start}:${range.end}`).join(";")}`;
      if (!text || signature === this.selectionSignature) return;
      this.selectionSignature = signature;
      const first = ranges[0].rects?.[0];
      const anchor = first ? {
        left: pageRect.left + first.x * pageRect.width,
        right: pageRect.left + (first.x + first.width) * pageRect.width,
        top: pageRect.top + first.y * pageRect.height,
        bottom: pageRect.top + (first.y + first.height) * pageRect.height,
      } : undefined;
      this.hooks.onSelect({ text, copyText: selection.toString(), paragraphId: this.wordLayers.get(page)?.paragraphId(selection.getRangeAt(0).startContainer), chapterId: this.chapterForPage(page) ?? undefined, pdfPage: page, itemRanges: ranges, sortKey: page * 1_000_000_000 + ranges[0].item * 10_000 + ranges[0].start, anchor });
      return;
    }
  }
  clearSelection(): void {
    const selection = window.getSelection();
    if (selection?.rangeCount && this.scroller?.contains(selection.getRangeAt(0).commonAncestorContainer)) selection.removeAllRanges();
    this.selectionSignature = "";
  }

  async speechText(unit?: number, from?: SpeechSegment): Promise<SpeechBatch> {
    if (this.destroyed) return { segments: [], next: null };
    const selected = unit === undefined ? from : undefined;
    const pageNumber = unit ?? selected?.pdfPage ?? this.readLocation().page;
    const start = selected?.itemRanges?.slice().sort((a, b) => a.item - b.item || a.start - b.start)[0];
    if (selected && (!selected.pdfPage || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.doc.numPages || !start)) {
      throw new Error("选文无法定位，请重新选择文字。");
    }
    const page = await this.doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is TextItem => "str" in item);
    if (start && (!Number.isInteger(start.item) || !Number.isInteger(start.start) || start.start < 0 ||
      !items[start.item] || start.start >= items[start.item].str.length)) throw new Error("选文无法定位，请重新选择文字。");
    let first = 0;
    if (unit === undefined && !selected && this.scroller) {
      const viewport = this.scroller.getBoundingClientRect();
      const spans = this.wrappers.get(pageNumber)?.querySelectorAll<HTMLElement>(".qr-pdf-text [data-i]");
      const visible = Array.from(spans ?? []).find((span) => {
        const r = span.getBoundingClientRect(); return r.bottom > viewport.top && r.top < viewport.bottom && span.textContent?.trim();
      });
      first = Number(visible?.dataset.i ?? 0);
    }
    const segments = pdfSpeechSegments(items, pageNumber, first, start);
    return { segments, next: pageNumber < this.doc.numPages ? pageNumber + 1 : null };
  }
  async followSpeech(segment: SpeechSegment): Promise<void> {
    const page = segment.pdfPage;
    if (!page || this.destroyed) return;
    const end = this.speechPageEnd;
    const start = segment.itemRanges?.[0];
    if (!this.speechFollowing && (!end || page !== end.page || !start || start.item > end.item || start.item === end.item && start.start >= end.end)) {
      this.speechFollowing = true;
    }
    this.speechSegment = segment;
    const generation = ++this.speechGeneration;
    this.removeSpeechMark?.(); this.removeSpeechMark = null;
    if (!this.speechFollowing) { this.paintSpeech(false); return; }
    await this.enqueueNavigation(async () => {
      if (generation !== this.speechGeneration || !this.speechFollowing || this.destroyed) return;
      if (this.currentPage !== page || !this.wrappers.get(page)?.dataset.rendered) await this.setPage(page);
      if (generation !== this.speechGeneration || this.destroyed) return;
      this.paintSpeech(true);
      // Selected playback may move to another page before the player resize runs.
      if (this.resizePoint) this.resizePoint = this.readLocation();
    });
  }
  setSpeechFollowing(enabled: boolean): void {
    this.speechFollowing = enabled;
    if (!enabled) ++this.speechGeneration;
  }
  private paintSpeech(scroll: boolean): void {
    const segment = this.speechSegment;
    if (!segment?.pdfPage || this.destroyed) return;
    this.removeSpeechMark?.(); this.removeSpeechMark = null;
    const wrapper = this.wrappers.get(segment.pdfPage);
    const ranges: Range[] = [];
    for (const item of segment.itemRanges ?? []) {
      const span = wrapper?.querySelector<HTMLElement>(`.qr-pdf-text [data-i='${item.item}']`);
      const text = span?.firstChild;
      if (!text || text.nodeType !== 3) continue;
      const range = text.ownerDocument!.createRange();
      range.setStart(text, Math.min(item.start, text.textContent!.length));
      range.setEnd(text, Math.min(item.end, text.textContent!.length));
      ranges.push(range);
    }
    if (scroll && ranges[0] && this.scroller) {
      const r = ranges[0].getBoundingClientRect(); const viewport = this.scroller.getBoundingClientRect();
      if (r.top < viewport.top || r.bottom > viewport.bottom) this.scroller.scrollTop += r.top - viewport.top - 24;
    }
    if (ranges.length && wrapper) this.removeSpeechMark = speechHighlight(wrapper.ownerDocument, ranges);
    if (this.speechFollowing && ranges[0] && wrapper && this.scroller) {
      const viewport = this.scroller.getBoundingClientRect();
      const rect = ranges[0].getBoundingClientRect();
      if (rect.top >= viewport.top - 2 && rect.top < viewport.bottom - 2) {
        const spans = Array.from(wrapper.querySelectorAll<HTMLElement>(".qr-pdf-text [data-i]"));
        const last = spans.reverse().find((span) => {
          const r = span.getBoundingClientRect();
          return span.textContent?.trim() && r.bottom > viewport.top && r.top < viewport.bottom - 2;
        });
        if (last) this.speechPageEnd = { page: segment.pdfPage, item: Number(last.dataset.i), end: last.textContent?.length ?? 0 };
      }
    }
  }
  clearSpeech(): void {
    this.speechSegment = null;
    this.speechPageEnd = null;
    ++this.speechGeneration; this.removeSpeechMark?.(); this.removeSpeechMark = null;
  }


  private paintHighlights(page: number): void {
    const wrapper = this.wrappers.get(page);
    if (!wrapper || !wrapper.dataset.rendered) return;
    wrapper.querySelector(".qr-pdf-hl-layer")?.remove();
    const layer = document.createElement("div");
    layer.className = "qr-pdf-hl-layer";
    layer.style.pointerEvents = "none";
    wrapper.appendChild(layer);
    const wrapperRect = wrapper.getBoundingClientRect();
    for (const annotation of this.marks.values()) {
      if (annotation.pdfPage !== page) continue;
      const color = HIGHLIGHT_COLORS[annotation.color ?? "yellow"];
      for (const item of annotation.itemRanges ?? []) {
        const span = wrapper.querySelector<HTMLElement>(`.qr-pdf-text [data-i="${item.item}"]`);
        let rectangles = item.rects ?? [];
        if (span?.firstChild) {
          const range = document.createRange();
          const length = span.firstChild.textContent?.length ?? 0;
          range.setStart(span.firstChild, Math.min(item.start, length));
          range.setEnd(span.firstChild, Math.min(item.end, length));
          rectangles = Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => ({ x: (rect.left - wrapperRect.left) / wrapperRect.width, y: (rect.top - wrapperRect.top) / wrapperRect.height, width: rect.width / wrapperRect.width, height: rect.height / wrapperRect.height }));
        }
        for (const rect of rectangles) {
          const highlight = document.createElement("div");
          highlight.className = "qr-pdf-hl";
          highlight.dataset.ann = annotation.id;
          highlight.style.background = `${color.fill}47`;
          highlight.style.mixBlendMode = "normal";
          highlight.style.left = `${rect.x * 100}%`;
          highlight.style.top = `${rect.y * 100}%`;
          highlight.style.width = `${rect.width * 100}%`;
          highlight.style.height = `${rect.height * 100}%`;
          layer.appendChild(highlight);
        }
      }
    }
  }

  addHighlight(annotation: AnnotationRecord): void { this.marks.set(annotation.id, { ...annotation }); if (annotation.pdfPage) this.paintHighlights(annotation.pdfPage); }
  removeHighlight(annotation: AnnotationRecord): void { this.marks.delete(annotation.id); if (annotation.pdfPage) this.paintHighlights(annotation.pdfPage); }
  updateChapters(chapters: ChapterState[]): void { this.chapters = chapters; this.reportLocation(); }

  private chapterForPage(page: number): string | null {
    let chapter: ChapterState | undefined;
    for (const candidate of this.chapters) {
      if (candidate.pdfStartPage && candidate.pdfStartPage <= page && (!chapter || candidate.pdfStartPage > (chapter.pdfStartPage ?? 0))) chapter = candidate;
    }
    return chapter?.pdfStartPage ? pdfChapterId(chapter.pdfStartPage) : null;
  }

  private readLocation(): { page: number; fraction: number } {
    const scroller = this.scroller;
    if (!scroller) return { page: this.currentPage, fraction: this.currentPageFraction };
    const top = scroller.getBoundingClientRect().top;
    let page = this.currentPage;
    if (this.mode === "scrolled") {
      // Choose the page containing the leading viewport edge, not the nearest
      // page top (which advances a page while the current page is still visible).
      let low = 1;
      let high = this.doc.numPages;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const wrapper = this.wrappers.get(middle);
        if (!wrapper) break;
        if (wrapper.getBoundingClientRect().top <= top + 1) { page = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (high === 0) page = 1;
    }
    const rect = this.wrappers.get(page)?.getBoundingClientRect();
    const fraction = rect ? Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))) : this.currentPageFraction;
    return { page, fraction };
  }

  private reportLocation(): void {
    if (this.destroyed || this.rebuilding || !this.scroller) return;
    const location = this.readLocation();
    this.currentPage = location.page;
    this.currentPageFraction = location.fraction;
    const output: EngineLocation = { chapterId: this.chapterForPage(location.page), percent: Math.min(1, (location.page - 1 + location.fraction) / this.doc.numPages), pdfPage: location.page, pageFraction: location.fraction };
    this.hooks.onLocation(output);
  }

  private handleClick(event: MouseEvent): void {
    if (this.swiped) { this.swiped = false; return; }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    for (const wrapper of this.wrappers.values()) {
      for (const highlight of wrapper.querySelectorAll<HTMLElement>(".qr-pdf-hl")) {
        const rect = highlight.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom && highlight.dataset.ann) {
          this.hooks.onAnnotationClick(highlight.dataset.ann, rect);
          return;
        }
      }
    }
    const rect = this.scroller?.getBoundingClientRect();
    if (!rect) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x > 1 / 3 && x < 2 / 3 && y > 0.25 && y < 0.75) this.hooks.onZoneTap();
    else this.hooks.onSurfaceClick();
  }

  private handleKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); this.hooks.onSearch?.(); return; }
    if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      void this.setZoom(event.key === "0" ? "width" : this.zoom + (event.key === "-" ? -0.25 : 0.25)); return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) this.manualNavigation();
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.hooks.onZoneTap(); return; }
    if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); this.navigate(true); }
    else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); this.navigate(false); }
  }
  private navigate(forward: boolean): void { void (forward ? this.next() : this.prev()).catch((error: unknown) => this.hooks.onError?.(error instanceof Error ? error : new Error(String(error)))); }
  private async setPage(page: number, fraction = 0): Promise<void> {
    this.flushVocabulary();
    this.currentPage = Math.max(1, Math.min(page, this.doc.numPages));
    this.currentPageFraction = fraction;
    if (this.mode === "paginated") await this.rebuild();
    else {
      await this.renderPage(this.currentPage);
      this.restoreScroll(this.currentPage, fraction);
      this.reportLocation();
    }
  }

  private async turnPage(page: number, direction: 1 | -1, drag?: PageDrag): Promise<void> {
    const scroller = this.scroller;
    const oldPage = this.currentPage;
    const old = this.wrappers.get(oldPage);
    if (!scroller || !old || this.destroyed || drag?.cancelled) return;
    const generation = this.generation;
    const controller = this.pageTurnController = new AbortController();
    const width = scroller.clientWidth;
    this.rebuilding = true;
    let incoming: HTMLElement | null = null;
    let completed = false;
    try {
      const dims = await this.pageDims(page);
      if (controller.signal.aborted || generation !== this.generation) return;
      incoming = this.makeWrapper(page, dims);
      // Render offscreen while the existing canvas/text/highlights stay visible.
      incoming.style.position = "absolute";
      incoming.style.left = "16px";
      incoming.style.top = `${scroller.scrollTop}px`;
      incoming.style.transform = `translate3d(${direction * width}px,0,0)`;
      scroller.classList.add("qr-pdf-turning");
      scroller.appendChild(incoming);
      await this.renderPage(page);
      if (controller.signal.aborted || generation !== this.generation) return;
      const paint = (offset: number) => {
        old.style.transform = `translate3d(${offset}px,0,0)`;
        incoming!.style.transform = `translate3d(${direction * width + offset}px,0,0)`;
      };
      if (drag) {
        const unsubscribe = drag.subscribe(distance => paint(-direction * distance));
        const commit = await drag.completion;
        unsubscribe();
        if (!commit || controller.signal.aborted || generation !== this.generation) return;
        this.flushVocabulary();
      }
      completed = await animatePageOffset(scroller.ownerDocument.defaultView!, drag ? -direction * drag.distance : 0,
        -direction * width, paint, controller.signal, drag ? 0 : undefined);
      if (!completed || generation !== this.generation) return;
      this.dropPage(oldPage);
      this.wrappers.delete(oldPage);
      old.remove();
      incoming.style.position = "relative";
      incoming.style.left = incoming.style.top = incoming.style.transform = "";
      this.currentPage = page;
      this.currentPageFraction = 0;
      this.restoreScroll(page, 0);
      this.wordLayers.get(page)?.refresh();
    } finally {
      if (this.pageTurnController === controller) {
        this.pageTurnController = null;
        scroller.classList.remove("qr-pdf-turning");
        if (!completed && incoming && generation === this.generation) {
          this.dropPage(page); this.wrappers.delete(page); incoming.remove();
          old.style.transform = "";
        }
        if (!this.destroyed && generation === this.generation) {
          this.rebuilding = false;
          this.reportLocation();
          if (scroller.clientWidth !== width) this.resize();
        }
      }
    }
  }
  async goToChapter(chapterId: string): Promise<void> {
    this.manualNavigation();
    const chapter = this.chapters.find((item) => item.pdfStartPage && pdfChapterId(item.pdfStartPage) === chapterId);
    if (chapter?.pdfStartPage) await this.enqueueNavigation(() => this.setPage(chapter.pdfStartPage!));
  }
  async goToAnnotation(annotation: AnnotationRecord): Promise<void> {
    this.manualNavigation();
    if (!annotation.pdfPage) throw new Error("这条批注没有可用的原文页码");
    const fraction = annotation.itemRanges?.[0]?.rects?.[0]?.y ?? 0;
    await this.enqueueNavigation(() => this.setPage(annotation.pdfPage!, Math.max(0, Math.min(1, fraction))));
  }
  async next(): Promise<void> {
    this.manualNavigation();
    await this.enqueueNavigation(async () => {
      this.flushVocabulary();
      this.clearSelection();
      if (this.mode === "paginated") { if (this.currentPage < this.doc.numPages) await this.turnPage(this.currentPage + 1, 1); }
      else this.scroller?.scrollBy({ top: this.scroller.clientHeight * 0.85, behavior: "auto" });
    });
  }
  async prev(): Promise<void> {
    this.manualNavigation();
    await this.enqueueNavigation(async () => {
      this.flushVocabulary();
      this.clearSelection();
      if (this.mode === "paginated") { if (this.currentPage > 1) await this.turnPage(this.currentPage - 1, -1); }
      else this.scroller?.scrollBy({ top: -this.scroller.clientHeight * 0.85, behavior: "auto" });
    });
  }
  private manualNavigation(): void {
    this.clearSearch();
    this.resizePoint = null;
    this.hooks.onManualNavigation?.();
  }
  private startPageDrag(drag: PageDrag): void {
    this.manualNavigation();
    this.pageDrag = drag;
    for (const layer of this.wordLayers.values()) layer.setPaused(true);
    void this.enqueueNavigation(async () => {
      const page = this.currentPage + drag.direction;
      if (page < 1 || page > this.doc.numPages) { drag.cancel(); return; }
      await this.turnPage(page, drag.direction, drag);
    }, drag).catch(error => this.hooks.onError?.(error instanceof Error ? error : new Error(String(error)))).finally(() => {
      drag.cancel();
      if (this.pageDrag === drag) this.pageDrag = null;
      for (const layer of this.wordLayers.values()) layer.setPaused(false);
    });
  }
  private enqueueNavigation(action: () => Promise<void>, drag?: PageDrag): Promise<void> {
    if (!drag) this.pageDrag?.cancel();
    ++this.pendingNavigation;
    const next = this.navigation.then(async () => { if (!this.destroyed) await action(); })
      .finally(() => { --this.pendingNavigation; });
    this.navigation = next.catch(() => undefined);
    return next;
  }
  getZoom(): { value: number; mode: "width" | "page" | "custom" } { return { value: this.zoom, mode: this.zoomMode }; }
  async setZoom(value: number | "width" | "page"): Promise<void> {
    await this.enqueueNavigation(async () => {
      const point = this.captureLocation();
      this.zoom = typeof value === "number" && Number.isFinite(value) ? Math.max(0.5, Math.min(3, value)) : 1;
      this.zoomMode = typeof value === "number" ? "custom" : value;
      this.currentPage = point.pdfPage ?? 1; this.currentPageFraction = point.pageFraction ?? 0;
      if (this.scroller) this.scroller.style.touchAction = this.zoomMode === "custom" ? "pan-x pan-y pinch-zoom" : "pan-y pinch-zoom";
      await this.rebuild();
      if (this.scroller) this.scroller.scrollLeft = (point.horizontalFraction ?? 0) * (this.wrappers.get(this.currentPage)?.clientWidth ?? 1);
    });
  }
  captureLocation(): EngineLocation {
    const point = this.readLocation();
    return { chapterId: this.chapterForPage(point.page), percent: (point.page - 1 + point.fraction) / this.doc.numPages,
      pdfPage: point.page, pageFraction: point.fraction,
      horizontalFraction: (this.scroller?.scrollLeft ?? 0) / (this.wrappers.get(point.page)?.clientWidth ?? 1) };
  }
  async goToLocation(location: EngineLocation): Promise<void> {
    if (!location.pdfPage) return;
    this.manualNavigation();
    await this.enqueueNavigation(async () => {
      this.clearSelection(); this.clearSearch();
      await this.setPage(location.pdfPage!, location.pageFraction ?? 0);
      if (this.scroller) this.scroller.scrollLeft = (location.horizontalFraction ?? 0) * (this.wrappers.get(location.pdfPage!)?.clientWidth ?? 1);
    });
  }
  async search(query: string, signal: AbortSignal, receive: (batch: SearchResult[]) => void): Promise<void> {
    await searchPdf(this.doc, query, signal, receive, number => this.renders.has(number));
  }
  async showSearchResult(result: SearchResult): Promise<void> {
    await this.goToLocation(result.location);
    const wrapper = this.wrappers.get(result.location.pdfPage ?? 0), ranges: Range[] = [];
    for (const item of result.itemRanges ?? []) {
      const node = wrapper?.querySelector(`.qr-pdf-text [data-i='${item.item}']`)?.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const range = node.ownerDocument!.createRange(), length = node.textContent?.length ?? 0;
      range.setStart(node, Math.min(item.start, length)); range.setEnd(node, Math.min(item.end, length)); ranges.push(range);
    }
    if (ranges.length && this.scroller) {
      const rect = ranges[0].getBoundingClientRect(), view = this.scroller.getBoundingClientRect();
      this.scroller.scrollTop += rect.top - view.top - 24;
      if (rect.left < view.left || rect.right > view.right) this.scroller.scrollLeft += rect.left - view.left - 24;
      this.removeSearchMark = speechHighlight(wrapper!.ownerDocument, ranges, "qr-search"); this.reportLocation();
    }
  }
  clearSearch(): void { this.removeSearchMark?.(); this.removeSearchMark = null; }
  getMode(): ReadMode { return this.mode; }
  async setMode(mode: ReadMode): Promise<void> {
    if (mode === this.mode || this.destroyed) return;
    await this.enqueueNavigation(async () => {
      this.reportLocation();
      this.mode = mode;
      await this.rebuild();
    });
  }
  async applyLayout(_layout: ReadingLayout, theme: ReadingColors): Promise<void> {
    // PDF 保留原始文字和图表，只调整页面外的背景。
    if (this.scroller) this.scroller.style.background = theme.background;
  }
  async getSelectionContext(selection: EngineSelection): Promise<{ before: string; after: string }> {
    const ranges = selection.itemRanges;
    if (!selection.pdfPage || !ranges?.length) return { before: "", after: "" };
    let items = this.items.get(selection.pdfPage);
    if (!items) {
      const page = await this.doc.getPage(selection.pdfPage);
      const content = await page.getTextContent();
      items = content.items.filter((item): item is TextItem => "str" in item);
    }
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const before = items.slice(0, first.item).map((item) => item.str).join(" ") + " " + (items[first.item]?.str.slice(0, first.start) ?? "");
    const after = (items[last.item]?.str.slice(last.end) ?? "") + " " + items.slice(last.item + 1).map((item) => item.str).join(" ");
    return { before: before.slice(-300), after: after.slice(0, 300) };
  }
  prepareResize(): void {
    if (!this.rebuilding && !this.destroyed) this.resizePoint = this.readLocation();
  }
  resize(): void {
    if (!this.scroller || this.destroyed || this.rebuilding) return;
    void this.enqueueNavigation(async () => {
      const point = this.resizePoint ?? this.readLocation();
      this.resizePoint = null;
      this.currentPage = point.page;
      this.currentPageFraction = point.fraction;
      await this.rebuild();
    }).catch((error: unknown) => this.hooks.onError?.(error instanceof Error ? error : new Error(String(error))));
  }
  destroy(): void {
    this.clearSearch();
    this.clearSpeech();
    for (const layer of this.wordLayers.values()) layer.destroy(); this.wordLayers.clear();
    if (this.destroyed) return;
    this.destroyed = true;
    this.pageDrag?.cancel();
    this.dragCleanup?.(); this.dragCleanup = null;
    this.pageTurnController?.abort();
    this.generation++;
    this.observer?.disconnect();
    this.ro?.disconnect();
    window.clearTimeout(this.scrollTimer);
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.selectionTimer);
    document.removeEventListener("selectionchange", this.selectionListener);
    for (const page of Array.from(this.renders.keys())) this.dropPage(page);
    this.wrappers.clear();
    this.items.clear();
    this.container?.replaceChildren();
    this.scroller = null;
  }
  setVocabulary(words: readonly VocabularyWord[], highlight: boolean, threshold: number): void {
    this.vocabulary = words; this.vocabularyHighlight = highlight;
    this.vocabularyThreshold = threshold;
    for (const layer of this.wordLayers.values()) layer.set(words, highlight, threshold);
  }
  noteVocabularyLookup(word: string, paragraphId?: string): void { for (const layer of this.wordLayers.values()) layer.noteLookup(word, paragraphId); }
  flushVocabulary(): void { for (const layer of this.wordLayers.values()) layer.flush(); }
}
