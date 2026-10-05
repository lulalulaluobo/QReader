import { Component, ItemView, MarkdownRenderer, Notice, TFile, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { HealthyBookEntry } from "../types";
import { isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import { el } from "../util";
import { ANNOTATIONS_MD } from "../core/library";
import { noteAnchor } from "../core/note-history";

export const VIEW_TYPE_NOTES = "qreader-notes";
export const LEGACY_REVIEW_VIEW = "qreader-review";
export const LEGACY_ANSWER_VIEW = "qreader-answer";

export class NotesView extends ItemView {
  private selectedBook: string | null = null;
  private selectedChapter: string | null = null;
  private selectedNote: string | null = null;
  private selectedRevision: string | null = null;
  private legacyState: Record<string, unknown> | null = null;
  private entries: HealthyBookEntry[] = [];
  private opened = false;
  private revision = 0;
  private error = "";
  private documentText = "";
  private rendered: Component | null = null;
  private fileTimer: number | null = null;
  private unsub: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin, private viewType = VIEW_TYPE_NOTES) {
    super(leaf); this.navigation = true;
  }
  getViewType(): string { return this.viewType; }
  getDisplayText(): string { return this.plugin.t("QReader 笔记"); }
  getIcon(): string { return "notebook-pen"; }
  getState(): Record<string, unknown> {
    return { ...this.legacyState, selectedBook: this.selectedBook, selectedChapter: this.selectedChapter, selectedNote: this.selectedNote, selectedRevision: this.selectedRevision, tab: "books" };
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const before = JSON.stringify(this.getState());
    if (state && typeof state === "object") {
      this.legacyState = { ...state };
      const value = state as Record<string, unknown>;
      if (this.viewType === LEGACY_ANSWER_VIEW) {
        if (!("selectedBook" in value) && typeof value.bookId === "string") this.selectedBook = value.bookId;
        if (!("selectedChapter" in value) && typeof value.chapterId === "string") this.selectedChapter = value.chapterId;
      }
      for (const key of ["selectedBook", "selectedChapter", "selectedNote", "selectedRevision"] as const) {
        if (typeof value[key] === "string" || value[key] === null) this[key] = value[key];
      }
    }
    result.history ||= before !== JSON.stringify(this.getState());
    await super.setState(state, result);
    await this.refresh();
  }
  async onOpen(): Promise<void> {
    this.opened = true;
    this.plugin.syncReadingChrome();
    this.contentEl.addClass("qr-view");
    this.unsub = this.plugin.onLibraryChanged(() => void this.refresh());
    this.unsubSettings = this.plugin.onSettingsChanged(() => void this.refresh());
    const changed = (file: { path: string }): void => {
      const entry = this.entries.find(entry => entry.id === this.selectedBook);
      if (!entry || file.path !== entry.dir + "/" + ANNOTATIONS_MD) return;
      if (this.fileTimer !== null) window.clearTimeout(this.fileTimer);
      this.fileTimer = window.setTimeout(() => { this.fileTimer = null; void this.refresh(false); }, 100);
    };
    this.registerEvent(this.app.vault.on("modify", changed));
    this.registerEvent(this.app.vault.on("create", changed));
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.plugin.rememberPageState(this.viewType, this.getState());
    this.opened = false; ++this.revision;
    this.unsub?.(); this.unsubSettings?.(); this.unsub = this.unsubSettings = null;
    if (this.fileTimer !== null) window.clearTimeout(this.fileTimer);
    if (this.rendered) this.removeChild(this.rendered);
    this.rendered = null;
  }
  private async refresh(sync = true): Promise<void> {
    if (!this.opened) return;
    const revision = ++this.revision;
    this.error = "";
    try {
      const entries = (await this.plugin.library.scan()).filter(isHealthyBook);
      if (!this.opened || revision !== this.revision) return;
      this.entries = entries;
      if (!entries.some(entry => entry.id === this.selectedBook)) this.selectedBook = entries[0]?.id ?? null;
      const entry = entries.find(entry => entry.id === this.selectedBook);
      if (entry) {
        if (sync) await this.plugin.library.syncAnnotationsMd(entry);
        const text = await this.app.vault.adapter.read(entry.dir + "/" + ANNOTATIONS_MD);
        if (!this.opened || revision !== this.revision) return;
        this.documentText = text;
      } else this.documentText = "";
    } catch (error) {
      if (this.opened && revision === this.revision) this.error = this.plugin.t("读取笔记失败：{0}", this.plugin.errorText(error));
    }
    if (this.opened && revision === this.revision) await this.render(revision);
  }
  private async render(revision: number): Promise<void> {
    if (!this.opened) return;
    if (this.rendered) this.removeChild(this.rendered);
    this.rendered = null;
    this.contentEl.lang = this.plugin.settings.language;
    this.contentEl.empty();
    const root = el("div", "qr-notes-page");
    root.append(el("h1", "qr-review-title", this.plugin.t("笔记")), el("p", "qr-muted qr-tiny", this.plugin.t("每本书一份笔记，保留摘抄和自己的想法。")));
    const body = el("div", "qr-notes-page-body");
    root.append(body, this.bottomNav()); this.contentEl.appendChild(root);
    if (this.error) {
      const status = el("div", "qr-inline-error", this.plugin.localizeStatus(this.error)); status.setAttribute("role", "alert");
      const retry = el("button", "qr-btn", this.plugin.t("重试")); retry.onclick = () => void this.refresh(); body.append(status, retry);
      return;
    }
    if (!this.entries.length) {
      body.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("还没有阅读笔记。导入书籍后，可以随时记录自己的想法。")));
      return;
    }
    const select = el("select", "qr-input qr-notes-book-select"); select.setAttribute("aria-label", this.plugin.t("选择笔记书籍"));
    for (const entry of this.entries) { const option = el("option", undefined, entry.reading.book.title); option.value = entry.id; select.appendChild(option); }
    select.value = this.selectedBook ?? "";
    select.onchange = () => {
      this.selectedBook = select.value; this.selectedChapter = this.selectedNote = this.selectedRevision = null;
      this.app.workspace.requestSaveLayout(); void this.refresh();
    };
    body.appendChild(select);
    const entry = this.entries.find(entry => entry.id === this.selectedBook);
    if (!entry) return;
    const actions = el("div", "qr-answer-actions");
    const read = el("button", "qr-btn", this.plugin.t("继续阅读")); read.onclick = () => void this.plugin.openReader(entry.id);
    const file = el("button", "qr-btn qr-btn-primary", this.plugin.t("编辑笔记文档")); file.onclick = () => void this.openDocument(entry, file);
    actions.append(read, file); body.appendChild(actions);
    body.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("摘抄会自动汇总；整书想法可直接写在文档里。")));
    this.renderLegacyDraft(body, entry);
    const preview = el("article", "qr-notes-document markdown-rendered"); body.appendChild(preview);
    const component = this.addChild(new Component()); this.rendered = component;
    await MarkdownRenderer.render(this.app, this.documentText, preview, entry.dir + "/" + ANNOTATIONS_MD, component);
    if (!this.opened || revision !== this.revision || !preview.isConnected) return;
    if (this.selectedNote && this.selectedRevision) {
      const target = [...preview.querySelectorAll<HTMLElement>("[id]")].find(node => node.id === noteAnchor(this.selectedNote!, this.selectedRevision!));
      if (target) {
        for (let parent = target.parentElement; parent && parent !== preview; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
        target.tabIndex = -1; target.scrollIntoView({ block: "nearest" }); target.focus({ preventScroll: true });
      }
    }
  }
  private async openDocument(entry: HealthyBookEntry, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.plugin.library.syncAnnotationsMd(entry);
      if (!this.opened || this.selectedBook !== entry.id) return;
      let target = this.app.vault.getAbstractFileByPath(entry.dir + "/" + ANNOTATIONS_MD);
      for (let n = 0; !(target instanceof TFile) && n < 5; n++) {
        await new Promise(resolve => window.setTimeout(resolve, 50));
        target = this.app.vault.getAbstractFileByPath(entry.dir + "/" + ANNOTATIONS_MD);
      }
      if (!this.opened || this.selectedBook !== entry.id) return;
      if (!(target instanceof TFile)) throw new Error(this.plugin.t("未找到批注.md"));
      await this.app.workspace.getLeaf(false).openFile(target);
    } catch (error) { if (this.opened) new Notice(this.plugin.t("打开笔记失败：{0}", this.plugin.errorText(error))); }
    finally { button.disabled = false; }
  }
  private renderLegacyDraft(body: HTMLElement, entry: HealthyBookEntry): void {
    const state = this.legacyState;
    if (!state || state.bookId !== entry.id || state.savedKind !== undefined || !Array.isArray(state.answers)) return;
    const answers: unknown[] = state.answers;
    if (!answers.some(answer => typeof answer === "string" && answer.trim())) return;
    const chapter = typeof state.chapterId === "string" ? entry.reading.chapters[state.chapterId] : undefined;
    const version = chapter?.questionVersions.find(version => version.version === state.questionVersion);
    const questionOrder = ["core", "logic", "retell"] as const;
    const draft = el("details", "qr-history-item qr-legacy-draft");
    draft.open = true;
    draft.appendChild(el("summary", "qr-history-row", this.plugin.t("历史回答草稿")));
    draft.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("三问已停用。此草稿保留供查看和复制，未自动保存为笔记。")));
    if (chapter) draft.appendChild(el("div", "qr-question-type", chapter.title));
    for (const [index, answer] of answers.entries()) {
      if (typeof answer !== "string" || !answer.trim()) continue;
      const question = version?.questions.find(question => question.type === questionOrder[index]);
      contentQuestion(draft, this.plugin.t("草稿 {0}", index + 1), question?.text ?? "");
      draft.appendChild(el("p", "qr-compare-text", answer));
    }
    body.appendChild(draft);
  }
  private bottomNav(): HTMLElement {
    const nav = el("nav", "qr-bottom-nav"); nav.setAttribute("aria-label", this.plugin.t("QReader 导航"));
    for (const route of [
      { label: this.plugin.t("书架"), icon: "library", active: false, go: () => this.plugin.openBookshelf() },
      { label: this.plugin.t("笔记"), icon: "notebook-pen", active: true, go: () => this.plugin.openNotes() },
      { label: this.plugin.t("设置"), icon: "settings", active: false, go: () => this.plugin.openSettings() },
    ]) {
      const button = el("button", `qr-nav-item${route.active ? " qr-nav-active" : ""}`); const icon = el("span"); icon.setAttribute("aria-hidden", "true"); setIcon(icon, route.icon);
      button.append(icon, el("span", "", route.label)); if (route.active) button.setAttribute("aria-current", "page"); button.onclick = () => void route.go(); nav.appendChild(button);
    }
    return nav;
  }
}

function contentQuestion(parent: HTMLElement, label: string, text: string): void {
  const row = el("div", "qr-compare-item"); row.append(el("div", "qr-question-type", label), el("div", "qr-compare-question", text)); parent.appendChild(row);
}
