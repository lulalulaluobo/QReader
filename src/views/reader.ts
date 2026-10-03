// Reading page (PRD §7–§15): minimal chrome, 目录 drawer, 💡 三问 panel,
// ··· menu, annotation card, chapter navigation and 完成本章.

import { ItemView, Menu, Notice, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type {
  AnnotationRecord,
  HealthyBookEntry,
  ReadMode,
  ReadingTheme,
  ReadingColors,
  TocNode,
} from "../types";
import { QUESTION_LABELS, chaptersOrdered, isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import type { EngineSelection, EngineLocation, EngineHooks, ReaderEngine, SelectionAnchor } from "../reader/engine";
import { EpubEngine } from "../reader/epub-engine";
import { PdfEngine } from "../reader/pdf-engine";
import { el, genId, fmtDateTime } from "../util";
import { explainSelection } from "../ai/tasks";
import { READING_PALETTES } from "../settings";
import { getAiConfig } from "../ai/providers";

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
  private opened = false;

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
    this.opened = true;
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
        if (this.chromeHidden) this.toggleChrome();
      }
    });
  }

  async onClose(): Promise<void> {
    this.opened = false;
    ++this.generation;
    this.unsub?.();
    this.unsubSettings?.();
    this.unsub = this.unsubSettings = null;
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    const saving = this.persistProgress(true);
    this.engine?.destroy();
    this.engine = null;
    await saving;
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
  private runningTitleEl!: HTMLElement;
  private positionEl!: HTMLElement;
  private panelTrigger: HTMLElement | null = null;
  private tocPanel!: HTMLElement;
  private tocBody!: HTMLElement;
  private questionsPanel!: HTMLElement;
  private questionsBody!: HTMLElement;
  private annotCard!: HTMLElement;
  private markMenu!: HTMLElement;

  private buildSkeleton(): void {
    this.contentEl.empty();
    this.contentEl.addClass("qr-view", "qr-reader-view");
    const root = el("div", "qr-reader");
    root.toggleClass("qr-chrome-hidden", this.chromeHidden);
    this.contentEl.appendChild(root);
    this.root = root;
    root.tabIndex = -1;
    this.runningTitleEl = el("div", "qr-reader-running-title");
    this.positionEl = el("div", "qr-reader-position");
    root.append(this.runningTitleEl, this.positionEl);

    const top = el("div", "qr-reader-top");
    const back = el("button", "qr-icon-btn");
    setIcon(back, "arrow-left");
    back.setAttribute("aria-label", "返回书架");
    back.onclick = () => this.plugin.openBookshelf();
    const title = el("div", "qr-reader-title");
    this.readerTitleEl = title;
    const actions = el("div", "qr-top-actions");
    const tocBtn = el("button", "qr-dock-btn");
    setIcon(tocBtn, "list");
    tocBtn.setAttribute("aria-label", "目录");
    tocBtn.title = "目录";
    tocBtn.onclick = () => this.toggleToc();
    tocBtn.appendChild(el("span", undefined, "目录"));
    const qBtn = el("button", "qr-dock-btn qr-bulb");
    setIcon(qBtn, "lightbulb");
    qBtn.setAttribute("aria-label", "本章三问");
    qBtn.title = "本章三问";
    qBtn.onclick = () => this.toggleQuestions();
    qBtn.appendChild(el("span", undefined, "三问"));
    qBtn.disabled = this.entry?.reading.book.format === "cbz";
    if (qBtn.disabled) qBtn.title = "图片书没有文字层，不能生成三问";
    const moreBtn = el("button", "qr-icon-btn");
    setIcon(moreBtn, "more-horizontal");
    moreBtn.setAttribute("aria-label", "更多阅读操作");
    moreBtn.onclick = (e) => this.openMoreMenu(e);
    actions.append(moreBtn);
    top.append(back, title, actions);

    const host = el("div", "qr-reader-content");
    this.contentHost = host;
    host.tabIndex = 0;
    host.setAttribute("aria-label", "阅读正文；轻点中央或按 Escape 显示操作栏");

    const bottom = el("div", "qr-reader-bottom");
    const chapters = el("div", "qr-reader-chapter-actions");
    const prevCh = el("button", "qr-btn", "上一章");
    prevCh.onclick = () => void this.stepChapter(-1);
    const done = el("button", "qr-btn qr-btn-primary", "完成本章");
    done.disabled = this.entry?.reading.book.format === "cbz";
    if (done.disabled) done.title = "图片书没有文字层，不能闭卷回答";
    done.onclick = () => void this.finishChapter();
    const nextCh = el("button", "qr-btn", "下一章");
    nextCh.onclick = () => void this.stepChapter(1);
    chapters.append(prevCh, done, nextCh);
    this.progressEl = el("span", "qr-progress");
    this.progressBar = document.createElement("progress");
    this.progressBar.max = 1;
    this.progressBar.setAttribute("aria-label", "全书阅读进度");
    const meter = el("div", "qr-reader-meter");
    meter.append(this.progressBar, this.progressEl);
    const dock = el("div", "qr-reader-dock");
    const control = (label: string, icon: string, action: () => void): HTMLButtonElement => {
      const button = el("button", "qr-dock-btn");
      button.setAttribute("aria-label", label);
      setIcon(button, icon);
      button.appendChild(el("span", undefined, label));
      button.onclick = action;
      return button;
    };
    dock.append(tocBtn, qBtn, control("笔记", "notebook-pen", () => this.openNotes()),
      control("字号", "type", () => this.openReaderSettings()),
      control("背景", "palette", () => this.openReaderSettings("theme")));
    bottom.append(meter, chapters, dock);
    const header = el("div", "qr-reader-header");
    header.append(top);
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
    if (!this.opened) return;
    const entry = this.plugin.library.get(bookId);
    if (!entry || !isHealthyBook(entry)) {
      new Notice("书籍不存在或记录已损坏");
      return;
    }
    if (this.entry?.id === entry.id && this.engine) {
      this.applyThemeClass();
      return;
    }
    const generation = ++this.generation;
    await this.persistProgress(true);
    if (generation !== this.generation) return;
    const previous = this.entry;
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
    if (entry.reading.book.format !== "cbz") {
      this.plugin.library.ensureQuestions(entry, this.currentChapterId ?? "")
        .then(() => this.renderQuestions())
        .catch(() => this.renderQuestions());
    }
    this.renderQuestions();
    this.app.workspace.requestSaveLayout();
  }

  private async createEngine(entry: HealthyBookEntry): Promise<ReaderEngine> {
    const layout = this.plugin.settings.reading;
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
    if (entry.reading.book.format !== "pdf") {
      const book = await this.plugin.cache.getEpub(entry);
      const progress = entry.reading.progress;
      return new EpubEngine(book, chapters, {
        cfi: progress.cfi ?? null,
        percent: progress.percent,
        chapterId: progress.chapterId,
      }, hooks, entry.reading.annotations, { mode: this.mode, layout, theme, format: entry.reading.book.format });
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
    if (chapterChanged && loc.chapterId && entry.reading.book.format !== "cbz") {
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
    this.runningTitleEl.setText(chTitle || entry.reading.book.title);
  }

  private renderProgress(percent: number): void {
    this.progressEl.setText(`${Math.round(percent * 100)}%`);
    this.progressBar.value = Math.max(0, Math.min(1, percent));
    const page = this.lastLoc?.pdfPage;
    this.positionEl.setText(page
      ? `第 ${page} / ${this.entry?.reading.book.numPages ?? page} 页 · ${Math.round(percent * 100)}%`
      : `${Math.round(percent * 100)}%`);
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

  private resolvedTheme(): ReadingColors {
    const theme = this.plugin.settings.reading.theme;
    return READING_PALETTES[theme === "auto"
      ? (this.contentEl.ownerDocument.body.hasClass("theme-dark") ? "dark" : "light")
      : theme];
  }

  private applyThemeClass(): void {
    const colors = this.resolvedTheme();
    this.root.toggleClass("qr-theme-dark", colors.dark);
    this.root.toggleClass("qr-theme-light", !colors.dark);
    this.root.style.setProperty("--qr-surface", colors.background);
    this.root.style.setProperty("--qr-reading-fg", colors.foreground);
    this.root.style.setProperty("--qr-reading-muted", colors.muted);
    if (this.engine) {
      void this.engine.applyLayout(this.plugin.settings.reading, colors)
        .catch((error: unknown) => new Notice(`布局更新失败：${error instanceof Error ? error.message : String(error)}`));
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
    if (nodes.length === 0 && entry.reading.book.format !== "pdf") {
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
    if (entry.reading.book.format === "cbz") {
      body.appendChild(el("div", "qr-muted", "图片书没有文字层，不能生成本章三问。"));
      return;
    }
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
    if (this.entry?.reading.book.format !== "cbz") {
      menu.addItem((item) => item.setTitle("重新生成三问").setIcon("refresh-cw").onClick(() => void this.regenerate()));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("阅读设置").setIcon("sliders-horizontal").onClick(() => this.openReaderSettings()));
    menu.showAtMouseEvent(e);
  }

  private openReaderSettings(section: "type" | "theme" = "type"): void {
    const s = this.plugin.settings.reading;
    const box = this.createReadingSheet(section === "type" ? "字号与排版" : "阅读背景");
    const body = el("div", "qr-reading-sheet-body");
    box.appendChild(body);
    if (section === "theme") {
      const themes: Record<ReadingTheme, string> = {
        light: "纸白", sepia: "暖纸", sage: "青绿", dark: "夜间", auto: "跟随系统",
      };
      const choices = el("div", "qr-theme-choices");
      for (const value in themes) {
        const theme = value as ReadingTheme;
        const button = el("button", "qr-theme-choice");
        button.setAttribute("aria-label", themes[theme]);
        button.setAttribute("aria-pressed", String(s.theme === theme));
        button.toggleClass("qr-theme-choice-active", s.theme === theme);
        const sample = el("span", "qr-theme-sample", "文");
        const colors = theme === "auto" ? this.resolvedTheme() : READING_PALETTES[theme];
        sample.style.background = colors.background;
        sample.style.color = colors.foreground;
        button.append(sample, el("span", undefined, themes[theme]));
        button.onclick = () => {
          s.theme = theme;
          for (const choice of choices.querySelectorAll<HTMLButtonElement>("button")) {
            const active = choice === button;
            choice.toggleClass("qr-theme-choice-active", active);
            choice.setAttribute("aria-pressed", String(active));
          }
          void this.saveReadingSettings();
        };
        choices.appendChild(button);
      }
      body.append(choices, el("p", "qr-reading-help", "只改变阅读页配色；PDF 与图片书保留原始页面颜色。"));
    } else {
      if (this.engine?.reflowable) {
        body.appendChild(this.sliderRow("字号", 12, 28, 1, s.fontSize, (value) => { s.fontSize = value; }));
        body.appendChild(this.sliderRow("行距", 1.4, 2.4, 0.05, s.lineHeight, (value) => { s.lineHeight = value; }));
        body.appendChild(this.sliderRow("页边距", 12, 48, 2, s.pageMargin, (value) => { s.pageMargin = value; }));
        body.appendChild(this.selectRow("字体", { original: "原书字体", sans: "系统黑体", serif: "系统宋体" },
          s.fontFamily, async (value) => {
            s.fontFamily = value === "sans" || value === "serif" ? value : "original";
            await this.saveReadingSettings();
          }));
        const row = el("label", "qr-reading-toggle");
        const indent = el("input");
        indent.type = "checkbox";
        indent.checked = s.paragraphIndent;
        indent.onchange = () => {
          s.paragraphIndent = indent.checked;
          void this.saveReadingSettings();
        };
        row.append(el("span", undefined, "首行缩进"), indent);
        body.appendChild(row);
      } else {
        body.appendChild(el("p", "qr-reading-help", "本书保留原始版式，字号、行距、字体和页边距不能重排。"));
      }
      body.appendChild(this.selectRow("翻页方式", { paginated: "左右翻页", scrolled: "上下滚动" },
        this.mode, async (value) => {
          if (!this.engine) return;
          const mode = value === "scrolled" ? "scrolled" : "paginated";
          await this.engine.setMode(mode);
          this.mode = mode;
          s.defaultMode = mode;
          await this.persistProgress(true);
          await this.saveReadingSettings();
        }));
    }
  }


  private selectRow(
    label: string,
    options: Record<string, string>,
    current: string,
    onChange: (value: string) => Promise<void>
  ): HTMLElement {
    const row = el("div", "qr-settings-row");
    row.appendChild(el("span", undefined, label));
    const select = el("select", "qr-select");
    select.setAttribute("aria-label", label);
    for (const value in options) {
      const option = el("option", undefined, options[value]);
      option.value = value;
      select.appendChild(option);
    }
    select.value = current;
    select.onchange = () => {
      void onChange(select.value).catch((error: unknown) => {
        select.value = current;
        new Notice(`设置更新失败：${error instanceof Error ? error.message : String(error)}`);
      });
    };
    row.appendChild(select);
    return row;
  }

  private createReadingSheet(title: string, extraClass = ""): HTMLElement {
    const active = this.contentEl.ownerDocument.activeElement;
    this.closePanels();
    this.panelTrigger = active instanceof HTMLElement ? active : null;
    this.contentHost.inert = true;
    this.root.querySelector(".qr-mask")?.addClass("qr-show");
    const sheet = el("section", `qr-reader-settings qr-reading-sheet ${extraClass}`);
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);
    const header = el("div", "qr-reading-sheet-header");
    const close = el("button", "qr-icon-btn");
    close.setAttribute("aria-label", `关闭${title}`);
    setIcon(close, "x");
    close.onclick = () => this.closePanels();
    header.append(el("h2", undefined, title), close);
    sheet.appendChild(header);
    sheet.onkeydown = (event) => {
      if (event.key !== "Tab") return;
      const controls = sheet.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea");
      const first = controls[0];
      const last = controls[controls.length - 1];
      const focused = sheet.ownerDocument.activeElement;
      if (event.shiftKey && focused === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && focused === last) { event.preventDefault(); first?.focus(); }
    };
    this.root.appendChild(sheet);
    close.focus({ preventScroll: true });
    return sheet;
  }

  private async saveReadingSettings(): Promise<void> {
    try {
      await this.plugin.saveSettings();
      this.plugin.notifySettingsChanged();
    } catch (error) {
      new Notice(`阅读设置保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sliderRow(label: string, min: number, max: number, step: number, current: number,
    onChange: (value: number) => void): HTMLElement {
    const row = el("div", "qr-reading-slider");
    const value = el("output", "qr-settings-value", String(current));
    const slider = el("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(current);
    slider.setAttribute("aria-label", label);
    slider.oninput = () => value.setText(String(Number(slider.value)));
    slider.onchange = () => {
      onChange(Number(slider.value));
      void this.saveReadingSettings();
    };
    row.append(el("span", undefined, label), slider, value);
    return row;
  }

  private openNotes(): void {
    const sheet = this.createReadingSheet("笔记", "qr-notes-sheet");
    sheet.appendChild(el("div", "qr-reading-sheet-body qr-notes-body"));
    this.renderNotes();
  }

  private renderNotes(): void {
    const body = this.root.querySelector<HTMLElement>(".qr-notes-body");
    const entry = this.entry;
    if (!body || !entry) return;
    body.empty();
    const records = entry.reading.annotations.slice().sort((a, b) =>
      (entry.reading.chapters[a.chapterId]?.index ?? 0) - (entry.reading.chapters[b.chapterId]?.index ?? 0) ||
      a.sortKey - b.sortKey);
    if (records.length === 0) {
      body.appendChild(el("div", "qr-empty", entry.reading.book.format === "cbz"
        ? "图片书没有文字层，不能添加文字批注。"
        : "还没有笔记。选择正文可以划线，也可以写下自己的理解。"));
      return;
    }
    let chapterId: string | null = null;
    for (const record of records) {
      if (chapterId !== record.chapterId) {
        chapterId = record.chapterId;
        body.appendChild(el("h3", "qr-note-chapter", entry.reading.chapters[chapterId]?.title ?? "未分章"));
      }
      const note = el("article", "qr-reading-note");
      note.appendChild(el("div", "qr-note-meta", `${record.kind === "highlight" ? "划线" : "批注"} · ${fmtDateTime(record.createdAt)}`));
      note.appendChild(el("blockquote", "qr-note-quote", record.text));
      if (record.note) note.appendChild(el("p", "qr-note-understanding", record.note));
      if (record.aiExplanation) {
        const explanation = el("details", "qr-note-ai");
        explanation.append(el("summary", undefined, "已收录的 AI 解释"), el("p", undefined, record.aiExplanation));
        note.appendChild(explanation);
      }
      const actions = el("div", "qr-note-actions");
      const jump = el("button", "qr-btn qr-btn-sm", "回到原文");
      jump.onclick = async () => {
        const engine = this.engine;
        if (!engine) return;
        jump.disabled = true;
        try {
          await engine.goToAnnotation(record);
          if (this.engine !== engine) return;
          this.closePanels();
          this.engine.clearSelection();
        } catch (error) {
          new Notice(`批注定位失败：${error instanceof Error ? error.message : String(error)}`);
        } finally { jump.disabled = false; }
      };
      const edit = el("button", "qr-btn qr-btn-sm", record.kind === "highlight" ? "写批注" : "编辑批注");
      edit.onclick = () => { this.closePanels(); this.openAnnotationEdit(record.id); };
      actions.append(jump, edit);
      note.appendChild(actions);
      body.appendChild(note);
    }
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
    if (entry.reading.book.format === "cbz") {
      new Notice("图片书没有文字层，不能闭卷回答");
      return;
    }
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
        getAiConfig(this.plugin.settings.ai),
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
    this.contentHost.inert = false;
    const trigger = this.panelTrigger;
    this.panelTrigger = null;
    trigger?.focus({ preventScroll: true });
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
    this.renderNotes();
  }
}
