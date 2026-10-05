// Reading page: immersive text, chapter navigation and on-demand reading tools.

import { ItemView, Menu, Notice, setIcon } from "obsidian";
import type { WorkspaceLeaf, ViewStateResult } from "obsidian";
import type {
  AnnotationRecord,
  HealthyBookEntry,
  HighlightColor,
  ReadMode,
  ReadingTheme,
  ReadingColors,
  TocNode,
} from "../types";
import { chaptersOrdered, isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import type { EngineSelection, EngineLocation, EngineHooks, ReaderEngine, SelectionAnchor } from "../reader/engine";
import { EpubEngine } from "../reader/epub-engine";
import { PdfEngine } from "../reader/pdf-engine";
import { el, genId, fmtDateTime } from "../util";
import { renderNoteHistory } from "./note-content";
import { chapterNotes } from "../core/chapter-notes";
import { explainSelection } from "../ai/tasks";
import { HIGHLIGHT_COLORS, READING_PALETTES } from "../settings";
import { getAiConfig } from "../ai/providers";
import { VocabularyStore } from "../core/vocabulary";
import { VaultFs } from "../core/fs";
import { singleWord } from "../translation/youdao";
import { translateSentence } from "../translation/sentence";

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
  color: HighlightColor;
}

interface MarkTarget {
  selection?: EngineSelection;
  record?: AnnotationRecord;
  anchor?: SelectionAnchor;
  confirmDelete?: boolean;
  color: HighlightColor;
  colorsOpen?: boolean;
  actionsOpen?: boolean;
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
  private panelSession = 0;
  private deletingNoteId: string | null = null;
  private confirmingNoteId: string | null = null;
  private cancelHighlightPress: (() => void) | null = null;
  private stateRequest = 0;
  private vocabulary: VocabularyStore | null = null;
  private unsubVocabulary: (() => void) | null = null;
  private vocabularyJobs = new Set<Promise<void>>();
  private translationAudio: HTMLAudioElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
    this.navigation = true;
    // Subscribe only while the view is open.
  }

  getViewType(): string {
    return VIEW_TYPE_READER;
  }
  getDisplayText(): string {
    return this.entry ? `QReader · ${this.entry.reading.book.title}` : this.plugin.t("QReader 阅读");
  }
  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.lang = this.plugin.settings.language;
    this.plugin.syncReadingChrome();
    this.contentEl.empty();
    this.buildSkeleton();
    this.applyThemeClass();
    this.unsub = this.plugin.onLibraryChanged(() => this.onLibraryDataChanged());
    this.unsubSettings = this.plugin.onSettingsChanged((reason) => {
      if (reason === "language") {
        this.closePanels();
        this.buildSkeleton(true);
        this.renderTitle();
        this.renderProgress(this.lastLoc?.percent ?? this.entry?.reading.progress.percent ?? 0);
        this.renderAnnotationCard();
      } else if (reason !== "translation") this.applyThemeClass();
      this.updateVocabulary();
    });
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
    this.engine?.flushVocabulary();
    this.opened = false;
    ++this.stateRequest;
    ++this.generation;
    this.closePanels();
    this.draft = null;
    this.unsub?.();
    this.unsubSettings?.();
    this.unsub = this.unsubSettings = null;
    this.unsubVocabulary?.(); this.unsubVocabulary = null;
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    const saving = this.persistProgress(true);
    this.engine?.destroy();
    this.engine = null;
    await saving;
    await Promise.allSettled([...this.vocabularyJobs]);
    if (this.entry) await this.releaseSource(this.entry);
  }

  getState(): { bookId?: string } {
    return this.entry ? { bookId: this.entry.id } : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const request = ++this.stateRequest;
    const previousBookId = this.entry?.id;
    await super.setState(state, result);
    if (typeof state !== "object" || state === null || !("bookId" in state) || typeof state.bookId !== "string") return;
    await this.plugin.library.scan();
    if (!this.opened || request !== this.stateRequest) return;
    await this.openBook(state.bookId);
    if (this.opened && request === this.stateRequest && this.entry?.id !== previousBookId) result.history = true;
  }

  async goToAnnotation(id: string): Promise<void> {
    const record = this.entry?.reading.annotations.find(record => record.id === id);
    const engine = this.engine;
    if (!record || !engine) throw new Error(this.plugin.t("原笔记或版本已不可用"));
    await engine.goToAnnotation(record);
    if (this.engine === engine) { this.closePanels(); engine.clearSelection(); }
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
  private annotCard!: HTMLElement;
  private markMenu!: HTMLElement;

  private buildSkeleton(refreshControls = false): void {
    if (!refreshControls) this.contentEl.empty();
    this.contentEl.addClass("qr-view", "qr-reader-view");
    const root = refreshControls ? this.root : el("div", "qr-reader");
    if (refreshControls) {
      // Keep the renderer attached: moving an iframe would reload its document.
      for (const child of Array.from(root.children)) if (child !== this.contentHost) child.remove();
    }
    root.toggleClass("qr-chrome-hidden", this.chromeHidden);
    if (!refreshControls) this.contentEl.appendChild(root);
    this.root = root;
    root.tabIndex = -1;
    this.runningTitleEl = el("div", "qr-reader-running-title");
    this.positionEl = el("div", "qr-reader-position");
    root.append(this.runningTitleEl, this.positionEl);

    const top = el("div", "qr-reader-top");
    const back = el("button", "qr-icon-btn");
    setIcon(back, "arrow-left");
    back.setAttribute("aria-label", this.plugin.t("返回书架"));
    back.onclick = () => this.plugin.openBookshelf();
    const title = el("div", "qr-reader-title");
    this.readerTitleEl = title;
    const actions = el("div", "qr-top-actions");
    const tocBtn = el("button", "qr-dock-btn");
    setIcon(tocBtn, "list");
    tocBtn.setAttribute("aria-label", this.plugin.t("目录"));
    tocBtn.title = this.plugin.t("目录");
    tocBtn.onclick = () => this.toggleToc();
    tocBtn.appendChild(el("span", undefined, this.plugin.t("目录")));
    const moreBtn = el("button", "qr-icon-btn");
    setIcon(moreBtn, "more-horizontal");
    moreBtn.setAttribute("aria-label", this.plugin.t("更多阅读操作"));
    moreBtn.onclick = (e) => this.openMoreMenu(e);
    actions.append(moreBtn);
    top.append(back, title, actions);

    const host = refreshControls ? this.contentHost : el("div", "qr-reader-content");
    this.contentHost = host;
    host.tabIndex = 0;
    host.setAttribute("aria-label", this.plugin.t("阅读正文；轻点中央或按 Escape 显示操作栏"));

    const bottom = el("div", "qr-reader-bottom");
    const chapters = el("div", "qr-reader-chapter-actions");
    const prevCh = el("button", "qr-btn", this.plugin.t("上一章"));
    prevCh.onclick = () => void this.stepChapter(-1);
    const nextCh = el("button", "qr-btn", this.plugin.t("下一章"));
    nextCh.onclick = () => void this.stepChapter(1);
    chapters.append(prevCh, nextCh);
    this.progressEl = el("span", "qr-progress");
    this.progressBar = document.createElement("progress");
    this.progressBar.max = 1;
    this.progressBar.setAttribute("aria-label", this.plugin.t("全书阅读进度"));
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
    dock.append(tocBtn, control(this.plugin.t("笔记"), "notebook-pen", () => this.openNotes()),
      control(this.plugin.t("字号"), "type", () => this.openReaderSettings()),
      control(this.plugin.t("背景"), "palette", () => this.openReaderSettings("theme")));
    bottom.append(meter, chapters, dock);
    const header = el("div", "qr-reader-header");
    header.append(top);
    if (refreshControls) root.append(header, bottom);
    else root.append(header, host, bottom);
    this.header = header;
    this.bottomBar = bottom;
    header.inert = bottom.inert = this.chromeHidden;

    // drawer + panels
    const mask = el("div", "qr-mask");
    mask.onclick = () => this.closePanels();
    const toc = el("div", "qr-drawer");
    const tocTitle = el("div", "qr-drawer-title", this.plugin.t("目录"));
    this.tocBody = el("div", "qr-drawer-body");
    toc.append(tocTitle, this.tocBody);
    this.tocPanel = toc;

    const card = el("div", "qr-annot-card qr-hidden");
    this.annotCard = card;
    const markMenu = el("div", "qr-mark-menu qr-hidden");
    markMenu.setAttribute("role", "group");
    markMenu.setAttribute("aria-label", this.plugin.t("选文操作"));
    markMenu.onmousedown = (event) => {
      // 保留 PDF 原生选区，同时允许按钮获得键盘焦点。
      event.preventDefault();
      (event.target as Element | null)?.closest<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    this.markMenu = markMenu;

    root.append(mask, toc, markMenu, card);
  }

  // ------------------------------------------------------------ open book

  async openBook(bookId: string): Promise<void> {
    if (!this.opened) return;
    const entry = this.plugin.library.get(bookId);
    if (!entry || !isHealthyBook(entry)) {
      new Notice(this.plugin.t("书籍不存在或记录已损坏"));
      return;
    }
    if (this.entry?.id === entry.id && this.engine) {
      await this.applyThemeClass();
      return;
    }
    this.engine?.flushVocabulary();
    const generation = ++this.generation;
    await Promise.allSettled([...this.vocabularyJobs]);
    if (!this.opened || generation !== this.generation) return;
    this.closePanels();
    await this.persistProgress(true);
    if (generation !== this.generation) return;
    const previous = this.entry;
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    this.engine?.destroy();
    this.engine = null;
    this.unsubVocabulary?.(); this.unsubVocabulary = null; this.vocabulary = null;
    this.entry = null;
    if (previous) await this.releaseSource(previous);
    if (generation !== this.generation) return;
    this.entry = entry;
    this.lastLoc = null;
    this.lastProgressSave = 0;
    this.draft = null;
    this.annotationSaving = false;
    this.markTarget = null;
    this.chromeHidden = true;
    this.mode = this.plugin.settings.reading.defaultMode;
    this.currentChapterId = entry.reading.progress.chapterId ?? null;
    this.tocNodes = null;
    this.buildSkeleton();
    this.applyThemeClass();
    this.renderTitle();
    this.renderProgress(entry.reading.progress.percent);
    this.contentHost.appendChild(el("div", "qr-empty qr-status", this.plugin.t("正在打开书籍……")));

    if (entry.reading.book.format !== "cbz") {
      const vocabulary = new VocabularyStore(new VaultFs(this.app.vault.adapter), `${entry.dir}/vocabulary.json`);
      try {
        await vocabulary.load();
        if (generation !== this.generation) return;
        this.vocabulary = vocabulary;
        this.unsubVocabulary = vocabulary.subscribe(() => this.updateVocabulary());
      } catch (error) { new Notice(this.plugin.t("生词文件无法读取：{0}", this.plugin.errorText(error))); }
    }

    try {
      const engine = await this.createEngine(entry);
      if (generation !== this.generation) {
        engine.destroy();
        return;
      }
      this.engine = engine;
      this.updateVocabulary();
      this.contentHost.empty();
      await engine.mount(this.contentHost);
    } catch (e) {
      if (generation !== this.generation) return;
      this.engine?.destroy();
      this.engine = null;
      this.contentHost.empty();
      this.contentHost.appendChild(el("div", "qr-empty", this.plugin.t("打开失败：{0}", this.plugin.errorText(e))));
      const retry = el("button", "qr-btn", this.plugin.t("重新打开"));
      retry.onclick = () => void this.openBook(bookId);
      this.contentHost.appendChild(retry);
      new Notice(this.plugin.t("打开书籍失败: {0}", this.plugin.errorText(e)));
      return;
    }
    if (generation !== this.generation) return;
    this.app.workspace.requestSaveLayout();
  }

  private async createEngine(entry: HealthyBookEntry): Promise<ReaderEngine> {
    const layout = this.plugin.settings.reading;
    const theme = this.resolvedTheme();
    const generation = this.generation;
    const hooks: EngineHooks = {
      onLocation: (loc) => { if (generation === this.generation) this.onEngineLocation(loc); },
      onSelect: (sel) => {
        if (generation !== this.generation) return;
        if (singleWord(sel.text)) this.openTranslation(sel.text, sel.paragraphId, sel);
        else this.openSelectionMenu(sel);
      },
      onWordExposure: (events) => {
        const store = this.vocabulary;
        if (generation !== this.generation || !store || !events.length) return;
        const job = store.expose(events, this.plugin.settings.translation.deletionThreshold)
          .catch((error) => { new Notice(this.plugin.t("生词保存失败：{0}", this.plugin.errorText(error))); })
          .finally(() => this.vocabularyJobs.delete(job));
        this.vocabularyJobs.add(job);
      },
      onAnnotationClick: (id, anchor) => { if (generation === this.generation) this.openMarkMenu(id, anchor); },
      onZoneTap: () => this.toggleChrome(),
      onSurfaceClick: () => this.closePanels(),
      onError: (error) => new Notice(this.plugin.t("阅读失败：{0}", this.plugin.errorText(error))),
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

  private updateVocabulary(): void {
    const settings = this.plugin.settings.translation;
    this.engine?.setVocabulary(this.vocabulary?.words ?? [], settings.highlight, settings.deletionThreshold);
  }
  private openTranslation(text: string, paragraphId?: string, selection?: EngineSelection): void {
    if (!this.entry || !this.engine || this.contentHost.inert || this.draft || this.annotationSaving) return;
    const word = singleWord(text);
    if (word) this.engine.noteVocabularyLookup(word, paragraphId);
    const generation = this.generation;
    const store = this.vocabulary;
    const sheet = this.createReadingSheet(word ? text : this.plugin.t("AI 翻译"), "qr-translation-sheet");
    const session = this.panelSession;
    const current = (): boolean => this.opened && generation === this.generation && session === this.panelSession && sheet.isConnected;
    let removed = false;
    let removing = false;
    let requestId = 0;
    const body = el("div", "qr-reading-sheet-body qr-translation-body");
    if (!word) body.appendChild(el("p", "qr-settings-status", this.plugin.t("使用当前 AI 服务译为中文，不加入生词表。")));
    const status = el("div", "qr-translation-result", this.plugin.t("正在翻译……"));
    status.setAttribute("aria-live", "polite");
    body.appendChild(status); sheet.appendChild(body);
    const appendSelectionAction = (): void => {
      if (!selection) return;
      const more = el("button", "qr-icon-btn");
      more.setAttribute("aria-label", this.plugin.t("选文操作")); more.title = this.plugin.t("选文操作"); setIcon(more, "more-horizontal");
      more.onclick = () => { if (current()) { this.closePanels(); this.openSelectionMenu(selection); } };
      body.appendChild(more);
    };
    const appendDeleteAction = (): void => {
      if (!word || !store || removed || !store.words.some((record) => record.word === word)) return;
      const button = el("button", "qr-icon-btn qr-translation-delete");
      button.setAttribute("aria-label", this.plugin.t("删除生词记录")); button.title = this.plugin.t("删除生词记录"); setIcon(button, "trash-2");
      button.onclick = async () => {
        if (!current() || removing) return;
        removing = true; button.disabled = true;
        try {
          await store.remove(word);
          removed = true;
          if (current()) { button.remove(); new Notice(this.plugin.t("已从本书生词表移除")); }
        } catch (error) {
          if (current()) { button.disabled = false; new Notice(this.plugin.t("生词删除失败：{0}", this.plugin.errorText(error))); }
        } finally { removing = false; }
      };
      body.appendChild(button);
    };
    const request = async (refresh = false): Promise<void> => {
      if (!current() || removing) return;
      const id = ++requestId;
      const latest = (): boolean => current() && id === requestId;
      status.setText(this.plugin.t("正在翻译……"));
      body.querySelectorAll("button,.qr-translation-phonetic").forEach((element) => element.remove());
      try {
        const cached = !refresh && word ? store?.words.find((record) => record.word === word) : undefined;
        const result = cached ? { query: text, translation: cached.translation, phonetic: cached.phonetic, audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cached.word)}&type=2` }
          : word ? await this.plugin.translation.lookup(text)
            : await translateSentence(getAiConfig(this.plugin.settings.ai), text, this.plugin.settings.language);
        if (!latest()) return;
        status.setText(result.translation);
        if (result.phonetic) body.prepend(el("div", "qr-translation-phonetic", `/${result.phonetic}/`));
        if (result.audioUrl) {
          const play = el("button", "qr-icon-btn qr-translation-audio");
          play.setAttribute("aria-label", this.plugin.t("播放发音")); play.title = this.plugin.t("播放发音"); setIcon(play, "volume-2");
          play.onclick = () => {
            if (!current()) return;
            this.translationAudio?.pause();
            const audio = new Audio(result.audioUrl); this.translationAudio = audio;
            void audio.play().catch(() => { if (current()) new Notice(this.plugin.t("发音播放失败，请刷新翻译后重试")); });
          };
          body.appendChild(play);
        }
        const retry = el("button", "qr-icon-btn qr-translation-refresh");
        retry.setAttribute("aria-label", this.plugin.t("刷新翻译")); retry.title = this.plugin.t("刷新翻译"); setIcon(retry, "refresh-cw");
        retry.onclick = () => { if (word) this.plugin.translation.clear(); void request(true); }; body.appendChild(retry);
        appendSelectionAction();
        if (word && store && !removed) {
          try { await store.lookup(result, paragraphId, this.plugin.settings.translation.autoAdd); }
          catch (error) { if (latest()) new Notice(this.plugin.t("生词保存失败：{0}", this.plugin.errorText(error))); }
        }
        if (latest()) appendDeleteAction();
      } catch (error) {
        if (!latest()) return;
        status.setText(this.plugin.errorText(error));
        const retry = el("button", "qr-icon-btn"); retry.setAttribute("aria-label", this.plugin.t("重试翻译")); setIcon(retry, "refresh-cw");
        retry.onclick = () => void request(); body.appendChild(retry);
        appendSelectionAction();
        appendDeleteAction();
      }
    };
    void request();
  }

  // ------------------------------------------------------------ engine events

  private onEngineLocation(loc: EngineLocation): void {
    const entry = this.entry;
    if (!entry) return;
    if (this.markTarget && this.lastLoc && (loc.cfi !== this.lastLoc.cfi ||
        loc.pdfPage !== this.lastLoc.pdfPage || loc.pageFraction !== this.lastLoc.pageFraction)) this.closeMarkMenu();
    this.lastLoc = loc;
    this.currentChapterId = loc.chapterId;
    this.renderTitle();
    this.renderProgress(loc.percent);
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    this.progressTimer = window.setTimeout(() => void this.persistProgress(true), 500);
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
      .catch((error: unknown) => new Notice(this.plugin.t("进度保存失败：{0}", this.plugin.errorText(error))));
  }

  private lastLoc: EngineLocation | null = null;

  private renderTitle(): void {
    const entry = this.entry;
    if (!entry) return;
    const ch = this.currentChapterId ? entry.reading.chapters[this.currentChapterId] : undefined;
    const chTitle = ch?.title ?? (entry.reading.book.format === "pdf" ? this.plugin.t("未分章") : "");
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
      ? this.plugin.t("第 {0} / {1} 页 · {2}%", page, this.entry?.reading.book.numPages ?? page, Math.round(percent * 100))
      : `${Math.round(percent * 100)}%`);
  }

  // ------------------------------------------------------------ chrome

  private toggleChrome(): void {
    if (this.draft) return;
    if (this.markTarget) {
      this.closeMarkMenu();
      return;
    }
    if (this.tocPanel.hasClass("qr-open") ||
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

  private applyThemeClass(): Promise<void> | undefined {
    const colors = this.resolvedTheme();
    this.root.toggleClass("qr-theme-dark", colors.dark);
    this.root.toggleClass("qr-theme-light", !colors.dark);
    this.root.style.setProperty("--qr-surface", colors.background);
    this.root.style.setProperty("--qr-reading-fg", colors.foreground);
    this.root.style.setProperty("--qr-reading-muted", colors.muted);
    if (this.engine) {
      return this.engine.applyLayout(this.plugin.settings.reading, colors)
        .catch((error: unknown) => { new Notice(this.plugin.t("布局更新失败：{0}", this.plugin.errorText(error))); });
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
      this.tocBody.appendChild(el("div", "qr-muted", this.plugin.t("正在加载目录……")));
      try {
        this.tocNodes = await this.plugin.library.getToc(entry);
      } catch (e) {
        this.tocBody.empty();
        this.tocBody.appendChild(el("div", "qr-muted", this.plugin.t("目录加载失败: {0}", e instanceof Error ? this.plugin.errorText(e) : "")));
        return;
      }
    }
    this.tocBody.empty();
    if (entry.reading.book.format === "pdf") this.buildPdfChapterTools();
    const nodes = this.tocNodes ?? [];
    if (nodes.length === 0 && entry.reading.book.format !== "pdf") {
      this.tocBody.appendChild(el("div", "qr-muted", this.plugin.t("本书没有可用目录")));
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
              .catch((error: unknown) => new Notice(this.plugin.t("跳转失败：{0}", this.plugin.errorText(error))));
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
    const title = el("div", "qr-chapter-tools-title", this.plugin.t("章节"));
    box.appendChild(title);
    const createBtn = el("button", "qr-btn qr-btn-ghost", this.plugin.t("新建章节"));
    createBtn.onclick = () => this.openChapterForm(undefined);
    const hereBtn = el("button", "qr-btn qr-btn-ghost", this.plugin.t("从当前页开始新章节"));
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
    const title = el("div", "qr-drawer-title", this.plugin.t("新建章节"));
    const nameInput = el("input", "qr-input") as HTMLInputElement;
    nameInput.placeholder = this.plugin.t("章节名称，如：第一章 创业");
    nameInput.setAttribute("aria-label", this.plugin.t("章节名称"));
    const startInput = el("input", "qr-input") as HTMLInputElement;
    startInput.type = "number";
    startInput.setAttribute("aria-label", this.plugin.t("起始页"));
    startInput.min = "1";
    startInput.max = String(numPages);
    startInput.value = String(startPage ?? Math.max(1, this.currentPageGuess()));
    const endInput = el("input", "qr-input") as HTMLInputElement;
    endInput.type = "number";
    endInput.setAttribute("aria-label", this.plugin.t("结束页"));
    endInput.min = "1";
    endInput.max = String(numPages);
    endInput.value = String(numPages);
    const row = el("div", "qr-form-row");
    row.append(startInput, endInput);
    const actions = el("div", "qr-form-actions");
    const cancel = el("button", "qr-btn", this.plugin.t("取消"));
    cancel.onclick = () => modal.remove();
    const ok = el("button", "qr-btn qr-btn-primary", this.plugin.t("创建"));
    ok.onclick = async () => {
      const name = nameInput.value.trim();
      const s = Number(startInput.value);
      const e2 = Number(endInput.value);
      if (!name) {
        new Notice(this.plugin.t("请填写章节名称"));
        return;
      }
      if (!(Number.isInteger(s) && Number.isInteger(e2) && s >= 1 && e2 >= s && e2 <= numPages)) {
        new Notice(this.plugin.t("页码范围无效（1–{0}）", numPages));
        return;
      }
      ok.disabled = true;
      try {
        await this.plugin.library.createPdfChapter(entry, name, s, e2);
        this.engine?.updateChapters?.(chaptersOrdered(entry.reading));
        this.tocNodes = null;
        modal.remove();
        new Notice(this.plugin.t("已创建章节：{0} (P{1}–P{2})", name, s, e2));
        void this.renderToc();
      } catch (error) {
        new Notice(this.plugin.t("创建失败：{0}", this.plugin.errorText(error)));
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

  private openMoreMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(this.mode === "paginated" ? this.plugin.t("切换为上下滚动") : this.plugin.t("切换为左右翻页"))
        .setIcon(this.mode === "paginated" ? "align-start-vertical" : "book-open")
        .onClick(async () => {
          if (!this.engine) return;
          const mode = this.mode === "paginated" ? "scrolled" : "paginated";
          try {
            await this.engine.setMode(mode);
            this.mode = mode;
            await this.persistProgress(true);
          } catch (error) {
            new Notice(this.plugin.t("模式切换失败：{0}", this.plugin.errorText(error)));
          }
        })
    );
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.plugin.t("阅读设置")).setIcon("sliders-horizontal").onClick(() => this.openReaderSettings()));
    menu.showAtMouseEvent(e);
  }

  private openReaderSettings(section: "type" | "theme" = "type"): void {
    const s = this.plugin.settings.reading;
    const box = this.createReadingSheet(section === "type" ? this.plugin.t("字号与排版") : this.plugin.t("阅读背景"));
    const body = el("div", "qr-reading-sheet-body");
    box.appendChild(body);
    if (section === "theme") {
      const themes: Record<ReadingTheme, string> = {
        light: this.plugin.t("纸白"), sepia: this.plugin.t("暖纸"), sage: this.plugin.t("青绿"), dark: this.plugin.t("夜间"), auto: this.plugin.t("跟随系统"),
      };
      const choices = el("div", "qr-theme-choices");
      for (const value in themes) {
        const theme = value as ReadingTheme;
        const button = el("button", "qr-theme-choice");
        button.setAttribute("aria-label", themes[theme]);
        button.setAttribute("aria-pressed", String(s.theme === theme));
        button.toggleClass("qr-theme-choice-active", s.theme === theme);
        const sample = el("span", "qr-theme-sample", this.plugin.t("文"));
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
      body.append(choices, el("p", "qr-reading-help", this.plugin.t("只改变阅读页配色；PDF 与图片书保留原始页面颜色。")));
    } else {
      if (this.engine?.reflowable) {
        body.appendChild(this.sliderRow(this.plugin.t("字号"), 12, 28, 1, s.fontSize, (value) => { s.fontSize = value; }));
        body.appendChild(this.sliderRow(this.plugin.t("行距"), 1.4, 2.4, 0.05, s.lineHeight, (value) => { s.lineHeight = value; }));
        body.appendChild(this.sliderRow(this.plugin.t("页边距"), 12, 48, 2, s.pageMargin, (value) => { s.pageMargin = value; }));
        body.appendChild(this.selectRow(this.plugin.t("字体"), { original: this.plugin.t("原书字体"), sans: this.plugin.t("系统黑体"), serif: this.plugin.t("系统宋体") },
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
        row.append(el("span", undefined, this.plugin.t("首行缩进")), indent);
        body.appendChild(row);
      } else {
        body.appendChild(el("p", "qr-reading-help", this.plugin.t("本书保留原始版式，字号、行距、字体和页边距不能重排。")));
      }
      body.appendChild(this.selectRow(this.plugin.t("翻页方式"), { paginated: this.plugin.t("左右翻页"), scrolled: this.plugin.t("上下滚动") },
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
        new Notice(this.plugin.t("设置更新失败：{0}", this.plugin.errorText(error)));
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
    this.header.inert = this.bottomBar.inert = true;
    this.root.querySelector(".qr-mask")?.addClass("qr-show");
    const sheet = el("section", `qr-reader-settings qr-reading-sheet ${extraClass}`);
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);
    const header = el("div", "qr-reading-sheet-header");
    const close = el("button", "qr-icon-btn");
    close.setAttribute("aria-label", this.plugin.t("关闭{0}", title));
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
      if (event.shiftKey && (focused === first || !sheet.contains(focused))) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (focused === last || !sheet.contains(focused))) { event.preventDefault(); first?.focus({ preventScroll: true }); }
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
      new Notice(this.plugin.t("阅读设置保存失败：{0}", this.plugin.errorText(error)));
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
    const sheet = this.createReadingSheet(this.plugin.t("笔记"), "qr-notes-sheet");
    sheet.appendChild(el("div", "qr-reading-sheet-body qr-notes-body"));
    this.renderNotes();
  }

  private renderNotes(): void {
    const body = this.root.querySelector<HTMLElement>(".qr-notes-body");
    const entry = this.entry;
    if (!body || !entry) return;
    body.empty();
    const all = el("button", "qr-btn qr-btn-sm", this.plugin.t("查看全部笔记"));
    all.onclick = async () => {
      const generation = this.generation;
      const panelSession = this.panelSession;
      all.disabled = true;
      try {
        await this.persistProgress(true);
        if (!this.opened || generation !== this.generation || panelSession !== this.panelSession) return;
        this.closePanels();
        await this.plugin.openNotes(entry.id, this.currentChapterId ?? undefined);
      } catch (error) { if (this.opened) new Notice(this.plugin.t("打开笔记失败：{0}", this.plugin.errorText(error))); }
      finally { all.disabled = false; }
    };
    body.appendChild(all);
    const currentChapter = this.currentChapterId ? entry.reading.chapters[this.currentChapterId] : undefined;
    const hasHistory = currentChapter && chapterNotes(currentChapter).length > 0;
    if (hasHistory) {
      const history = el("details", "qr-history-item");
      history.appendChild(el("summary", "qr-history-row", this.plugin.t("历史阅读记录")));
      history.appendChild(renderNoteHistory(this.plugin, currentChapter));
      body.appendChild(history);
    }
    const records = entry.reading.annotations.slice().sort((a, b) =>
      (entry.reading.chapters[a.chapterId]?.index ?? 0) - (entry.reading.chapters[b.chapterId]?.index ?? 0) ||
      a.sortKey - b.sortKey);
    if (records.length === 0 && !hasHistory) {
      body.appendChild(el("div", "qr-empty", entry.reading.book.format === "cbz"
        ? this.plugin.t("图片书没有文字层，不能添加文字批注。")
        : this.plugin.t("还没有笔记。选择正文可以划线，也可以写下自己的理解。")));
      return;
    }
    let chapterId: string | null = null;
    for (const record of records) {
      if (chapterId !== record.chapterId) {
        chapterId = record.chapterId;
        body.appendChild(el("h3", "qr-note-chapter", entry.reading.chapters[chapterId]?.title ?? this.plugin.t("未分章")));
      }
      const note = el("article", "qr-reading-note");
      note.appendChild(el("div", "qr-note-meta", `${record.kind === "highlight" ? this.plugin.t("划线") : this.plugin.t("批注")} · ${fmtDateTime(record.createdAt)}`));
      note.appendChild(el("blockquote", "qr-note-quote", record.text));
      if (record.note) note.appendChild(el("p", "qr-note-understanding", record.note));
      if (record.aiExplanation) {
        const explanation = el("details", "qr-note-ai");
        explanation.append(el("summary", undefined, this.plugin.t("已收录的 AI 解释")), el("p", undefined, record.aiExplanation));
        note.appendChild(explanation);
      }
      const actions = el("div", "qr-note-actions");
      const jump = el("button", "qr-btn qr-btn-sm", this.plugin.t("回到原文"));
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
          new Notice(this.plugin.t("批注定位失败：{0}", this.plugin.errorText(error)));
        } finally { jump.disabled = false; }
      };
      const edit = el("button", "qr-btn qr-btn-sm", record.kind === "highlight" ? this.plugin.t("写批注") : this.plugin.t("编辑批注"));
      edit.onclick = () => { this.closePanels(); this.openAnnotationEdit(record.id); };
      const remove = el("button", "qr-btn qr-btn-sm", this.plugin.t("删除笔记"));
      remove.disabled = this.deletingNoteId !== null;
      remove.onclick = () => this.confirmDeleteNote(record, note, actions);
      actions.append(jump, edit, remove);
      note.appendChild(actions);
      body.appendChild(note);
      if (this.confirmingNoteId === record.id && !this.deletingNoteId) this.confirmDeleteNote(record, note, actions, false);
    }
  }

  private confirmDeleteNote(record: AnnotationRecord, note: HTMLElement, actions: HTMLElement, focus = true): void {
    if (this.deletingNoteId) return;
    this.confirmingNoteId = record.id;
    actions.empty();
    const warning = el("p", "qr-note-delete-warning", this.plugin.t("删除后将同时移除划线、批注和已收录的 AI 解读，无法撤销。"));
    warning.setAttribute("role", "alert");
    note.insertBefore(warning, actions);
    const cancel = el("button", "qr-btn qr-btn-sm", this.plugin.t("取消"));
    cancel.onclick = () => {
      this.confirmingNoteId = null;
      this.renderNotes();
      this.root.querySelector<HTMLButtonElement>(".qr-notes-sheet .qr-icon-btn")?.focus({ preventScroll: true });
    };
    const confirm = el("button", "qr-btn qr-btn-sm qr-btn-danger", this.plugin.t("确认删除笔记"));
    confirm.onclick = async () => {
      const entry = this.entry;
      const engine = this.engine;
      const generation = this.generation;
      const panelSession = this.panelSession;
      if (!entry || this.deletingNoteId) return;
      this.deletingNoteId = record.id;
      this.confirmingNoteId = null;
      confirm.disabled = cancel.disabled = true;
      try {
        await this.plugin.library.deleteAnnotation(entry, record.id);
        if (!this.opened || generation !== this.generation) return;
        if (this.engine === engine) engine?.removeHighlight(record);
        if (panelSession === this.panelSession) new Notice(this.plugin.t("笔记已删除"));
      } catch (error) {
        if (this.opened && generation === this.generation && panelSession === this.panelSession) {
          new Notice(this.plugin.t("删除笔记失败：{0}", this.plugin.errorText(error)));
        }
      } finally {
        this.deletingNoteId = null;
        if (this.opened && generation === this.generation && panelSession === this.panelSession) {
          this.renderNotes();
          this.root.querySelector<HTMLButtonElement>(".qr-notes-sheet .qr-icon-btn")?.focus({ preventScroll: true });
        }
      }
    };
    actions.append(cancel, confirm);
    if (focus) cancel.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ navigation


  private async stepChapter(dir: 1 | -1): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    const chapters = Object.entries(entry.reading.chapters).sort((a, b) => a[1].index - b[1].index);
    if (chapters.length === 0) {
      new Notice(this.plugin.t("本书还没有章节"));
      return;
    }
    let index = chapters.findIndex(([id]) => id === this.currentChapterId);
    if (index < 0) index = 0;
    const [id, chapter] = chapters[Math.max(0, Math.min(chapters.length - 1, index + dir))];
    try {
      await this.engine?.goToChapter(id, chapter.href);
    } catch (error) {
      new Notice(this.plugin.t("章节跳转失败：{0}", this.plugin.errorText(error)));
    }
  }

  // ------------------------------------------------------------ annotations

  private openSelectionMenu(selection: EngineSelection): void {
    if (!this.entry || this.entry.reading.book.format === "cbz" || this.draft || this.annotationSaving || this.contentHost.inert) return;
    const record = this.entry.reading.annotations.find((record) =>
      selection.cfi ? record.cfi === selection.cfi :
        record.pdfPage === selection.pdfPage && record.itemRanges?.length === selection.itemRanges?.length &&
        record.itemRanges?.every((range, index) => {
          const selected = selection.itemRanges?.[index];
          return selected?.item === range.item && selected.start === range.start && selected.end === range.end;
        })
    );
    this.closePanels();
    this.markTarget = { record, selection, anchor: selection.anchor, color: record?.color ?? (record ? "yellow" : this.plugin.settings.highlightColor) };
    this.renderMarkMenu();
  }

  private openMarkMenu(id: string, anchor?: SelectionAnchor): void {
    if (!this.entry || this.entry.reading.book.format === "cbz" || this.draft || this.annotationSaving || this.contentHost.inert) return;
    const record = this.entry.reading.annotations.find((record) => record.id === id);
    if (!record) return;
    this.closePanels();
    this.markTarget = { record, anchor, color: record.color ?? "yellow" };
    this.renderMarkMenu();
  }

  private closeMarkMenu(clearSelection = true): void {
    this.cancelHighlightPress?.();
    this.cancelHighlightPress = null;
    this.markTarget = null;
    this.markMenu.empty();
    this.markMenu.addClass("qr-hidden");
    if (clearSelection) this.engine?.clearSelection();
  }

  private renderMarkMenu(): void {
    this.cancelHighlightPress?.();
    this.cancelHighlightPress = null;
    const target = this.markTarget;
    const menu = this.markMenu;
    menu.empty();
    if (!target) {
      menu.addClass("qr-hidden");
      return;
    }
    menu.removeClass("qr-hidden");
    const addAction = (label: string, icon: string, action: () => void, container = menu): HTMLButtonElement => {
      const button = el("button", "qr-icon-btn");
      button.title = label;
      button.setAttribute("aria-label", label);
      setIcon(button, icon);
      button.disabled = this.annotationSaving;
      button.onclick = action;
      container.appendChild(button);
      return button;
    };
    const record = target.record;
    const selection = target.selection ?? (record ? {
      text: record.text, chapterId: record.chapterId, cfi: record.cfi,
      pdfPage: record.pdfPage, itemRanges: record.itemRanges, sortKey: record.sortKey,
    } : undefined);
    if (selection) {
      addAction(this.plugin.t("复制"), "copy", () => void this.copySelection(selection, target));
      addAction(this.plugin.t(singleWord(selection.text) ? "查词" : "AI 翻译"), "languages", () => this.openTranslation(selection.text, selection.paragraphId));
    }
    if (record || target.selection) this.appendHighlightControl(menu, target);
    if (record) {
      addAction(record.kind === "highlight" ? this.plugin.t("批注") : this.plugin.t("编辑批注"), "square-pen", () => this.openAnnotationEdit(record.id));
      const actions = el("div", "qr-mark-secondary qr-mark-options");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", this.plugin.t("更多标记操作"));
      actions.hidden = !target.actionsOpen;
      const more = addAction(this.plugin.t("更多标记操作"), "more-horizontal", () => {
        target.actionsOpen = !target.actionsOpen;
        target.colorsOpen = false;
        this.renderMarkMenu();
      });
      more.dataset.action = "mark-options";
      more.setAttribute("aria-expanded", String(Boolean(target.actionsOpen)));
      if (selection) addAction(this.plugin.t("AI 解读"), "sparkles", () => this.openSelectionExplanation(selection, record, target.color), actions);
      const remove = addAction(target.confirmDelete ? this.plugin.t("确认取消画线及批注") : this.plugin.t("取消画线"), target.confirmDelete ? "circle-check" : "trash-2", () => {
        if (record.kind !== "highlight" && (record.note || record.aiExplanation) && !target.confirmDelete) {
          target.confirmDelete = true;
          target.actionsOpen = true;
          this.renderMarkMenu();
        } else {
          void this.removeMark(target, false);
        }
      }, actions);
      remove.addClass("qr-mark-danger");
      if (record.kind !== "highlight") addAction(this.plugin.t("取消批注"), "eraser", () => void this.removeMark(target, true), actions);
      addAction(this.plugin.t("关闭选文菜单"), "x", () => this.closeMarkMenu(), actions);
      menu.appendChild(actions);
    } else if (target.selection) {
      const selection = target.selection;
      addAction(this.plugin.t("批注"), "square-pen", () => this.openAnnotationCreate(selection, target.color));
      const actions = el("div", "qr-mark-secondary qr-mark-options");
      actions.hidden = !target.actionsOpen;
      actions.setAttribute("role", "group"); actions.setAttribute("aria-label", this.plugin.t("更多标记操作"));
      const more = addAction(this.plugin.t("更多标记操作"), "more-horizontal", () => {
        target.actionsOpen = !target.actionsOpen; target.colorsOpen = false; this.renderMarkMenu();
      });
      more.dataset.action = "mark-options"; more.setAttribute("aria-expanded", String(Boolean(target.actionsOpen)));
      addAction(this.plugin.t("AI 解读"), "sparkles", () => this.openSelectionExplanation(selection, undefined, target.color), actions);
      addAction(this.plugin.t("关闭选文菜单"), "x", () => this.closeMarkMenu(), actions);
      menu.appendChild(actions);
    }
    this.positionMarkMenu(target);
  }

  private positionMarkMenu(target: MarkTarget): void {
    const menu = this.markMenu;
    const root = this.root.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const anchor = target.anchor;
    const edge = Math.max(2, Math.min(8, (root.width - box.width) / 2));
    const left = anchor ? (anchor.left + anchor.right) / 2 - root.left - box.width / 2 : (root.width - box.width) / 2;
    const above = anchor ? anchor.top - root.top - box.height - 8 : root.height / 2 - box.height;
    const top = above >= 8 ? above : (anchor?.bottom ?? root.top) - root.top + 8;
    menu.style.left = `${Math.max(edge, Math.min(left, root.width - box.width - edge))}px`;
    menu.style.top = `${Math.max(8, Math.min(top, root.height - box.height - 8))}px`;
    for (const secondary of menu.querySelectorAll<HTMLElement>(".qr-mark-secondary")) {
      if (secondary.hidden) continue;
      const below = parseFloat(menu.style.top) + box.height + secondary.offsetHeight + 8 <= root.height - 8;
      secondary.classList.toggle("qr-mark-secondary-above", !below);
    }
  }

  private appendHighlightControl(menu: HTMLElement, target: MarkTarget): void {
    const confirm = el("button", "qr-icon-btn qr-highlight-confirm");
    const indicator = el("span", "qr-highlight-indicator");
    indicator.setAttribute("aria-hidden", "true");
    confirm.appendChild(indicator);
    confirm.setAttribute("aria-expanded", String(Boolean(target.colorsOpen)));
    confirm.setAttribute("aria-keyshortcuts", "ArrowDown");
    confirm.disabled = this.annotationSaving;
    menu.appendChild(confirm);
    const palette = el("div", "qr-mark-secondary qr-highlight-palette");
    palette.setAttribute("role", "group");
    palette.setAttribute("aria-label", this.plugin.t("待确认划线颜色"));
    palette.hidden = !target.colorsOpen;
    const choices = new Map<HighlightColor, HTMLButtonElement>();
    const update = (): void => {
      const color = HIGHLIGHT_COLORS[target.color];
      indicator.style.setProperty("--qr-highlight-fill", color.fill);
      indicator.style.setProperty("--qr-highlight-edge", color.edge);
      const label = this.plugin.t("{0}：{1}；长按或按方向下键选择颜色", target.record ? this.plugin.t("应用划线颜色") : this.plugin.t("保存划线"), this.plugin.t(color.label));
      confirm.setAttribute("aria-label", label);
      confirm.title = label;
      for (const [colorId, button] of choices) {
        button.setAttribute("aria-pressed", String(colorId === target.color));
      }
    };
    for (const colorId of Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]) {
      const color = HIGHLIGHT_COLORS[colorId];
      const choice = el("button", "qr-icon-btn qr-highlight-color");
      choice.disabled = this.annotationSaving;
      choice.setAttribute("aria-label", this.plugin.t("{0}划线", this.plugin.t(color.label)));
      choice.title = this.plugin.t("{0}划线", this.plugin.t(color.label));
      choice.style.setProperty("--qr-highlight-fill", color.fill);
      choice.style.setProperty("--qr-highlight-edge", color.edge);
      choice.onclick = () => {
        if (this.markTarget !== target || this.annotationSaving) return;
        target.color = colorId;
        update();
      };
      choices.set(colorId, choice);
      palette.appendChild(choice);
    }
    menu.appendChild(palette);
    const toggleColors = (open: boolean): void => {
      if (!this.opened || this.markTarget !== target || this.annotationSaving) return;
      target.colorsOpen = open;
      target.actionsOpen = false;
      menu.querySelector<HTMLElement>(".qr-mark-options")?.setAttribute("hidden", "");
      menu.querySelector<HTMLButtonElement>('[data-action="mark-options"]')?.setAttribute("aria-expanded", "false");
      palette.hidden = !open;
      confirm.setAttribute("aria-expanded", String(open));
      this.positionMarkMenu(target);
    };
    let timer: number | null = null;
    let pointer: number | null = null;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;
    const stopPress = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      const captured = pointer;
      pointer = null;
      if (captured !== null && confirm.hasPointerCapture(captured)) confirm.releasePointerCapture(captured);
    };
    this.cancelHighlightPress = stopPress;
    confirm.onpointerdown = (event) => {
      if (!event.isPrimary || event.button !== 0 || this.annotationSaving || this.markTarget !== target) return;
      stopPress();
      suppressClick = false;
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      confirm.setPointerCapture(event.pointerId);
      timer = window.setTimeout(() => {
        timer = null;
        if (pointer === null || this.markTarget !== target || !this.opened) return;
        suppressClick = true;
        toggleColors(true);
      }, 450);
    };
    confirm.onpointermove = (event) => {
      if (pointer !== event.pointerId || Math.hypot(event.clientX - startX, event.clientY - startY) <= 8) return;
      suppressClick = true;
      stopPress();
    };
    confirm.onpointerup = (event) => { if (pointer === event.pointerId) stopPress(); };
    confirm.onpointercancel = (event) => {
      if (pointer === event.pointerId) { suppressClick = true; stopPress(); }
    };
    confirm.onlostpointercapture = () => {
      if (pointer !== null) { suppressClick = true; stopPress(); }
    };
    confirm.oncontextmenu = (event) => {
      event.preventDefault();
      stopPress();
      toggleColors(true);
    };
    confirm.onkeydown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        stopPress();
        toggleColors(true);
        choices.get(target.color)?.focus({ preventScroll: true });
      }
      if (event.key === "Enter" || event.key === " ") { stopPress(); suppressClick = false; }
    };
    palette.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        toggleColors(false);
        confirm.focus({ preventScroll: true });
      }
    };
    confirm.onclick = (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      if (this.markTarget === target) void this.highlightSelection(target);
    };
    update();
  }

  private async copySelection(selection: EngineSelection, target: MarkTarget): Promise<void> {
    const generation = this.generation;
    try {
      const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error(this.plugin.t("当前环境不支持剪贴板，请使用系统复制操作"));
      await clipboard.writeText(selection.copyText ?? selection.text);
      if (this.opened && generation === this.generation && this.markTarget === target) new Notice(this.plugin.t("已复制选文"));
    } catch (error) {
      if (this.opened && generation === this.generation && this.markTarget === target) {
        new Notice(this.plugin.t("复制失败：{0}", this.plugin.errorText(error)));
      }
    }
  }

  private openSelectionExplanation(selection: EngineSelection, record?: AnnotationRecord, color = this.plugin.settings.highlightColor): void {
    const entry = this.entry;
    const engine = this.engine;
    if (!entry || !engine || entry.reading.book.format === "cbz") return;
    const chapterId = selection.chapterId ?? this.currentChapterId ?? "";
    const generation = this.generation;
    const sheet = this.createReadingSheet(this.plugin.t("AI 解读"), "qr-explanation-sheet");
    const panelSession = this.panelSession;
    const current = (): boolean => this.opened && this.generation === generation &&
      this.panelSession === panelSession && sheet.isConnected;
    const body = el("div", "qr-reading-sheet-body");
    const quote = el("blockquote", "qr-note-quote qr-explanation-quote", selection.text);
    const result = el("div", "qr-explanation-result");
    result.setAttribute("aria-live", "polite");
    const actions = el("div", "qr-ai-actions");
    const retry = el("button", "qr-btn", this.plugin.t("重试解读"));
    const save = el("button", "qr-btn qr-btn-primary", this.plugin.t("存入笔记"));
    let text = "";
    let loading = false;
    let saving = false;
    let saved = false;
    save.disabled = true;
    body.append(quote, result, actions, el("p", "qr-reading-help", this.plugin.t("AI 解读仅供参考。只有点击「存入笔记」才会保存。")));
    actions.append(retry, save);
    sheet.appendChild(body);
    const request = async (): Promise<void> => {
      if (loading || saving || !current()) return;
      loading = true;
      retry.disabled = save.disabled = true;
      result.setText(this.plugin.t("正在结合上下文解读……"));
      result.setAttribute("aria-busy", "true");
      try {
        let context = { before: "", after: "" };
        try { context = await engine.getSelectionContext(selection); } catch { /* 上下文为尽力读取，选文始终保留。 */ }
        if (!current()) return;
        const explanation = await explainSelection(getAiConfig(this.plugin.settings.ai),
          entry.reading.book.title, entry.reading.chapters[chapterId]?.title ?? "", selection.text, context, this.plugin.settings.language);
        if (!current()) return;
        text = explanation;
        result.setText(text);
        retry.setText(this.plugin.t("重新解读"));
        save.disabled = saved || !chapterId;
      } catch (error) {
        if (!current()) return;
        text = "";
        result.setText(this.plugin.t("解读失败：{0}", this.plugin.errorText(error)));
        retry.setText(this.plugin.t("重试解读"));
      } finally {
        if (current()) {
          loading = false;
          retry.disabled = false;
          result.setAttribute("aria-busy", "false");
        }
      }
    };
    retry.onclick = () => void request();
    save.onclick = async () => {
      if (!text || saved || saving || loading || !current()) return;
      saving = true;
      save.disabled = retry.disabled = true;
      try {
        if (record) {
          if (!entry.reading.annotations.some((annotation) => annotation.id === record.id)) throw new Error(this.plugin.t("原笔记已删除，请重新选择原文"));
          await this.plugin.library.updateAnnotation(entry, record.id, { kind: "annotation", aiExplanation: text });
        } else await this.saveSelection(selection, "annotation", undefined, text, color);
        if (!current()) return;
        saved = true;
        save.setText(this.plugin.t("已存入笔记"));
        new Notice(this.plugin.t("AI 解读已存入笔记"));
      } catch (error) {
        if (current()) new Notice(this.plugin.t("保存失败：{0}", this.plugin.errorText(error)));
      } finally {
        if (current()) {
          saving = false;
          save.disabled = saved;
          retry.disabled = saved;
        }
      }
    };
    void request();
  }

  private async highlightSelection(target: MarkTarget): Promise<void> {
    const entry = this.entry;
    const engine = this.engine;
    const generation = this.generation;
    if (!entry || (!target.selection && !target.record) || this.annotationSaving || this.markTarget !== target) return;
    this.annotationSaving = true;
    this.renderMarkMenu();
    try {
      if (target.record) {
        await this.plugin.library.updateAnnotation(entry, target.record.id, { color: target.color });
        if (!this.opened || generation !== this.generation) return;
        const updated = entry.reading.annotations.find((record) => record.id === target.record?.id);
        if (!updated) throw new Error(this.plugin.t("原标记已删除，请重新选择原文"));
        if (this.engine === engine) engine?.addHighlight(updated);
        await this.rememberHighlightColor(target.color, generation);
      } else if (target.selection) {
        await this.saveSelection(target.selection, "highlight", undefined, undefined, target.color);
      }
      if (this.opened && generation === this.generation && this.markTarget === target) this.closeMarkMenu();
    } catch (error) {
      if (this.opened && generation === this.generation && this.markTarget === target) {
        new Notice(this.plugin.t("划线保存失败：{0}", this.plugin.errorText(error)));
      }
    } finally {
      if (generation === this.generation) {
        this.annotationSaving = false;
        if (this.opened && this.markTarget === target) this.renderMarkMenu();
      }
    }
  }

  private async removeMark(target: MarkTarget, commentOnly: boolean): Promise<void> {
    const entry = this.entry;
    const record = target.record;
    const engine = this.engine;
    const generation = this.generation;
    if (!entry || !record || this.annotationSaving) return;
    this.annotationSaving = true;
    this.renderMarkMenu();
    try {
      if (commentOnly) await this.plugin.library.clearAnnotation(entry, record.id);
      else await this.plugin.library.deleteAnnotation(entry, record.id);
      if (!this.opened || generation !== this.generation) return;
      if (!commentOnly && this.engine === engine) engine?.removeHighlight(record);
      if (this.markTarget === target) this.closeMarkMenu();
    } catch (error) {
      if (this.opened && generation === this.generation && this.markTarget === target) {
        new Notice(this.plugin.t("{0}失败：{1}", commentOnly ? this.plugin.t("取消批注") : this.plugin.t("取消画线"), this.plugin.errorText(error)));
      }
    } finally {
      if (generation === this.generation) {
        this.annotationSaving = false;
        if (this.opened && this.markTarget === target) this.renderMarkMenu();
      }
    }
  }

  private async saveSelection(selection: EngineSelection, kind: "highlight" | "annotation", note?: string, aiExplanation?: string, color = this.plugin.settings.highlightColor): Promise<void> {
    const entry = this.entry;
    const engine = this.engine;
    const generation = this.generation;
    const chapterId = selection.chapterId ?? this.currentChapterId;
    if (!entry || !chapterId) throw new Error(this.plugin.t("当前不在章节中，请先从目录创建或选择章节"));
    const record = await this.plugin.library.saveAnnotation(entry, {
      id: genId("a"), chapterId, kind, color, text: selection.text, note, aiExplanation,
      cfi: selection.cfi, pdfPage: selection.pdfPage, itemRanges: selection.itemRanges,
      sortKey: selection.sortKey ?? 0,
    });
    if (!this.opened || generation !== this.generation) return;
    if (this.engine === engine) engine?.addHighlight(record);
    await this.rememberHighlightColor(color, generation);
  }

  private async rememberHighlightColor(color: HighlightColor, generation: number): Promise<void> {
    if (!this.opened || generation !== this.generation || this.plugin.settings.highlightColor === color) return;
    this.plugin.settings.highlightColor = color;
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      if (this.opened && generation === this.generation) {
        new Notice(this.plugin.t("标记已保存，但默认划线颜色保存失败：{0}", this.plugin.errorText(error)));
      }
    }
  }

  private openAnnotationCreate(sel: EngineSelection, color = this.plugin.settings.highlightColor): void {
    const entry = this.entry;
    if (!entry) return;
    const chapterId = sel.chapterId ?? this.currentChapterId;
    if (!chapterId) {
      new Notice(this.plugin.t("当前不在章节中，无法批注"));
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
      color,
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
      color: record.color ?? "yellow",
    };
    this.renderAnnotationCard();
  }

  private renderAnnotationCard(): void {
    const draft = this.draft;
    const entry = this.entry;
    const generation = this.generation;
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

    card.appendChild(el("div", "qr-annot-title", draft.mode === "create" ? this.plugin.t("批注") : this.plugin.t("编辑批注")));
    card.appendChild(quote);

    const noteLabel = el("label", "qr-label", this.plugin.t("我的理解"));
    const note = document.createElement("textarea");
    note.className = "qr-textarea";
    note.id = "qr-annotation-note";
    noteLabel.setAttribute("for", note.id);
    note.rows = 3;
    note.placeholder = this.plugin.t("用自己的话写下对这段内容的理解（可留空）");
    note.value = draft.note;
    note.oninput = () => {
      if (this.draft) this.draft.note = note.value;
    };
    card.append(noteLabel, note);

    const aiLabel = el("label", "qr-label", this.plugin.t("AI 解释"));
    const aiArea = el("div", "qr-ai-area");
    card.append(aiLabel, aiArea);
    this.renderAiArea(aiArea);

    const actions = el("div", "qr-annot-actions");
    const cancel = el("button", "qr-btn", this.plugin.t("取消"));
    cancel.onclick = () => {
      this.draft = null;
      this.renderAnnotationCard();
    };
    const save = el("button", "qr-btn qr-btn-primary", this.plugin.t("保存"));
    save.disabled = draft.aiLoading || this.annotationSaving;
    save.onclick = async () => {
      if (!this.opened || generation !== this.generation || this.draft !== draft || this.annotationSaving) return;
      this.annotationSaving = true;
      save.disabled = true;
      try {
        await this.saveAnnotation();
      } catch (error) {
        if (this.opened && generation === this.generation && this.draft === draft) {
          new Notice(this.plugin.t("批注保存失败：{0}", this.plugin.errorText(error)));
        }
      } finally {
        if (generation === this.generation) this.annotationSaving = false;
        if (this.opened && generation === this.generation && this.draft === draft && save.isConnected) save.disabled = false;
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
      aiArea.appendChild(el("div", "qr-muted qr-pulse", this.plugin.t("AI 正在解释……")));
      return;
    }
    if (!draft.aiText) {
      const btn = el("button", "qr-btn qr-btn-ghost", this.plugin.t("AI 解释"));
      btn.onclick = () => void this.requestAiExplanation();
      aiArea.appendChild(btn);
      aiArea.appendChild(
        el("div", "qr-muted qr-tiny", this.plugin.t("读不懂这段内容时，可以让 AI 结合上下文解释"))
      );
      return;
    }
    const text = el("div", "qr-annot-ai-text");
    text.setText(draft.aiText);
    aiArea.appendChild(text);
    const btnRow = el("div", "qr-ai-actions");
    const regen = el("button", "qr-btn qr-btn-sm", this.plugin.t("重新生成"));
    regen.onclick = () => void this.requestAiExplanation();
    const toggle = el(
      "button",
      `qr-btn qr-btn-sm ${draft.aiIncluded ? "qr-btn-primary" : ""}`,
      draft.aiIncluded ? this.plugin.t("✓ 已收录") : this.plugin.t("收录")
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
    const generation = this.generation;
    const engine = this.engine;
    if (!draft || !entry || entry.reading.book.format === "cbz") return;
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
        context = await engine?.getSelectionContext(sel) ?? { before: "", after: "" };
      } catch {
        /* context is best-effort */
      }
      if (!this.opened || generation !== this.generation || this.draft !== draft) return;
      const ch = entry.reading.chapters[draft.chapterId];
      const text = await explainSelection(
        getAiConfig(this.plugin.settings.ai),
        entry.reading.book.title,
        ch?.title ?? "",
        sel.text,
        context,
        this.plugin.settings.language
      );
      if (this.opened && generation === this.generation && this.draft === draft) {
        draft.aiText = text;
        draft.aiIncluded = draft.mode === "edit" ? draft.aiIncluded : true;
        draft.aiLoading = false;
        this.renderAnnotationCard();
      }
    } catch (e) {
      if (this.opened && generation === this.generation && this.draft === draft) {
        draft.aiLoading = false;
        this.renderAnnotationCard();
        new Notice(this.plugin.t("AI 解释失败: {0}", this.plugin.errorText(e)));
      }
    }
  }

  private async saveAnnotation(): Promise<void> {
    const draft = this.draft;
    const entry = this.entry;
    const generation = this.generation;
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
      await this.saveSelection(draft.selection, "annotation", note, ai, draft.color);
    }
    if (!this.opened || generation !== this.generation || this.draft !== draft) return;
    this.draft = null;
    this.renderAnnotationCard();
  }

  // ------------------------------------------------------------ panels

  private closePanels(): void {
    this.translationAudio?.pause(); this.translationAudio = null;
    ++this.panelSession;
    this.confirmingNoteId = null;
    this.closeMarkMenu(false);
    this.tocPanel.removeClass("qr-open");
    this.root.querySelector(".qr-mask")?.removeClass("qr-show");
    this.contentHost.inert = false;
    this.header.inert = this.bottomBar.inert = this.chromeHidden;
    const trigger = this.panelTrigger;
    this.panelTrigger = null;
    this.root.querySelectorAll(".qr-reader-settings").forEach((n) => n.remove());
    this.root.querySelectorAll(".qr-modal-form").forEach((n) => n.remove());
    if (this.opened) {
      const focusTarget = trigger?.isConnected && !trigger.closest("[inert]") && !this.markMenu.contains(trigger)
        ? trigger : this.contentHost;
      if (trigger) focusTarget.focus({ preventScroll: true });
    }
  }

  private onLibraryDataChanged(): void {
    const entry = this.entry;
    if (!entry) return;
    const fresh = this.plugin.library.get(entry.id);
    if (!fresh || !isHealthyBook(fresh) || fresh.dir !== entry.dir) {
      ++this.generation;
      this.closePanels();
      this.draft = null;
      this.renderAnnotationCard();
      this.engine?.destroy();
      this.engine = null;
      this.unsubVocabulary?.(); this.unsubVocabulary = null; this.vocabulary = null;
      this.entry = null;
      this.contentHost.empty();
      this.contentHost.appendChild(el("div", "qr-empty", this.plugin.t("书籍已移除或记录损坏，请返回书架处理")));
      return;
    }
    this.entry = fresh;
    this.engine?.updateChapters?.(chaptersOrdered(fresh.reading));
    this.renderNotes();
  }
}
