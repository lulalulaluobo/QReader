import { ItemView, Notice, TFile, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { HealthyBookEntry } from "../types";
import { isHealthyBook, QUESTION_LABELS } from "../types";
import type { QReaderPlugin } from "../main";
import { el } from "../util";
import { ANNOTATIONS_MD } from "../core/library";
import { chapterNotes } from "../core/chapter-notes";
import { renderNoteHistory } from "./note-content";
import { ThoughtPanel } from "./thoughts";
import { TextEditorModal, confirmAction } from "./thought-editor";
import { annotationRevisions, traceKey } from "../core/thought-data";
import type { TraceSource } from "../core/thought-data";

export const VIEW_TYPE_NOTES = "qreader-notes";
export const LEGACY_REVIEW_VIEW = "qreader-review";
export const LEGACY_ANSWER_VIEW = "qreader-answer";

export class NotesView extends ItemView {
  private selectedBook: string | null = null;
  private tab: "books" | "threads" = "books";
  private selectedNote: string | null = null;
  private selectedRevision: string | null = null;
  private thoughtState = { selectedThread: null as string | null, query: "" };
  private noteSources = new Map<string, TraceSource>();
  private thoughtPanel: ThoughtPanel;
  private selectedChapter: string | null = null;
  // Keep old layout drafts available without turning them into saved notes.
  private legacyState: Record<string, unknown> | null = null;
  private entries: HealthyBookEntry[] = [];
  private opened = false;
  private revision = 0;
  private loading = false;
  private error = "";
  private unsub: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin, private viewType = VIEW_TYPE_NOTES) {
    super(leaf);
    this.navigation = true;
    this.thoughtPanel = new ThoughtPanel(plugin, this.thoughtState, () => {
      this.tab = "threads"; this.app.workspace.requestSaveLayout(); this.render();
    });
  }
  getViewType(): string { return this.viewType; }
  getDisplayText(): string { return this.plugin.t("QReader 笔记"); }
  getIcon(): string { return "notebook-pen"; }
  getState(): Record<string, unknown> {
    return { ...this.legacyState, selectedBook: this.selectedBook, selectedChapter: this.selectedChapter, selectedNote: this.selectedNote, selectedRevision: this.selectedRevision, tab: this.tab, selectedThread: this.thoughtState.selectedThread, query: this.thoughtState.query };
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const before = JSON.stringify(this.getState());
    if (state && typeof state === "object") {
      if (this.viewType === LEGACY_ANSWER_VIEW) {
        this.legacyState = { ...state };
        if (!("selectedBook" in state) && "bookId" in state && typeof state.bookId === "string") this.selectedBook = state.bookId;
        if (!("selectedChapter" in state) && "chapterId" in state && typeof state.chapterId === "string") this.selectedChapter = state.chapterId;
      }
      if ("tab" in state && (state.tab === "books" || state.tab === "threads")) this.tab = state.tab;
      if ("selectedRevision" in state && (typeof state.selectedRevision === "string" || state.selectedRevision === null)) this.selectedRevision = state.selectedRevision;
      if ("selectedNote" in state && (typeof state.selectedNote === "string" || state.selectedNote === null)) this.selectedNote = state.selectedNote;
      if ("selectedThread" in state && (typeof state.selectedThread === "string" || state.selectedThread === null)) this.thoughtState.selectedThread = state.selectedThread;
      if ("query" in state && typeof state.query === "string") this.thoughtState.query = state.query;
      if ("selectedBook" in state && (typeof state.selectedBook === "string" || state.selectedBook === null)) this.selectedBook = state.selectedBook;
      if ("selectedChapter" in state && (typeof state.selectedChapter === "string" || state.selectedChapter === null)) this.selectedChapter = state.selectedChapter;
    }
    result.history ||= before !== JSON.stringify(this.getState());
    await super.setState(state, result);
    this.render();
  }
  async onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.lang = this.plugin.settings.language;
    this.plugin.syncReadingChrome();
    this.contentEl.addClass("qr-view");
    this.unsub = this.plugin.onLibraryChanged(() => void this.refresh());
    this.unsubSettings = this.plugin.onSettingsChanged(() => { this.thoughtPanel.invalidate(); void this.refresh(); });
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.plugin.rememberPageState(this.viewType, this.getState());
    this.opened = false;
    this.thoughtPanel.invalidate();
    this.noteSources.clear();
    this.revision++;
    this.unsub?.(); this.unsubSettings?.();
    this.unsub = this.unsubSettings = null;
  }
  private async refresh(): Promise<void> {
    if (!this.opened) return;
    this.thoughtPanel.invalidate();
    const revision = ++this.revision;
    this.loading = true; this.error = "";
    if (!this.entries.length) this.render();
    try {
      const entries = (await this.plugin.library.scan()).filter(isHealthyBook);
      if (!this.opened || revision !== this.revision) return;
      this.entries = entries;
      if (!entries.some(entry => entry.id === this.selectedBook)) this.selectedBook = entries[0]?.id ?? null;
    } catch (error) {
      if (this.opened && revision === this.revision) this.error = this.plugin.t("读取笔记失败：{0}", this.plugin.errorText(error));
    } finally {
      if (this.opened && revision === this.revision) { this.loading = false; this.render(); }
    }
  }
  private render(): void {
    if (!this.opened) return;
    this.thoughtPanel.invalidate();
    this.contentEl.lang = this.plugin.settings.language;
    this.contentEl.empty();
    const root = el("div", "qr-notes-page");
    root.append(el("h1", "qr-review-title", this.plugin.t("笔记")), el("p", "qr-muted qr-tiny", this.plugin.t("回看自己的阅读记录，让不同书里的想法接得上。")));
    const tabs = el("div", "qr-notes-tabs"); tabs.setAttribute("aria-label", this.plugin.t("笔记视角"));
    for (const [tab, key] of [["books", "按书籍"], ["threads", "按思考线"]] as const) {
      const button = el("button", `qr-btn${this.tab === tab ? " qr-btn-primary" : ""}`, this.plugin.t(key));
      button.setAttribute("aria-pressed", String(this.tab === tab));
      button.onclick = () => { this.tab = tab; this.selectedNote = null; this.selectedRevision = null; this.app.workspace.requestSaveLayout(); this.render(); }; tabs.appendChild(button);
    }
    root.appendChild(tabs);
    const body = el("div", "qr-notes-page-body");
    if (this.error) {
      const status = el("div", "qr-inline-error", this.plugin.localizeStatus(this.error)); status.setAttribute("role", "alert");
      const retry = el("button", "qr-btn", this.plugin.t("重试")); retry.onclick = () => void this.refresh(); body.append(status, retry);
    } else if (this.tab === "threads") {
      root.append(body, this.bottomNav()); this.contentEl.appendChild(root);
      void this.thoughtPanel.render(body); return;
    } else if (this.loading && !this.entries.length) body.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("正在读取笔记……")));
    else if (!this.entries.length) body.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("还没有阅读笔记。导入书籍后，可以随时记录自己的想法。")));
    else {
      const select = el("select", "qr-input qr-notes-book-select"); select.setAttribute("aria-label", this.plugin.t("选择笔记书籍"));
      for (const entry of this.entries) { const option = el("option", undefined, entry.reading.book.title); option.value = entry.id; select.appendChild(option); }
      select.value = this.selectedBook ?? "";
      select.onchange = () => { this.selectedBook = select.value; this.selectedChapter = null; this.selectedNote = null; this.app.workspace.requestSaveLayout(); this.render(); };
      body.appendChild(select);
      const entry = this.entries.find(entry => entry.id === this.selectedBook);
      if (entry) this.renderBook(body, entry);
    }
    root.append(body, this.bottomNav()); this.contentEl.appendChild(root);
  }
  private renderBook(body: HTMLElement, entry: HealthyBookEntry): void {
    this.noteSources = new Map(this.plugin.traceSources().map(source => [source.key, source]));
    const actions = el("div", "qr-answer-actions");
    const read = el("button", "qr-btn", this.plugin.t("继续阅读")); read.onclick = () => void this.plugin.openReader(entry.id);
    const file = el("button", "qr-btn", this.plugin.t("打开笔记文件"));
    file.onclick = async () => {
      file.disabled = true;
      try {
        await this.plugin.library.syncAnnotationsMd(entry);
        if (!this.opened || this.selectedBook !== entry.id) return;
        const target = this.app.vault.getAbstractFileByPath(`${entry.dir}/${ANNOTATIONS_MD}`);
        if (!(target instanceof TFile)) throw new Error(this.plugin.t("未找到批注.md"));
        await this.app.workspace.getLeaf(false).openFile(target);
      } catch (error) { if (this.opened) new Notice(this.plugin.t("打开笔记失败：{0}", this.plugin.errorText(error))); }
      finally { file.disabled = false; }
    };
    const add = el("button", "qr-btn qr-btn-primary", this.plugin.t("写下关于这本书的想法"));
    add.onclick = () => this.editBookNote(entry);
    actions.append(read, file, add); body.appendChild(actions);
    for (const note of entry.reading.bookNotes ?? []) {
      const source = this.noteSources.get(traceKey({ bookId: entry.id, kind: "bookNote", id: note.id, revisionId: note.history[note.history.length - 1].id }));
      if (!source) continue;
      const article = this.thoughtPanel.sourceCard(source); article.dataset.noteId = note.id;
      this.thoughtPanel.sourceActions(article, source);
      const edit = el("button", "qr-btn qr-btn-sm", this.plugin.t("编辑想法")); edit.onclick = () => this.editBookNote(entry, note.id);
      const remove = el("button", "qr-btn qr-btn-sm qr-btn-danger", this.plugin.t("删除笔记"));
      remove.onclick = () => confirmAction(this.plugin, "删除后会移除该笔记及修改历史，思考线将显示来源已不可用。", () => this.plugin.library.deleteBookNote(entry, note.id));
      const controls = el("div", "qr-note-actions"); controls.append(edit, remove); article.appendChild(controls);
      this.renderRevisions(article, entry.id, "bookNote", note.id, note.history.slice(0, -1).map(revision => revision.id));
      body.appendChild(article);
      if (this.selectedNote === note.id && (!this.selectedRevision || this.selectedRevision === source.ref.revisionId)) { article.tabIndex = -1; requestAnimationFrame(() => { if (article.isConnected) { article.scrollIntoView({ block: "nearest" }); article.focus({ preventScroll: true }); } }); }
    }
    this.renderLegacyDraft(body, entry);
    const chapters = Object.entries(entry.reading.chapters).sort((a, b) => a[1].index - b[1].index)
      .filter(([id, chapter]) => chapter.questionVersions.length || chapterNotes(chapter).length || entry.reading.annotations.some(record => record.chapterId === id));
    if (!chapters.length) body.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("还没有笔记。选择正文可以划线，也可以写下自己的理解。")));
    for (const [id, chapter] of chapters) {
      const details = el("details", "qr-notes-chapter"); details.open = id === this.selectedChapter;
      details.appendChild(el("summary", "qr-history-row", chapter.title));
      details.ontoggle = () => { if (details.open) this.selectedChapter = id; else if (this.selectedChapter === id) this.selectedChapter = null; this.app.workspace.requestSaveLayout(); };
      const content = el("div", "qr-notes-chapter-body");
      for (const record of entry.reading.annotations.filter(record => record.chapterId === id).sort((a, b) => a.sortKey - b.sortKey)) {
        const revisions = annotationRevisions(record);
        const source = this.noteSources.get(traceKey({ bookId: entry.id, kind: "annotation", id: record.id, revisionId: revisions[revisions.length - 1].id }));
        if (!source) continue;
        const annotation = this.thoughtPanel.sourceCard(source);
        this.thoughtPanel.sourceActions(annotation, source);
        const edit = el("button", "qr-btn qr-btn-sm", this.plugin.t("编辑批注"));
        edit.onclick = () => new TextEditorModal(this.plugin, "编辑批注", [{ label: "我的理解", value: record.note ?? "", multiline: true }], async values => {
          await this.plugin.library.updateAnnotation(entry, record.id, { note: values[0], kind: values[0].trim() || record.aiExplanation ? "annotation" : "highlight" });
        }).open();
        annotation.appendChild(edit);
        this.renderRevisions(annotation, entry.id, "annotation", record.id, revisions.slice(0, -1).map(revision => revision.id));
        content.appendChild(annotation);
      }
      if (chapter.questionVersions.length || chapterNotes(chapter).length) {
        const archive = el("details", "qr-history-item qr-notes-archive");
        archive.appendChild(el("summary", "qr-history-row", this.plugin.t("历史三问与回答")));
        archive.appendChild(renderNoteHistory(this.plugin, chapter));
        for (const version of [...chapter.questionVersions].reverse()) {
          const questions = el("details", "qr-history-item");
          questions.appendChild(el("summary", "qr-muted qr-tiny", this.plugin.t("阅读三问 · 问题版本 {0}", version.version)));
          for (const question of version.questions) contentQuestion(questions, this.plugin.t(QUESTION_LABELS[question.type]), question.text);
          archive.appendChild(questions);
        }
        content.appendChild(archive);
      }
      details.appendChild(content); body.appendChild(details);
    }
  }
  private editBookNote(entry: HealthyBookEntry, id?: string): void {
    const note = entry.reading.bookNotes?.find(note => note.id === id);
    new TextEditorModal(this.plugin, id ? "编辑想法" : "写下关于这本书的想法", [{ label: "我的想法", value: note?.text ?? "", multiline: true }], async values => {
      await this.plugin.library.saveBookNote(entry, values[0], id);
    }).open();
  }
  private renderRevisions(parent: HTMLElement, bookId: string, kind: TraceSource["ref"]["kind"], id: string, revisions: string[]): void {
    if (!revisions.length) return;
    const history = el("details", "qr-note-revisions"); history.appendChild(el("summary", "qr-history-row", this.plugin.t("修改历史")));
    for (const revisionId of [...revisions].reverse()) {
      const source = this.noteSources.get(traceKey({ bookId, kind, id, revisionId }));
      if (!source) continue;
      const card = this.thoughtPanel.sourceCard(source); this.thoughtPanel.sourceActions(card, source); history.appendChild(card);
      if (this.selectedNote === id && this.selectedRevision === revisionId) {
        history.open = true; card.tabIndex = -1;
        requestAnimationFrame(() => { if (card.isConnected) { card.scrollIntoView({ block: "nearest" }); card.focus({ preventScroll: true }); } });
      }
    }
    parent.appendChild(history);
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
