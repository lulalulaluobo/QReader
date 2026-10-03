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
import { ReviewView, VIEW_TYPE_REVIEW } from "./views/review";
import { QReaderSettingTab } from "./settings-tab";

// Obsidian's native settings controller is not exposed by its public typings.
interface AppSettingsAccess extends App {
  setting: { open(): void; openTabById(id: string): void };
}

export class QReaderPlugin extends Plugin {
  declare settings: QReaderSettings;
  library!: LibraryManager;
  cache!: BookCache;
  private libraryListeners = new Set<() => void>();
  private settingsListeners = new Set<() => void>();
  private immersiveDocuments = new Set<Document>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.cache = new BookCache(this.app.vault.adapter);
    this.library = new LibraryManager(
      {
        app: this.app,
        libraryPath: () => this.settings.libraryPath,
        aiConfig: () => getAiConfig(this.settings.ai),
        configDir: this.app.vault.configDir,
        pluginId: this.manifest.id,
        notifyChanged: () => this.notifyChanged(),
      },
      this.cache
    );

    this.registerView(VIEW_TYPE_BOOKSHELF, (leaf) => new BookshelfView(leaf, this));
    this.registerView(VIEW_TYPE_READER, (leaf) => new ReaderView(leaf, this));
    this.registerView(VIEW_TYPE_ANSWER, (leaf) => new AnswerView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, this));

    this.addRibbonIcon("book-open", "QReader 书架", () => void this.openBookshelf());

    this.addCommand({
      id: "open-bookshelf",
      name: "打开书架",
      callback: () => void this.openBookshelf(),
    });
    this.addCommand({
      id: "import-book",
      name: "导入书籍 (EPUB / PDF / FB2 / MOBI / AZW3 / CBZ)",
      callback: () => void this.openBookshelf(true),
    });
    this.addCommand({
      id: "open-review",
      name: "进入复习",
      callback: () => void this.openReview(),
    });

    this.addSettingTab(new QReaderSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("css-change", () => this.notifySettingsChanged())
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncReadingChrome()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncReadingChrome()));
    this.app.workspace.onLayoutReady(() => this.syncReadingChrome());

    // initial scan in the background so the bookshelf opens fast
    void this.library.scan().catch(() => {
      new Notice("扫描阅读库失败，请检查设置中的阅读库路径");
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_READER);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ANSWER);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKSHELF);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_REVIEW);
    void this.cache.dispose();
    this.libraryListeners.clear();
    this.settingsListeners.clear();
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
      libraryPath: libraryPath?.ok ? libraryPath.path : DEFAULT_SETTINGS.libraryPath,
      ai,
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

  onSettingsChanged(cb: () => void): () => void {
    this.settingsListeners.add(cb);
    return () => this.settingsListeners.delete(cb);
  }

  notifyChanged(): void {
    for (const cb of this.libraryListeners) cb();
  }

  notifySettingsChanged(): void {
    for (const cb of this.settingsListeners) cb();
  }

  private syncReadingChrome(): void {
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
    const leaf = await this.activateLeaf(VIEW_TYPE_BOOKSHELF);
    if (leaf && triggerImport) {
      const view = leaf.view;
      if (view instanceof BookshelfView) view.pickFile();
    }
  }

  async openReader(bookId: string): Promise<void> {
    const leaf = await this.activateLeaf(VIEW_TYPE_READER);
    const view = leaf?.view;
    if (view instanceof ReaderView) await view.openBook(bookId);
  }

  async openAnswer(bookId: string, chapterId: string, mode: "answer" | "review", scheduledFor?: string): Promise<void> {
    const leaf = await this.activateLeaf(VIEW_TYPE_ANSWER);
    const view = leaf?.view;
    if (view instanceof AnswerView) await view.openFor(bookId, chapterId, mode, scheduledFor);
  }

  async openReview(bookId?: string): Promise<void> {
    const leaf = await this.activateLeaf(VIEW_TYPE_REVIEW);
    const view = leaf?.view;
    if (view instanceof ReviewView) await view.openFor(bookId ?? null);
  }

  openSettings(): void {
    const app = this.app as AppSettingsAccess;
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  /** Reuse an existing leaf of this type or open a fresh one. */
  private async activateLeaf(viewType: string): Promise<WorkspaceLeaf | null> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    let leaf: WorkspaceLeaf;
    if (existing.length > 0) {
      leaf = existing[0];
      if (leaf.view.getViewType() !== viewType) {
        await leaf.setViewState({ type: viewType, active: true });
      }
    } else {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: viewType, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }
}

export default QReaderPlugin;
