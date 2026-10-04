// QReader — Read with Questions. Plugin entry: views, commands, ribbon, events.

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS, validateLibraryPath } from "./settings";
import type { QReaderSettings } from "./settings";
import { getAiConfig, loadAiSettings } from "./ai/providers";
import { BookCache } from "./core/book-source";
import { LibraryManager } from "./core/library";
import { BookshelfView, VIEW_TYPE_BOOKSHELF } from "./views/bookshelf";
import { ReaderView, VIEW_TYPE_READER } from "./views/reader";
import { AnswerView, VIEW_TYPE_ANSWER } from "./views/answer";
import { NotesView, VIEW_TYPE_NOTES, LEGACY_REVIEW_VIEW } from "./views/notes";
import { QReaderSettingTab } from "./settings-tab";
import { localizeMessage, localizedError, normalizeLanguage, translate } from "./i18n";
import type { MessageKey } from "./i18n";
import { loadTranslationSettings, YoudaoClient } from "./translation/youdao";

export type SettingsChangeReason = "settings" | "language" | "translation";

// Obsidian's native settings controller is not exposed by its public typings.
interface AppSettingsAccess extends App {
  setting: { open(): void; openTabById(id: string): void };
}

// Host method verified in Obsidian; absent from its public type declarations.
interface LeafHeaderAccess extends WorkspaceLeaf {
  updateHeader(): void;
}

export class QReaderPlugin extends Plugin {
  declare settings: QReaderSettings;
  library!: LibraryManager;
  cache!: BookCache;
  translation = new YoudaoClient();
  private libraryListeners = new Set<() => void>();
  private settingsListeners = new Set<(reason: SettingsChangeReason) => void>();
  private ribbon: HTMLElement | null = null;
  private immersiveDocuments = new Set<Document>();
  private pageStates = new Map<string, Record<string, unknown>>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.cache = new BookCache(this.app.vault.adapter);
    this.library = new LibraryManager(
      {
        app: this.app,
        libraryPath: () => this.settings.libraryPath,
        aiConfig: () => getAiConfig(this.settings.ai),
        questionPrompt: () => this.settings.questionPrompt,
        language: () => this.settings.language,
        configDir: this.app.vault.configDir,
        pluginId: this.manifest.id,
        notifyChanged: () => this.notifyChanged(),
      },
      this.cache
    );

    this.registerView(VIEW_TYPE_BOOKSHELF, (leaf) => new BookshelfView(leaf, this));
    this.registerView(VIEW_TYPE_READER, (leaf) => new ReaderView(leaf, this));
    this.registerView(VIEW_TYPE_ANSWER, (leaf) => new AnswerView(leaf, this));
    this.registerView(VIEW_TYPE_NOTES, (leaf) => new NotesView(leaf, this));
    this.registerView(LEGACY_REVIEW_VIEW, (leaf) => new NotesView(leaf, this, LEGACY_REVIEW_VIEW));

    this.ribbon = this.addRibbonIcon("book-open", this.t("QReader 书架"), () => void this.openBookshelf());
    this.registerCommands();

    this.addSettingTab(new QReaderSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("css-change", () => this.notifySettingsChanged()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncReadingChrome()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncReadingChrome()));
    this.app.workspace.onLayoutReady(() => this.syncReadingChrome());

    void this.library.scan().catch(() => {
      new Notice(this.t("扫描阅读库失败，请检查设置中的阅读库路径"));
    });
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-bookshelf",
      name: this.t("打开书架"),
      callback: () => void this.openBookshelf(),
    });
    this.addCommand({
      id: "import-book",
      name: this.t("导入书籍 (EPUB / PDF / FB2 / MOBI / AZW3 / CBZ)"),
      callback: () => void this.openBookshelf(true),
    });
    this.addCommand({
      id: "open-review",
      name: this.t("打开笔记"),
      callback: () => void this.openNotes(),
    });

  }

  t(key: MessageKey, ...values: Array<string | number>): string {
    return translate(this.settings.language, key, ...values);
  }

  errorText(error: unknown): string { return localizedError(this.settings.language, error); }
  localizeStatus(text: string): string { return localizeMessage(this.settings.language, text); }

  onunload(): void {
    this.translation.clear();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_READER);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ANSWER);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKSHELF);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_NOTES);
    this.app.workspace.detachLeavesOfType(LEGACY_REVIEW_VIEW);
    void this.cache.dispose();
    this.libraryListeners.clear();
    this.settingsListeners.clear();
    this.pageStates.clear();
    for (const doc of this.immersiveDocuments) doc.body.removeClass("qr-reading-active");
    this.immersiveDocuments.clear();
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const data = typeof raw === "object" && raw !== null ? raw as Partial<QReaderSettings> : {};
    const libraryPath = typeof data.libraryPath === "string" ? validateLibraryPath(data.libraryPath) : null;
    const ai = loadAiSettings(data.ai);
    const reading = typeof data.reading === "object" && data.reading !== null ? data.reading : DEFAULT_SETTINGS.reading;
    this.settings = {
      language: normalizeLanguage(data.language),
      translation: loadTranslationSettings(data.translation),
      libraryPath: libraryPath?.ok ? libraryPath.path : DEFAULT_SETTINGS.libraryPath,
      ai,
      questionPrompt: typeof data.questionPrompt === "string" ? data.questionPrompt : "",
      categories: Array.isArray(data.categories)
        ? [...new Set(data.categories.filter((category): category is string => typeof category === "string").map((category) => category.trim()).filter((category) => category && category !== "全部" && category !== "未读" && category !== "已读"))]
        : [],
      highlightColor: data.highlightColor === "green" || data.highlightColor === "blue" || data.highlightColor === "pink" || data.highlightColor === "purple" ? data.highlightColor : "yellow",
      reading: {
        fontSize: typeof reading.fontSize === "number" && Number.isFinite(reading.fontSize)
          ? Math.max(12, Math.min(28, reading.fontSize)) : DEFAULT_SETTINGS.reading.fontSize,
        lineHeight: typeof reading.lineHeight === "number" && Number.isFinite(reading.lineHeight)
          ? Math.max(1.4, Math.min(2.4, reading.lineHeight)) : DEFAULT_SETTINGS.reading.lineHeight,
        pageMargin: typeof reading.pageMargin === "number" && Number.isFinite(reading.pageMargin)
          ? Math.max(12, Math.min(48, reading.pageMargin)) : DEFAULT_SETTINGS.reading.pageMargin,
        fontFamily: reading.fontFamily === "sans" || reading.fontFamily === "serif" ? reading.fontFamily : "original",
        paragraphIndent: reading.paragraphIndent === true,
        theme: reading.theme === "dark" || reading.theme === "light" || reading.theme === "sepia" || reading.theme === "sage"
          ? reading.theme : "auto",
        defaultMode: reading.defaultMode === "scrolled" ? "scrolled" : "paginated",
      },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ------------------------------------------------------------- events

  onLibraryChanged(cb: () => void): () => void {
    this.libraryListeners.add(cb);
    return () => this.libraryListeners.delete(cb);
  }

  onSettingsChanged(cb: (reason: SettingsChangeReason) => void): () => void {
    this.settingsListeners.add(cb);
    return () => this.settingsListeners.delete(cb);
  }

  notifyChanged(): void {
    for (const cb of this.libraryListeners) cb();
  }

  notifySettingsChanged(reason: SettingsChangeReason = "settings"): void {
    if (reason === "language") {
      this.registerCommands();
      this.ribbon?.setAttribute("aria-label", this.t("QReader 书架"));
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof ReaderView || leaf.view instanceof BookshelfView || leaf.view instanceof AnswerView || leaf.view instanceof NotesView) {
          leaf.view.contentEl.lang = this.settings.language;
          const header = leaf as LeafHeaderAccess;
          if (typeof header.updateHeader === "function") header.updateHeader();
        }
      });
    }
    for (const cb of this.settingsListeners) cb(reason);
    if (reason === "language") this.app.workspace.trigger("layout-change");
  }

  syncReadingChrome(): void {
    const active = this.app.workspace.getActiveViewOfType(ReaderView);
    const doc = active?.contentEl.ownerDocument;
    for (const previous of this.immersiveDocuments) {
      if (previous !== doc) {
        previous.body.removeClass("qr-reading-active");
        this.immersiveDocuments.delete(previous);
      }
    }
    if (doc) {
      doc.body.addClass("qr-reading-active");
      this.immersiveDocuments.add(doc);
    }
  }

  // ------------------------------------------------------------- navigation

  async openBookshelf(triggerImport = false): Promise<void> {
    const current = this.app.workspace.getActiveViewOfType(BookshelfView);
    const view = current ?? (await this.activateLeaf(VIEW_TYPE_BOOKSHELF, this.pageStates.get(this.pageStateKey(VIEW_TYPE_BOOKSHELF, {})) ?? {})).view;
    if (triggerImport && view instanceof BookshelfView) view.pickFile();
  }

  async openReader(bookId: string): Promise<void> {
    await this.activateLeaf(VIEW_TYPE_READER, { bookId });
  }

  async openAnswer(bookId: string, chapterId: string, mode: "answer" | "review", scheduledFor?: string, question?: { id: string; version: number }): Promise<void> {
    const target = { bookId, chapterId, mode, scheduledFor };
    const state = this.pageStates.get(this.pageStateKey(VIEW_TYPE_ANSWER, target))
      ?? { ...target, questionVersion: question?.version ?? 0, requestedQuestionId: question?.id };
    const leaf = await this.activateLeaf(VIEW_TYPE_ANSWER, state);
    if (question && leaf.view instanceof AnswerView) await leaf.view.openFor(bookId, chapterId, mode, scheduledFor, question);
  }

  async openNotes(bookId?: string, chapterId?: string): Promise<void> {
    if (!bookId && this.app.workspace.getActiveViewOfType(NotesView)) return;
    const previous = this.pageStates.get(this.pageStateKey(VIEW_TYPE_NOTES, {})) ?? {};
    await this.activateLeaf(VIEW_TYPE_NOTES, bookId ? { ...previous, selectedBook: bookId, selectedChapter: chapterId ?? null } : previous);
  }

  rememberPageState(viewType: string, state: Record<string, unknown>): void {
    const key = this.pageStateKey(viewType, state);
    if (viewType === VIEW_TYPE_ANSWER && state.savedKind !== undefined) this.pageStates.delete(key);
    else this.pageStates.set(key, state);
  }

  private pageStateKey(viewType: string, state: Record<string, unknown>): string {
    const page = `${this.settings.libraryPath}/${viewType}`;
    return viewType === VIEW_TYPE_ANSWER
      ? `${page}/${state.bookId}/${state.chapterId}/${state.mode}/${state.scheduledFor ?? ""}`
      : page;
  }

  openSettings(): void {
    const app = this.app as AppSettingsAccess;
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  /** Navigate in the current tab; closing the old view releases its renderer. */
  private async activateLeaf(viewType: string, state: Record<string, unknown>): Promise<WorkspaceLeaf> {
    const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: viewType, state, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }
}

export default QReaderPlugin;
