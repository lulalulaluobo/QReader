// Reading page (PRD §7–§15): minimal chrome, 目录 drawer, 💡 三问 panel,
// ··· menu, annotation card, chapter navigation and 完成本章.

import { ItemView, Menu, Notice, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type {
  AnnotationRecord,
  HealthyBookEntry,
  ReadMode,
  ReadingTheme,
  TocNode,
} from "../types";
import { QUESTION_LABELS, chaptersOrdered, isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import type { EngineSelection, EngineLocation, EngineHooks, ReaderEngine, SelectionAnchor } from "../reader/engine";
import { EpubEngine } from "../reader/epub-engine";
import { PdfEngine } from "../reader/pdf-engine";
import { el, genId } from "../util";
import { explainSelection } from "../ai/tasks";

export const VIEW_TYPE_READER = "qreader-reader";

interface AnnotDraft {
  mode: "create" | "edit";
  chapterId: string;
  record?: AnnotationRecord;
  selection?: EngineSelection;
  note: string;
  aiText: string;
  aiIncluded: boolean;
  aiLoading: boolean;
}

interface MarkTarget {
  selection?: EngineSelection;
  record?: AnnotationRecord;
  anchor?: SelectionAnchor;
  confirmDelete?: boolean;
}

export class ReaderView extends ItemView {
  private entry: HealthyBookEntry | null = null;
  private engine: ReaderEngine | null = null;
  private mode: ReadMode = "paginated";
  private currentChapterId: string | null = null;
  private chromeHidden = true;
  private tocNodes: TocNode[] | null = null;
  private lastProgressSave = 0;
  private draft: AnnotDraft | null = null;
  private markTarget: MarkTarget | null = null;
  private unsub: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;
  private generation = 0;
  private progressTimer: number | null = null;
  private annotationSaving = false;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
    // Subscribe only while the view is open.
  }

  getViewType(): string {
    return VIEW_TYPE_READER;
  }
  getDisplayText(): string {
    return this.entry ? `QReader · ${this.entry.reading.book.title}` : "QReader 阅读";
  }
  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.buildSkeleton();
    this.applyThemeClass();
    this.unsub = this.plugin.onLibraryChanged(() => this.onLibraryDataChanged());
    this.unsubSettings = this.plugin.onSettingsChanged(() => this.applyThemeClass());
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) void this.persistProgress(true);
    });
    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      if (event.key === "Escape") {
        this.closePanels();
        this.engine?.clearSelection();
        this.draft = null;
        this.renderAnnotationCard();
      }
    });
  }

  async onClose(): Promise<void> {
    ++this.generation;
    this.unsub?.();
    this.unsubSettings?.();
    this.unsub = this.unsubSettings = null;
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    await this.persistProgress(true);
    this.engine?.destroy();
    this.engine = null;
    if (this.entry) await this.releaseSource(this.entry);
  }

  getState(): { bookId?: string } {
    return this.entry ? { bookId: this.entry.id } : {};
  }

  async setState(state: unknown): Promise<void> {
    if (typeof state !== "object" || state === null || !("bookId" in state)) return;
    if (typeof state.bookId === "string") {
      await this.plugin.library.scan();
      await this.openBook(state.bookId);
    }
  }

  private async releaseSource(entry: HealthyBookEntry): Promise<void> {
    const usedElsewhere = this.app.workspace.getLeavesOfType(VIEW_TYPE_READER).some((leaf) =>
      leaf.view instanceof ReaderView && leaf.view !== this && leaf.view.entry?.dir === entry.dir
    );
    if (!usedElsewhere) await this.plugin.cache.invalidate(entry.dir);
  }

  // ------------------------------------------------------------ skeleton

  private root!: HTMLElement;
  private header!: HTMLElement;
  private bottomBar!: HTMLElement;
  private contentHost!: HTMLElement;
  private readerTitleEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private progressBar!: HTMLProgressElement;
  private tocPanel!: HTMLElement;
  private tocBody!: HTMLElement;
  private questionsPanel!: HTMLElement;
  private questionsBody!: HTMLElement;
  private annotCard!: HTMLElement;
  private markMenu!: HTMLElement;

  private buildSkeleton(): void {
    this.contentEl.empty();
    this.contentEl.addClass("qr-view");
    const root = el("div", "qr-reader");
    root.toggleClass("qr-chrome-hidden", this.chromeHidden);
    this.contentEl.appendChild(root);
    this.root = root;

    const top = el("div", "qr-reader-top");
    const back = el("button", "qr-icon-btn");
    setIcon(back, "arrow-left");
    back.setAttribute("aria-label", "返回书架");
    back.onclick = () => this.plugin.openBookshelf();
    const title = el("div", "qr-reader-title");
    this.readerTitleEl = title;
    const actions = el("div", "qr-top-actions");
    const tocBtn = el("button", "qr-icon-btn");
    setIcon(tocBtn, "list");
    tocBtn.setAttribute("aria-label", "目录");
    tocBtn.title = "目录";
    tocBtn.onclick = () => this.toggleToc();
    const qBtn = el("button", "qr-icon-btn qr-bulb");
    setIcon(qBtn, "lightbulb");
    qBtn.setAttribute("aria-label", "本章三问");
    qBtn.title = "本章三问";
    qBtn.onclick = () => this.toggleQuestions();
    const moreBtn = el("button", "qr-icon-btn");
    setIcon(moreBtn, "more-horizontal");
    moreBtn.setAttribute("aria-label", "更多阅读操作");
    moreBtn.onclick = (e) => this.openMoreMenu(e);
    actions.append(tocBtn, qBtn, moreBtn);
    top.append(back, title, actions);

    const host = el("div", "qr-reader-content");
    this.contentHost = host;

    const bottom = el("div", "qr-reader-bottom");
    const prevCh = el("button", "qr-btn", "上一章");
    prevCh.onclick = () => void this.stepChapter(-1);
    const done = el("button", "qr-btn qr-btn-primary", "完成本章");
    done.onclick = () => void this.finishChapter();
    const nextCh = el("button", "qr-btn", "下一章");
    nextCh.onclick = () => void this.stepChapter(1);
    const prog = el("span", "qr-progress");
    this.progressEl = prog;
    this.progressBar = document.createElement("progress");
    this.progressBar.max = 1;
    this.progressBar.setAttribute("aria-label", "全书阅读进度");
    const meter = el("div", "qr-reader-meter");
    meter.append(this.progressBar, prog);
    bottom.append(prevCh, done, nextCh);

    const header = el("div", "qr-reader-header");
    header.append(top, meter);
    root.append(header, host, bottom);
    this.header = header;
    this.bottomBar = bottom;
    header.inert = bottom.inert = this.chromeHidden;

    // drawer + panels
    const mask = el("div", "qr-mask");
    mask.onclick = () => this.closePanels();
    const toc = el("div", "qr-drawer");
    const tocTitle = el("div", "qr-drawer-title", "目录");
    this.tocBody = el("div", "qr-drawer-body");
    toc.append(tocTitle, this.tocBody);
    this.tocPanel = toc;

    const qp = el("div", "qr-panel qr-questions-panel");
    const qpTitle = el("div", "qr-drawer-title", "本章三问");
    const qpClose = el("button", "qr-icon-btn");
    setIcon(qpClose, "x");
    qpClose.setAttribute("aria-label", "关闭本章三问");
    qpClose.onclick = () => this.closePanels();
    qpTitle.appendChild(qpClose);
    this.questionsBody = el("div", "qr-drawer-body");
    qp.append(qpTitle, this.questionsBody);
    this.questionsPanel = qp;

    const card = el("div", "qr-annot-card qr-hidden");
    this.annotCard = card;
    const markMenu = el("div", "qr-mark-menu qr-hidden");
    markMenu.setAttribute("role", "group");
    markMenu.setAttribute("aria-label", "选文操作");
    markMenu.onmousedown = (event) => event.preventDefault();
    this.markMenu = markMenu;

    root.append(mask, toc, qp, markMenu, card);
  }

  // ------------------------------------------------------------ open book

  async openBook(bookId: string): Promise<void> {
    const entry = this.plugin.library.get(bookId);
    if (!entry || !isHealthyBook(entry)) {
      new Notice("书籍不存在或记录已损坏");
      return;
    }
    if (this.entry?.id === entry.id && this.engine) {
      this.applyThemeClass();
      return;
    }
    await this.persistProgress(true);
    const previous = this.entry;
    const generation = ++this.generation;
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    this.engine?.destroy();
    this.engine = null;
    this.entry = null;
    if (previous) await this.releaseSource(previous);
    if (generation !== this.generation) return;
    this.entry = entry;
    this.lastLoc = null;
    this.lastProgressSave = 0;
    this.draft = null;
    this.markTarget = null;
    this.chromeHidden = true;
    this.mode = this.plugin.settings.reading.defaultMode;
    this.currentChapterId = entry.reading.progress.chapterId ?? null;
    this.tocNodes = null;
    this.buildSkeleton();
    this.applyThemeClass();
    this.renderTitle();
    this.renderProgress(entry.reading.progress.percent);
    this.contentHost.appendChild(el("div", "qr-empty qr-status", "正在打开书籍……"));

    try {
      const engine = await this.createEngine(entry);
      if (generation !== this.generation) {
        engine.destroy();
        return;
      }
      this.engine = engine;
      this.contentHost.empty();
      await engine.mount(this.contentHost);
    } catch (e) {
      if (generation !== this.generation) return;
      this.engine?.destroy();
      this.engine = null;
      this.contentHost.empty();
      this.contentHost.appendChild(el("div", "qr-empty", `打开失败：${e instanceof Error ? e.message : String(e)}`));
      const retry = el("button", "qr-btn", "重新打开");
      retry.onclick = () => void this.openBook(bookId);
      this.contentHost.appendChild(retry);
      new Notice(`打开书籍失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (generation !== this.generation) return;
    this.plugin.library
      .ensureQuestions(entry, this.currentChapterId ?? "")
      .then(() => this.renderQuestions())
      .catch(() => this.renderQuestions());
    this.renderQuestions();
    this.app.workspace.requestSaveLayout();
  }

  private async createEngine(entry: HealthyBookEntry): Promise<ReaderEngine> {
    const layout = {
      fontSize: this.plugin.settings.reading.fontSize,
      lineHeight: this.plugin.settings.reading.lineHeight,
    };
    const theme = this.resolvedTheme();
    const generation = this.generation;
    const hooks: EngineHooks = {
      onLocation: (loc) => { if (generation === this.generation) this.onEngineLocation(loc); },
      onSelect: (sel) => { if (generation === this.generation) this.openSelectionMenu(sel); },
      onAnnotationClick: (id, anchor) => { if (generation === this.generation) this.openMarkMenu(id, anchor); },
      onZoneTap: () => this.toggleChrome(),
      onSurfaceClick: () => this.closePanels(),
      onError: (error) => new Notice(`阅读失败：${error.message}`),
    };
    const chapters = chaptersOrdered(entry.reading);
    if (entry.reading.book.format === "epub") {
      const book = await this.plugin.cache.getEpub(entry);
      const progress = entry.reading.progress;
      return new EpubEngine(book, chapters, {
        cfi: progress.cfi ?? null,
        percent: progress.percent,
        chapterId: progress.chapterId,
      }, hooks, entry.reading.annotations, { mode: this.mode, layout, theme });
    }
    const doc = await this.plugin.cache.getPdf(entry);
    const progress = entry.reading.progress;
    return new PdfEngine(doc, chapters, {
      pdfPage: progress.pdfPage ?? 1,
      fraction: progress.pdfPageFraction ?? 0,
    }, hooks, entry.reading.annotations, { mode: this.mode });
  }

  // ------------------------------------------------------------ engine events

  private onEngineLocation(loc: EngineLocation): void {
    const entry = this.entry;
    if (!entry) return;
    if (this.markTarget && this.lastLoc && (loc.cfi !== this.lastLoc.cfi ||
        loc.pdfPage !== this.lastLoc.pdfPage || loc.pageFraction !== this.lastLoc.pageFraction)) this.closeMarkMenu();
    this.lastLoc = loc;
    const chapterChanged = loc.chapterId !== this.currentChapterId;
    this.currentChapterId = loc.chapterId;
    this.renderTitle();
    this.renderProgress(loc.percent);
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    this.progressTimer = window.setTimeout(() => void this.persistProgress(true), 500);
    if (chapterChanged && loc.chapterId) {
      this.plugin.library
        .ensureQuestions(entry, loc.chapterId)
        .then(() => this.renderQuestions())
        .catch(() => this.renderQuestions());
      if (!this.questionsPanel.hasClass("qr-open")) this.renderQuestions();
    }
  }

  private async persistProgress(force: boolean): Promise<void> {
    const entry = this.entry;
    const engine = this.engine;
    if (!entry || !engine) return;
    const now = Date.now();
    if (!force && now - this.lastProgressSave < 8000) return;
    this.lastProgressSave = now;
    const loc = this.lastLoc ?? {
      chapterId: this.currentChapterId,
      percent: entry.reading.progress.percent,
    };
    await this.plugin.library
      .saveProgress(entry, {
        chapterId: loc.chapterId,
        percent: loc.percent,
        cfi: loc.cfi ?? null,
        pdfPage: loc.pdfPage ?? null,
        pdfPageFraction: loc.pageFraction ?? null,
      })
      .catch((error: unknown) => new Notice(`进度保存失败：${error instanceof Error ? error.message : String(error)}`));
  }

  private lastLoc: EngineLocation | null = null;

  private renderTitle(): void {
    const entry = this.entry;
    if (!entry) return;
    const ch = this.currentChapterId ? entry.reading.chapters[this.currentChapterId] : undefined;
    const chTitle = ch?.title ?? (entry.reading.book.format === "pdf" ? "未分章" : "");
    this.readerTitleEl.empty();
    this.readerTitleEl.appendChild(el("div", "qr-reader-book-title", entry.reading.book.title));
    if (chTitle) this.readerTitleEl.appendChild(el("div", "qr-reader-chapter-title", chTitle));
  }

  private renderProgress(percent: number): void {
    this.progressEl.setText(`${Math.round(percent * 100)}%`);
    this.progressBar.value = Math.max(0, Math.min(1, percent));
  }

  // ------------------------------------------------------------ chrome

  private toggleChrome(): void {
    if (this.draft) return;
    if (this.markTarget) {
      this.closeMarkMenu();
      return;
    }
    if (this.tocPanel.hasClass("qr-open") || this.questionsPanel.hasClass("qr-open") ||
        this.root.querySelector(".qr-reader-settings, .qr-modal-form")) {
      this.closePanels();
      return;
    }
    this.chromeHidden = !this.chromeHidden;
    this.root.toggleClass("qr-chrome-hidden", this.chromeHidden);
    this.header.inert = this.bottomBar.inert = this.chromeHidden;
  }

  private resolvedTheme(): "light" | "dark" {
    const t: ReadingTheme = this.plugin.settings.reading.theme;
    if (t === "light") return "light";
    if (t === "dark") return "dark";
    return document.body.hasClass("theme-dark") ? "dark" : "light";
  }

  private applyThemeClass(): void {
    this.root.toggleClass("qr-theme-dark", this.resolvedTheme() === "dark");
    this.root.toggleClass("qr-theme-light", this.resolvedTheme() === "light");
    if (this.engine) {
      void this.engine.applyLayout(
        {
          fontSize: this.plugin.settings.reading.fontSize,
          lineHeight: this.plugin.settings.reading.lineHeight,
        },
        this.resolvedTheme()
      ).catch((error: unknown) => new Notice(`布局更新失败：${error instanceof Error ? error.message : String(error)}`));
    }
  }

  // ------------------------------------------------------------ toc drawer

  private toggleToc(): void {
    this.closePanels();
    this.tocPanel.addClass("qr-open");
    this.root.querySelector(".qr-mask")?.addClass("qr-show");
    void this.renderToc();
  }

  private async renderToc(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    this.tocBody.empty();
    if (this.tocNodes === null) {
      this.tocBody.appendChild(el("div", "qr-muted", "正在加载目录……"));
      try {
        this.tocNodes = await this.plugin.library.getToc(entry);
      } catch (e) {
        this.tocBody.empty();
        this.tocBody.appendChild(el("div", "qr-muted", `目录加载失败: ${e instanceof Error ? e.message : ""}`));
        return;
      }
    }
    this.tocBody.empty();
    if (entry.reading.book.format === "pdf") this.buildPdfChapterTools();
    const nodes = this.tocNodes ?? [];
    if (nodes.length === 0 && entry.reading.book.format === "epub") {
      this.tocBody.appendChild(el("div", "qr-muted", "本书没有可用目录"));
      return;
    }
    const renderNodes = (list: TocNode[], depth: number) => {
      for (const n of list) {
        const row = el(n.chapterId ? "button" : "div", "qr-toc-row");
        row.style.paddingLeft = `${12 + depth * 16}px`;
        row.setText(n.title);
        if (n.chapterId) {
          row.addClass("qr-toc-link");
          row.onclick = () => {
            void this.engine?.goToChapter(n.chapterId!, n.href)
              .catch((error: unknown) => new Notice(`跳转失败：${error instanceof Error ? error.message : String(error)}`));
            this.closePanels();
          };
          if (this.currentChapterId === n.chapterId) row.addClass("qr-toc-active");
        }
        this.tocBody.appendChild(row);
        if (n.children?.length) renderNodes(n.children, depth + 1);
      }
    };
    renderNodes(nodes, 0);
  }

  /** 新建章节 tools for PDFs without (or alongside) chapters (PRD §10). */
  private buildPdfChapterTools(): void {
    const entry = this.entry;
    if (!entry) return;
    const box = el("div", "qr-chapter-tools");
    const title = el("div", "qr-chapter-tools-title", "章节");
    box.appendChild(title);
    const createBtn = el("button", "qr-btn qr-btn-ghost", "新建章节");
    createBtn.onclick = () => this.openChapterForm(undefined);
    const hereBtn = el("button", "qr-btn qr-btn-ghost", "从当前页开始新章节");
    hereBtn.onclick = () => this.openChapterForm(this.currentPageGuess());
    box.append(createBtn, hereBtn);
    this.tocBody.appendChild(box);
  }

  private currentPageGuess(): number {
    return this.lastLoc?.pdfPage ?? this.entry?.reading.progress.pdfPage ?? 1;
  }

  private openChapterForm(startPage?: number): void {
    const entry = this.entry;
    if (!entry) return;
    const numPages = entry.reading.book.numPages ?? 1;
    const modal = el("div", "qr-modal-form");
    const title = el("div", "qr-drawer-title", "新建章节");
    const nameInput = el("input", "qr-input") as HTMLInputElement;
    nameInput.placeholder = "章节名称，如：第一章 创业";
    nameInput.setAttribute("aria-label", "章节名称");
    const startInput = el("input", "qr-input") as HTMLInputElement;
    startInput.type = "number";
    startInput.setAttribute("aria-label", "起始页");
    startInput.min = "1";
    startInput.max = String(numPages);
    startInput.value = String(startPage ?? Math.max(1, this.currentPageGuess()));
    const endInput = el("input", "qr-input") as HTMLInputElement;
    endInput.type = "number";
    endInput.setAttribute("aria-label", "结束页");
    endInput.min = "1";
    endInput.max = String(numPages);
    endInput.value = String(numPages);
    const row = el("div", "qr-form-row");
    row.append(startInput, endInput);
    const actions = el("div", "qr-form-actions");
    const cancel = el("button", "qr-btn", "取消");
    cancel.onclick = () => modal.remove();
    const ok = el("button", "qr-btn qr-btn-primary", "创建");
    ok.onclick = async () => {
      const name = nameInput.value.trim();
      const s = Number(startInput.value);
      const e2 = Number(endInput.value);
      if (!name) {
        new Notice("请填写章节名称");
        return;
      }
      if (!(Number.isInteger(s) && Number.isInteger(e2) && s >= 1 && e2 >= s && e2 <= numPages)) {
        new Notice(`页码范围无效（1–${numPages}）`);
        return;
      }
      ok.disabled = true;
      try {
        await this.plugin.library.createPdfChapter(entry, name, s, e2);
        this.engine?.updateChapters?.(chaptersOrdered(entry.reading));
        this.tocNodes = null;
        modal.remove();
        new Notice(`已创建章节：${name} (P${s}–P${e2})`);
        void this.renderToc();
      } catch (error) {
        new Notice(`创建失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        ok.disabled = false;
      }
    };
    actions.append(cancel, ok);
    const fields = el("div", "qr-form-fields");
    fields.append(nameInput, row);
    const panel = el("div", "qr-chapter-dialog");
    panel.append(title, fields, actions);
    modal.appendChild(panel);
    this.root.appendChild(modal);
    nameInput.focus();
  }

  // ------------------------------------------------------------ questions

  private toggleQuestions(): void {
    const panel = this.questionsPanel;
    this.closePanels();
    panel.addClass("qr-open");
    this.root.querySelector(".qr-mask")?.addClass("qr-show");
    this.renderQuestions();
  }

  private renderQuestions(): void {
    if (!this.questionsPanel.hasClass("qr-open")) return;
    const entry = this.entry;
    const body = this.questionsBody;
    body.empty();
    if (!entry) return;
    const ch = this.currentChapterId ? entry.reading.chapters[this.currentChapterId] : undefined;
    if (!ch) {
      body.appendChild(el("div", "qr-muted", "当前不在任何章节中"));
      return;
    }
    const versions = ch.questionVersions;
    if (versions.length === 0) {
      const running = this.plugin.library.isGenerating(entry.id, this.currentChapterId ?? "");
      if (running) {
        body.appendChild(el("div", "qr-muted qr-pulse", "正在生成本章问题……"));
      } else {
        const retry = el("button", "qr-btn qr-btn-primary", "重新生成");
        retry.onclick = () => void this.regenerate();
        body.append(el("div", "qr-muted", "本章问题尚未生成"), retry);
      }
      return;
    }
    const latest = versions[versions.length - 1];
    for (const q of latest.questions) {
      const item = el("div", "qr-question-item");
      item.appendChild(el("div", "qr-question-type", QUESTION_LABELS[q.type]));
      item.appendChild(el("div", "qr-question-text", q.text));
      body.appendChild(item);
    }
    if (versions.length > 1) {
      body.appendChild(el("div", "qr-muted", `第 ${latest.version} 版 · 共 ${versions.length} 个版本`));
    }
  }

  private async regenerate(): Promise<void> {
    const entry = this.entry;
    const chapterId = this.currentChapterId;
    if (!entry || !chapterId) return;
    this.questionsBody.empty();
    this.questionsBody.appendChild(el("div", "qr-muted qr-pulse", "正在生成本章问题……"));
    try {
      await this.plugin.library.regenerateQuestions(entry, chapterId);
      this.renderQuestions();
    } catch (e) {
      new Notice(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
      this.renderQuestions();
    }
  }

  // ------------------------------------------------------------ more menu

  private openMoreMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(this.mode === "paginated" ? "切换为上下滚动" : "切换为左右翻页")
        .setIcon(this.mode === "paginated" ? "align-start-vertical" : "book-open")
        .onClick(async () => {
          if (!this.engine) return;
          const mode = this.mode === "paginated" ? "scrolled" : "paginated";
          try {
            await this.engine.setMode(mode);
            this.mode = mode;
            await this.persistProgress(true);
          } catch (error) {
            new Notice(`模式切换失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })
    );
    menu.addItem((item) =>
      item.setTitle("重新生成三问").setIcon("refresh-cw").onClick(() => void this.regenerate())
    );
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("阅读设置").setIcon("sliders-horizontal").onClick(() => this.openReaderSettings()));
    menu.showAtMouseEvent(e);
  }

  private openReaderSettings(): void {
    this.closePanels();
    const s = this.plugin.settings.reading;
    const box = el("div", "qr-reader-settings");
    const close = el("button", "qr-icon-btn qr-settings-close");
    setIcon(close, "x");
    close.setAttribute("aria-label", "关闭阅读设置");
    close.onclick = () => box.remove();
    box.appendChild(close);
    box.appendChild(el("div", "qr-settings-title", "阅读设置"));

    const fontRow = el("div", "qr-settings-row");
    fontRow.appendChild(el("span", undefined, "字号"));
    const minus = el("button", "qr-btn qr-btn-sm", "−");
    const val = el("span", "qr-settings-value", `${s.fontSize}px`);
    const plus = el("button", "qr-btn qr-btn-sm", "＋");
    minus.onclick = () => this.adjFontSize(-1, val);
    plus.onclick = () => this.adjFontSize(1, val);
    fontRow.append(minus, val, plus);
    box.appendChild(fontRow);

    box.appendChild(this.selectRow("行距", ["1.5", "1.75", "2"], String(s.lineHeight), async (v) => {
      s.lineHeight = Number(v);
      await this.plugin.saveSettings();
      this.applyThemeClass();
    }));
    box.appendChild(
      this.selectRow("主题", ["auto", "light", "dark"], s.theme, async (v) => {
        s.theme = v as ReadingTheme;
        await this.plugin.saveSettings();
        this.applyThemeClass();
      })
    );
    box.appendChild(
      this.selectRow("默认阅读模式", ["paginated", "scrolled"], s.defaultMode, async (v) => {
        s.defaultMode = v as ReadMode;
        await this.plugin.saveSettings();
      })
    );
    this.root.appendChild(box);
  }

  private adjFontSize(delta: number, valEl: HTMLElement): void {
    const s = this.plugin.settings.reading;
    s.fontSize = Math.max(12, Math.min(28, s.fontSize + delta));
    valEl.setText(`${s.fontSize}px`);
    void this.plugin.saveSettings();
    this.applyThemeClass();
  }

  private selectRow(
    label: string,
    options: string[],
    current: string,
    onChange: (v: string) => Promise<void> | void
  ): HTMLElement {
    const row = el("div", "qr-settings-row");
    row.appendChild(el("span", undefined, label));
    const sel = el("select", "qr-select") as HTMLSelectElement;
    for (const o of options) {
      const opt = el("option", undefined, o) as HTMLOptionElement;
      opt.value = o;
      sel.appendChild(opt);
    }
    sel.value = current;
    sel.onchange = () => void onChange(sel.value);
    row.appendChild(sel);
    return row;
  }

  // ------------------------------------------------------------ navigation


  private async stepChapter(dir: 1 | -1): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    const chapters = Object.entries(entry.reading.chapters).sort((a, b) => a[1].index - b[1].index);
    if (chapters.length === 0) {
      new Notice("本书还没有章节");
      return;
    }
    let index = chapters.findIndex(([id]) => id === this.currentChapterId);
    if (index < 0) index = 0;
    const [id, chapter] = chapters[Math.max(0, Math.min(chapters.length - 1, index + dir))];
    try {
      await this.engine?.goToChapter(id, chapter.href);
    } catch (error) {
      new Notice(`章节跳转失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async finishChapter(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    if (!this.currentChapterId) {
      new Notice(entry.reading.book.format === "pdf" ? "请先在目录中创建章节" : "当前不在章节中");
      return;
    }
    await this.persistProgress(true);
    await this.plugin.openAnswer(entry.id, this.currentChapterId, "answer");
  }

  // ------------------------------------------------------------ annotations

  private openSelectionMenu(selection: EngineSelection): void {
    if (!this.entry || this.draft || this.annotationSaving) return;
    const record = this.entry.reading.annotations.find((record) =>
      selection.cfi ? record.cfi === selection.cfi :
        record.pdfPage === selection.pdfPage && record.itemRanges?.length === selection.itemRanges?.length &&
        record.itemRanges?.every((range, index) => {
          const selected = selection.itemRanges?.[index];
          return selected?.item === range.item && selected.start === range.start && selected.end === range.end;
        })
    );
    this.closePanels();
    this.markTarget = record ? { record, anchor: selection.anchor } : { selection, anchor: selection.anchor };
    this.renderMarkMenu();
  }

  private openMarkMenu(id: string, anchor?: SelectionAnchor): void {
    if (!this.entry || this.draft || this.annotationSaving) return;
    const record = this.entry.reading.annotations.find((record) => record.id === id);
    if (!record) return;
    this.closePanels();
    this.markTarget = { record, anchor };
    this.renderMarkMenu();
  }

  private closeMarkMenu(clearSelection = true): void {
    this.markTarget = null;
    this.markMenu.empty();
    this.markMenu.addClass("qr-hidden");
    if (clearSelection) this.engine?.clearSelection();
  }

  private renderMarkMenu(): void {
    const target = this.markTarget;
    const menu = this.markMenu;
    menu.empty();
    if (!target) {
      menu.addClass("qr-hidden");
      return;
    }
    menu.removeClass("qr-hidden");
    const addAction = (label: string, action: () => void): void => {
      const button = el("button", "qr-btn qr-btn-ghost", label);
      button.disabled = this.annotationSaving;
      button.onclick = action;
      menu.appendChild(button);
    };
    const record = target.record;
    if (record) {
      addAction(target.confirmDelete ? "确认取消画线及批注" : "取消画线", () => {
        if (record.kind !== "highlight" && (record.note || record.aiExplanation) && !target.confirmDelete) {
          target.confirmDelete = true;
          this.renderMarkMenu();
        } else {
          void this.removeMark(target, false);
        }
      });
      addAction(record.kind === "highlight" ? "批注" : "编辑批注", () => this.openAnnotationEdit(record.id));
      if (record.kind !== "highlight") addAction("取消批注", () => void this.removeMark(target, true));
    } else if (target.selection) {
      const selection = target.selection;
      addAction("划线", () => void this.highlightSelection(target));
      addAction("批注", () => this.openAnnotationCreate(selection));
    }
    const close = el("button", "qr-icon-btn");
    setIcon(close, "x");
    close.setAttribute("aria-label", "关闭选文菜单");
    close.disabled = this.annotationSaving;
    close.onclick = () => this.closeMarkMenu();
    menu.appendChild(close);
    const root = this.root.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const anchor = target.anchor;
    const left = anchor ? (anchor.left + anchor.right) / 2 - root.left - box.width / 2 : (root.width - box.width) / 2;
    const above = anchor ? anchor.top - root.top - box.height - 8 : root.height / 2 - box.height;
    const top = above >= 8 ? above : (anchor?.bottom ?? root.top) - root.top + 8;
    menu.style.left = `${Math.max(8, Math.min(left, root.width - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(top, root.height - box.height - 8))}px`;
  }

  private async highlightSelection(target: MarkTarget): Promise<void> {
    if (!target.selection || this.annotationSaving) return;
    this.annotationSaving = true;
    this.renderMarkMenu();
    try {
      await this.saveSelection(target.selection, "highlight");
      if (this.markTarget === target) this.closeMarkMenu();
    } catch (error) {
      new Notice(`划线保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.annotationSaving = false;
      this.renderMarkMenu();
    }
  }

  private async removeMark(target: MarkTarget, commentOnly: boolean): Promise<void> {
    const entry = this.entry;
    const record = target.record;
    const engine = this.engine;
    if (!entry || !record || this.annotationSaving) return;
    this.annotationSaving = true;
    this.renderMarkMenu();
    try {
      if (commentOnly) await this.plugin.library.clearAnnotation(entry, record.id);
      else await this.plugin.library.deleteAnnotation(entry, record.id);
      if (!commentOnly && this.engine === engine) engine?.removeHighlight(record);
      if (this.markTarget === target) this.closeMarkMenu();
    } catch (error) {
      new Notice(`${commentOnly ? "取消批注" : "取消画线"}失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.annotationSaving = false;
      this.renderMarkMenu();
    }
  }

  private async saveSelection(selection: EngineSelection, kind: "highlight" | "annotation", note?: string, aiExplanation?: string): Promise<void> {
    const entry = this.entry;
    const engine = this.engine;
    const chapterId = selection.chapterId ?? this.currentChapterId;
    if (!entry || !chapterId) throw new Error("当前不在章节中，请先从目录创建或选择章节");
    const record = await this.plugin.library.saveAnnotation(entry, {
      id: genId("a"), chapterId, kind, text: selection.text, note, aiExplanation,
      cfi: selection.cfi, pdfPage: selection.pdfPage, itemRanges: selection.itemRanges,
      sortKey: selection.sortKey ?? 0,
    });
    if (this.engine === engine) engine?.addHighlight(record);
  }

  private openAnnotationCreate(sel: EngineSelection): void {
    const entry = this.entry;
    if (!entry) return;
    const chapterId = sel.chapterId ?? this.currentChapterId;
    if (!chapterId) {
      new Notice("当前不在章节中，无法批注");
      return;
    }
    this.closeMarkMenu();
    this.draft = {
      mode: "create",
      chapterId,
      selection: sel,
      note: "",
      aiText: "",
      aiIncluded: false,
      aiLoading: false,
    };
    this.renderAnnotationCard();
  }

  private openAnnotationEdit(id: string): void {
    const entry = this.entry;
    if (!entry) return;
    const record = entry.reading.annotations.find((a) => a.id === id);
    if (!record) return;
    this.closeMarkMenu();
    this.draft = {
      mode: "edit",
      chapterId: record.chapterId,
      record,
      note: record.note ?? "",
      aiText: record.aiExplanation ?? "",
      aiIncluded: Boolean(record.aiExplanation),
      aiLoading: false,
    };
    this.renderAnnotationCard();
  }

  private renderAnnotationCard(): void {
    const draft = this.draft;
    const entry = this.entry;
    const card = this.annotCard;
    card.empty();
    card.removeClass("qr-hidden");
    if (!draft || !entry) {
      card.addClass("qr-hidden");
      return;
    }
    const quoteText =
      (draft.mode === "edit" ? draft.record?.text : draft.selection?.text) ?? "";
    const quote = el("div", "qr-annot-quote");
    quote.setText(quoteText.length > 220 ? quoteText.slice(0, 220) + "……" : quoteText);

    card.appendChild(el("div", "qr-annot-title", draft.mode === "create" ? "批注" : "编辑批注"));
    card.appendChild(quote);

    const noteLabel = el("label", "qr-label", "我的理解");
    const note = document.createElement("textarea");
    note.className = "qr-textarea";
    note.id = "qr-annotation-note";
    noteLabel.setAttribute("for", note.id);
    note.rows = 3;
    note.placeholder = "用自己的话写下对这段内容的理解（可留空）";
    note.value = draft.note;
    note.oninput = () => {
      if (this.draft) this.draft.note = note.value;
    };
    card.append(noteLabel, note);

    const aiLabel = el("label", "qr-label", "AI 解释");
    const aiArea = el("div", "qr-ai-area");
    card.append(aiLabel, aiArea);
    this.renderAiArea(aiArea);

    const actions = el("div", "qr-annot-actions");
    const cancel = el("button", "qr-btn", "取消");
    cancel.onclick = () => {
      this.draft = null;
      this.renderAnnotationCard();
    };
    const save = el("button", "qr-btn qr-btn-primary", "保存");
    save.disabled = draft.aiLoading || this.annotationSaving;
    save.onclick = async () => {
      if (this.annotationSaving) return;
      this.annotationSaving = true;
      save.disabled = true;
      try {
        await this.saveAnnotation();
      } catch (error) {
        new Notice(`批注保存失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.annotationSaving = false;
        save.disabled = false;
      }
    };
    actions.append(cancel, save);
    card.appendChild(actions);
  }

  private renderAiArea(aiArea: HTMLElement): void {
    const draft = this.draft;
    const entry = this.entry;
    aiArea.empty();
    if (!draft || !entry) return;
    if (draft.aiLoading) {
      aiArea.appendChild(el("div", "qr-muted qr-pulse", "AI 正在解释……"));
      return;
    }
    if (!draft.aiText) {
      const btn = el("button", "qr-btn qr-btn-ghost", "AI 解释");
      btn.onclick = () => void this.requestAiExplanation();
      aiArea.appendChild(btn);
      aiArea.appendChild(
        el("div", "qr-muted qr-tiny", "读不懂这段内容时，可以让 AI 结合上下文解释")
      );
      return;
    }
    const text = el("div", "qr-annot-ai-text");
    text.setText(draft.aiText);
    aiArea.appendChild(text);
    const btnRow = el("div", "qr-ai-actions");
    const regen = el("button", "qr-btn qr-btn-sm", "重新生成");
    regen.onclick = () => void this.requestAiExplanation();
    const toggle = el(
      "button",
      `qr-btn qr-btn-sm ${draft.aiIncluded ? "qr-btn-primary" : ""}`,
      draft.aiIncluded ? "✓ 已收录" : "收录"
    );
    toggle.onclick = () => {
      if (!this.draft) return;
      this.draft.aiIncluded = !this.draft.aiIncluded;
      this.renderAnnotationCard();
    };
    btnRow.append(regen, toggle);
    aiArea.appendChild(btnRow);
  }

  private async requestAiExplanation(): Promise<void> {
    const draft = this.draft;
    const entry = this.entry;
    if (!draft || !entry) return;
    const sel =
      draft.mode === "create"
        ? draft.selection
        : draft.record
          ? {
              text: draft.record.text,
              cfi: draft.record.cfi,
              pdfPage: draft.record.pdfPage,
              itemRanges: draft.record.itemRanges,
            }
          : null;
    if (!sel || draft.aiLoading) return;
    draft.aiLoading = true;
    this.renderAnnotationCard();
    try {
      let context = { before: "", after: "" };
      try {
        context = await this.engine?.getSelectionContext(sel) ?? { before: "", after: "" };
      } catch {
        /* context is best-effort */
      }
      const ch = entry.reading.chapters[draft.chapterId];
      const text = await explainSelection(
        this.plugin.settings.ai,
        entry.reading.book.title,
        ch?.title ?? "",
        sel.text,
        context
      );
      if (this.draft === draft) {
        draft.aiText = text;
        draft.aiIncluded = draft.mode === "edit" ? draft.aiIncluded : true;
        draft.aiLoading = false;
        this.renderAnnotationCard();
      }
    } catch (e) {
      if (this.draft === draft) {
        draft.aiLoading = false;
        this.renderAnnotationCard();
      }
      new Notice(`AI 解释失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async saveAnnotation(): Promise<void> {
    const draft = this.draft;
    const entry = this.entry;
    if (!draft || !entry) return;
    const note = draft.note.trim();
    const ai = draft.aiIncluded && draft.aiText ? draft.aiText : undefined;
    if (draft.mode === "edit" && draft.record) {
      await this.plugin.library.updateAnnotation(entry, draft.record.id, {
        kind: "annotation",
        note,
        aiExplanation: ai,
      });
    } else if (draft.selection) {
      await this.saveSelection(draft.selection, "annotation", note, ai);
    }
    this.draft = null;
    this.renderAnnotationCard();
  }

  // ------------------------------------------------------------ panels

  private closePanels(): void {
    this.closeMarkMenu(false);
    this.tocPanel.removeClass("qr-open");
    this.questionsPanel.removeClass("qr-open");
    this.root.querySelector(".qr-mask")?.removeClass("qr-show");
    this.root.querySelectorAll(".qr-reader-settings").forEach((n) => n.remove());
    this.root.querySelectorAll(".qr-modal-form").forEach((n) => n.remove());
  }

  private onLibraryDataChanged(): void {
    const entry = this.entry;
    if (!entry) return;
    const fresh = this.plugin.library.get(entry.id);
    if (!fresh || !isHealthyBook(fresh) || fresh.dir !== entry.dir) {
      ++this.generation;
      this.engine?.destroy();
      this.engine = null;
      this.entry = null;
      this.contentHost.empty();
      this.contentHost.appendChild(el("div", "qr-empty", "书籍已移除或记录损坏，请返回书架处理"));
      return;
    }
    this.entry = fresh;
    this.engine?.updateChapters?.(chaptersOrdered(fresh.reading));
    this.renderQuestions();
  }
}
