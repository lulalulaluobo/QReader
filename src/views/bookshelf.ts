import { ItemView, Menu, Modal, Notice, TFile, TFolder, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { BookEntry, BookReadStatus, HealthyBookEntry } from "../types";
import { getBookReadStatus, isHealthyBook } from "../types";
import { el } from "../util";
import type { QReaderPlugin } from "../main";
import { ANNOTATIONS_MD } from "../core/library";
import { BOOK_FILE_ACCEPT } from "../core/book-formats";

export const VIEW_TYPE_BOOKSHELF = "qreader-bookshelf";

type ShelfFilter = "all" | BookReadStatus | `category:${string}`;
const BOOKS_PER_PAGE = 4;

class ConfirmationModal extends Modal {
  private settled = false;
  constructor(app: QReaderPlugin["app"], private message: string, private action: string, private resolve: (confirmed: boolean) => void) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.action);
    this.contentEl.addClass("qr-confirm");
    this.contentEl.appendChild(el("p", "qr-muted", this.message));
    const row = el("div", "qr-form-actions");
    const cancel = el("button", "qr-btn", "取消");
    cancel.onclick = () => this.close();
    const confirm = el("button", "qr-btn qr-btn-danger", this.action);
    confirm.onclick = () => {
      this.settled = true;
      this.resolve(true);
      this.close();
    };
    row.append(cancel, confirm);
    this.contentEl.appendChild(row);
    cancel.focus();
  }
  onClose(): void {
    if (!this.settled) this.resolve(false);
  }
}

export class BookshelfView extends ItemView {
  private search = "";
  private selectedFilter: ShelfFilter = "all";
  private pageIndex = 0;
  private unsub: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;
  private opened = false;
  private loadRevision = 0;
  private renderRevision = 0;
  private entries: BookEntry[] = [];
  private listBox: HTMLElement | null = null;
  private continueBox: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private filterBox: HTMLElement | null = null;
  private pagination: HTMLElement | null = null;
  private organizationModal: Modal | null = null;
  private savingOrganization = new Set<string>();
  private importButton: HTMLButtonElement | null = null;
  private importing = false;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
    this.navigation = true;
  }
  getViewType(): string { return VIEW_TYPE_BOOKSHELF; }
  getDisplayText(): string { return "QReader 书架"; }
  getIcon(): string { return "library"; }

  getState(): Record<string, unknown> { return { search: this.search, selectedFilter: this.selectedFilter, pageIndex: this.pageIndex }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const previousSearch = this.search;
    const previousFilter = this.selectedFilter;
    const previousPage = this.pageIndex;
    if (state && typeof state === "object") {
      if ("search" in state && typeof state.search === "string") this.search = state.search;
      if ("selectedFilter" in state) {
        const filter = state.selectedFilter;
        if (filter === "all" || filter === "unread" || filter === "read" || (typeof filter === "string" && filter.startsWith("category:"))) {
          this.selectedFilter = filter as ShelfFilter;
        }
      }
      this.pageIndex = "pageIndex" in state && typeof state.pageIndex === "number" && Number.isFinite(state.pageIndex)
        ? Math.max(0, Math.floor(state.pageIndex)) : 0;
    }
    if (previousSearch !== this.search || previousFilter !== this.selectedFilter || previousPage !== this.pageIndex) result.history = true;
    await super.setState(state, result);
    if (this.opened) { this.buildShell(); await this.renderCards(); }
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.plugin.syncReadingChrome();
    this.contentEl.addClass("qr-view");
    this.buildShell();
    this.unsub = this.plugin.onLibraryChanged(() => void this.refresh());
    this.unsubSettings = this.plugin.onSettingsChanged(() => {
      if (!this.opened) return;
      this.renderFilters();
      void this.renderCards();
    });
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.plugin.rememberPageState(this.getViewType(), this.getState());
    this.opened = false;
    this.loadRevision++;
    this.renderRevision++;
    this.unsub?.();
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.organizationModal?.close();
    this.organizationModal = null;
    this.entries = [];
    this.listBox = this.continueBox = this.filterBox = this.status = this.pagination = null;
    this.importButton = null;
    this.unsub = null;
  }

  private buildShell(): void {
    this.contentEl.empty();
    const root = el("div", "qr-bookshelf");
    const top = el("div", "qr-shelf-top");
    const searchBox = el("div", "qr-search");
    const icon = el("span", "qr-search-icon");
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, "search");
    const input = el("input");
    input.type = "search";
    input.placeholder = "搜索书名或作者";
    input.setAttribute("aria-label", "搜索书名或作者");
    input.value = this.search;
    input.oninput = () => {
      this.search = input.value;
      this.pageIndex = 0;
      this.app.workspace.requestSaveLayout();
      void this.renderCards();
    };
    searchBox.append(icon, input);
    top.append(searchBox, el("h1", "qr-shelf-heading", "书架"));
    const importButton = el("button", "qr-btn qr-btn-primary", this.importing ? "正在导入……" : "导入");
    importButton.setAttribute("aria-label", "导入书籍");
    importButton.disabled = this.importing;
    importButton.onclick = () => this.pickFile();
    this.importButton = importButton;
    top.appendChild(importButton);
    root.appendChild(top);
    this.filterBox = el("nav", "qr-shelf-filters");
    this.filterBox.setAttribute("aria-label", "书籍状态与学科分类");
    root.appendChild(this.filterBox);
    this.renderFilters();
    this.status = el("div", "qr-status qr-muted");
    this.status.setAttribute("role", "status");
    root.appendChild(this.status);
    this.continueBox = el("section", "qr-continue");
    root.appendChild(this.continueBox);
    this.listBox = el("div", "qr-book-list");
    root.appendChild(this.listBox);
    this.pagination = el("nav", "qr-shelf-pagination");
    this.pagination.setAttribute("aria-label", "书架翻页");
    this.pagination.hidden = true;
    const footer = this.bottomNav();
    footer.prepend(this.pagination);
    root.appendChild(footer);
    this.contentEl.appendChild(root);
  }

  private renderFilters(): void {
    const box = this.filterBox;
    if (!this.opened || !box) return;
    box.empty();
    const filters: { key: ShelfFilter; label: string }[] = [
      { key: "all", label: "全部" },
      { key: "unread", label: "未读" },
      { key: "read", label: "已读" },
      ...this.plugin.settings.categories.map((category): { key: ShelfFilter; label: string } => ({ key: `category:${category}`, label: category })),
    ];
    for (const filter of filters) {
      const button = el("button", `qr-shelf-filter${this.selectedFilter === filter.key ? " qr-shelf-filter-active" : ""}`, filter.label);
      button.title = filter.label;
      button.setAttribute("aria-pressed", String(this.selectedFilter === filter.key));
      button.onclick = () => {
        if (this.selectedFilter === filter.key) return;
        void this.leaf.setViewState({ type: VIEW_TYPE_BOOKSHELF, state: { search: this.search, selectedFilter: filter.key } });
      };
      box.appendChild(button);
    }
    const add = el("button", "qr-shelf-filter qr-shelf-add-category", "新增分类");
    add.onclick = () => this.openNewCategory();
    box.appendChild(add);
  }

  private openNewCategory(): void {
    if (this.organizationModal) return;
    const modal = new Modal(this.app);
    this.organizationModal = modal;
    let closed = false;
    let saving = false;
    modal.titleEl.setText("新增学科分类");
    modal.contentEl.addClass("qr-category-modal");
    const form = el("form", "qr-category-form");
    const input = el("input", "qr-category-input");
    input.type = "text";
    input.placeholder = "例如：文学、历史、计算机";
    input.setAttribute("aria-label", "学科分类名称");
    const errorBox = el("p", "qr-inline-error");
    errorBox.setAttribute("role", "alert");
    const row = el("div", "qr-form-actions");
    const cancel = el("button", "qr-btn", "取消");
    cancel.type = "button";
    cancel.onclick = () => modal.close();
    const submit = el("button", "qr-btn qr-btn-primary", "新增分类");
    submit.type = "submit";
    row.append(cancel, submit);
    form.append(input, errorBox, row);
    modal.contentEl.appendChild(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (saving || closed) return;
      const name = input.value.trim();
      const duplicate = this.plugin.settings.categories.some((category) => category.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!name || ["全部", "未读", "已读"].includes(name) || duplicate) {
        errorBox.setText(!name ? "请输入分类名称。" : duplicate ? "该分类已存在，请换一个名称。" : "不能使用内置分类名称。");
        input.focus();
        return;
      }
      saving = true;
      input.disabled = submit.disabled = true;
      submit.setText("正在保存……");
      errorBox.setText("");
      const previous = this.plugin.settings.categories;
      const next = [...previous, name];
      this.plugin.settings.categories = next;
      try {
        await this.plugin.saveSettings();
        this.plugin.notifySettingsChanged();
        new Notice(`已新增分类：${name}`);
        if (!closed) modal.close();
      } catch (error) {
        if (this.plugin.settings.categories === next) this.plugin.settings.categories = previous;
        this.plugin.notifySettingsChanged();
        const message = `分类保存失败：${error instanceof Error ? error.message : String(error)}。请重试。`;
        new Notice(message);
        if (!closed) errorBox.setText(message);
      } finally {
        saving = false;
        if (!closed) {
          input.disabled = submit.disabled = false;
          submit.setText("新增分类");
        }
      }
    };
    modal.onClose = () => {
      closed = true;
      if (this.organizationModal === modal) this.organizationModal = null;
    };
    modal.open();
    input.focus();
  }

  private openCategoryAssignment(entry: HealthyBookEntry): void {
    if (this.organizationModal) return;
    const modal = new Modal(this.app);
    this.organizationModal = modal;
    let closed = false;
    let saving = false;
    modal.titleEl.setText("指定学科分类");
    modal.contentEl.addClass("qr-category-modal");
    modal.contentEl.appendChild(el("p", "qr-muted", `为《${entry.reading.book.title}》选择分类。`));
    const form = el("form", "qr-category-form");
    const select = el("select", "qr-category-input");
    select.setAttribute("aria-label", "书籍学科分类");
    const none = el("option", "", "不指定分类");
    none.value = "";
    select.appendChild(none);
    const current = entry.reading.book.category;
    const categories = [...this.plugin.settings.categories];
    if (current && !categories.includes(current)) categories.push(current);
    for (const category of categories) {
      const option = el("option", "", category);
      option.value = category;
      select.appendChild(option);
    }
    select.value = current ?? "";
    const errorBox = el("p", "qr-inline-error");
    errorBox.setAttribute("role", "alert");
    const row = el("div", "qr-form-actions");
    const cancel = el("button", "qr-btn", "取消");
    cancel.type = "button";
    cancel.onclick = () => modal.close();
    const submit = el("button", "qr-btn qr-btn-primary", "保存分类");
    submit.type = "submit";
    row.append(cancel, submit);
    form.append(select, errorBox, row);
    modal.contentEl.appendChild(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (closed || saving || this.savingOrganization.has(entry.id)) return;
      saving = true;
      select.disabled = submit.disabled = true;
      submit.setText("正在保存……");
      errorBox.setText("");
      try {
        await this.updateOrganization(entry, { category: select.value || null });
        if (!closed) modal.close();
      } catch (error) {
        if (!closed) errorBox.setText(`分类保存失败：${error instanceof Error ? error.message : String(error)}。请重试。`);
      } finally {
        saving = false;
        if (!closed) {
          select.disabled = submit.disabled = false;
          submit.setText("保存分类");
        }
      }
    };
    modal.onClose = () => {
      closed = true;
      if (this.organizationModal === modal) this.organizationModal = null;
    };
    modal.open();
    select.focus();
  }

  private async updateOrganization(entry: HealthyBookEntry, patch: { readStatus?: BookReadStatus; category?: string | null }): Promise<void> {
    if (this.savingOrganization.has(entry.id)) throw new Error("书籍信息正在保存，请稍后重试");
    this.savingOrganization.add(entry.id);
    try {
      await this.plugin.library.updateBookOrganization(entry, patch);
    } catch (error) {
      new Notice(`书籍信息保存失败：${error instanceof Error ? error.message : String(error)}。请重试。`);
      throw error;
    } finally {
      this.savingOrganization.delete(entry.id);
    }
  }

  private bottomNav(): HTMLElement {
    const nav = el("nav", "qr-bottom-nav");
    nav.setAttribute("aria-label", "QReader 导航");
    const routes = [
      { label: "书架", icon: "library", active: true, go: () => this.plugin.openBookshelf() },
      { label: "复习", icon: "repeat", active: false, go: () => this.plugin.openReview() },
      { label: "设置", icon: "settings", active: false, go: () => this.plugin.openSettings() },
    ];
    for (const route of routes) {
      const button = el("button", `qr-nav-item${route.active ? " qr-nav-active" : ""}`);
      const icon = el("span");
      icon.setAttribute("aria-hidden", "true");
      setIcon(icon, route.icon);
      button.append(icon, el("span", "", route.label));
      if (route.active) button.setAttribute("aria-current", "page");
      button.onclick = () => void route.go();
      nav.appendChild(button);
    }
    return nav;
  }

  async render(): Promise<void> { await this.refresh(); }

  private async refresh(): Promise<void> {
    if (!this.opened) return;
    const revision = ++this.loadRevision;
    if (this.status && this.entries.length === 0) this.status.setText("正在读取书架……");
    try {
      const entries = await this.plugin.library.scan();
      if (!this.opened || revision !== this.loadRevision) return;
      this.entries = entries.sort((a, b) => {
        const aTime = isHealthyBook(a) ? Date.parse(a.reading.progress.lastReadAt) || 0 : 0;
        const bTime = isHealthyBook(b) ? Date.parse(b.reading.progress.lastReadAt) || 0 : 0;
        return bTime - aTime;
      });
      this.status?.setText("");
      await this.renderCards();
    } catch (error) {
      if (!this.opened || revision !== this.loadRevision) return;
      this.status?.empty();
      this.status?.appendChild(el("span", "qr-inline-error", `读取书架失败：${error instanceof Error ? error.message : String(error)}`));
      const retry = el("button", "qr-btn", "重试");
      retry.onclick = () => void this.refresh();
      this.status?.appendChild(retry);
    }
  }

  private async renderCards(): Promise<void> {
    const box = this.listBox;
    const continueBox = this.continueBox;
    if (!this.opened || !box || !continueBox) return;
    const revision = ++this.renderRevision;
    const query = this.search.trim().toLocaleLowerCase();
    const filtered = this.entries.filter((entry) => {
      const searchable = isHealthyBook(entry) ? `${entry.reading.book.title} ${entry.reading.book.author}` : entry.id;
      if (!searchable.toLocaleLowerCase().includes(query)) return false;
      if (this.selectedFilter === "all") return true;
      if (!isHealthyBook(entry)) return false;
      if (this.selectedFilter === "read" || this.selectedFilter === "unread") return getBookReadStatus(entry.reading) === this.selectedFilter;
      return entry.reading.book.category === this.selectedFilter.slice("category:".length);
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / BOOKS_PER_PAGE));
    const pageIndex = Math.min(this.pageIndex, pageCount - 1);
    const cards = await Promise.all(filtered.slice(pageIndex * BOOKS_PER_PAGE, (pageIndex + 1) * BOOKS_PER_PAGE).map((entry) => this.buildCard(entry)));
    const latest = filtered.find((entry): entry is HealthyBookEntry => isHealthyBook(entry) && Boolean(entry.reading.progress.lastReadAt));
    const continuing = latest && !query ? await this.buildContinue(latest) : null;
    if (!this.opened || revision !== this.renderRevision) return;
    if (this.pageIndex !== pageIndex) {
      this.pageIndex = pageIndex;
      this.app.workspace.requestSaveLayout();
    }
    box.empty();
    continueBox.empty();
    if (continuing) {
      continueBox.appendChild(continuing);
    }
    if (cards.length) box.append(...cards);
    else box.appendChild(el("div", "qr-muted qr-empty", this.entries.length ? "没有匹配的书" : "书架是空的。支持 EPUB、PDF、FB2、MOBI、AZW3 与 CBZ，导入原书即可开始阅读。"));
    this.renderPagination(pageCount, filtered.length);
  }

  private renderPagination(pageCount: number, total: number): void {
    const nav = this.pagination;
    if (!nav) return;
    nav.empty();
    nav.hidden = pageCount <= 1;
    if (nav.hidden) return;
    const page = el("span", "qr-shelf-page qr-muted", `${this.pageIndex + 1} / ${pageCount}`);
    page.setAttribute("role", "status");
    page.setAttribute("aria-label", `共 ${total} 本书，第 ${this.pageIndex + 1} 页，共 ${pageCount} 页`);
    const button = (label: string, icon: string, next: number): HTMLButtonElement => {
      const control = el("button", `qr-icon-btn ${next < this.pageIndex ? "qr-shelf-page-previous" : "qr-shelf-page-next"}`);
      control.setAttribute("aria-label", label);
      control.title = label;
      setIcon(control, icon);
      control.disabled = next < 0 || next >= pageCount;
      control.onclick = () => {
        void this.leaf.setViewState({ type: VIEW_TYPE_BOOKSHELF, state: { ...this.getState(), pageIndex: next } });
      };
      return control;
    };
    nav.append(button("上一页书籍", "chevron-left", this.pageIndex - 1), page, button("下一页书籍", "chevron-right", this.pageIndex + 1));
  }

  private async coverEl(entry: HealthyBookEntry, cls: string): Promise<HTMLElement> {
    const box = el("span", `qr-cover ${cls}`);
    const cover = await this.plugin.library.getCover(entry).catch(() => null);
    if (cover) {
      const image = el("img");
      image.src = cover;
      image.alt = "";
      image.onerror = () => {
        image.remove();
        box.addClass("qr-cover-empty");
        box.appendChild(el("span", "qr-cover-title", entry.reading.book.title));
      };
      box.appendChild(image);
    } else {
      box.addClass("qr-cover-empty");
      box.appendChild(el("span", "qr-cover-title", entry.reading.book.title));
    }
    return box;
  }

  private async buildContinue(entry: HealthyBookEntry): Promise<HTMLElement> {
    const card = el("button", "qr-continue-card");
    const progress = entry.reading.progress;
    const chapter = progress.chapterId ? entry.reading.chapters[progress.chapterId] : undefined;
    const info = el("span", "qr-continue-info");
    const title = el("span", "qr-continue-book", entry.reading.book.title);
    title.title = entry.reading.book.title;
    const position = `${chapter?.title ?? "开始阅读"} · ${Math.round(progress.percent * 100)}%`;
    const meta = el("span", "qr-continue-meta qr-muted", position);
    meta.title = position;
    info.append(title, meta);
    card.setAttribute("aria-label", `继续阅读《${entry.reading.book.title}》，${position}`);
    card.onclick = () => void this.plugin.openReader(entry.id);
    card.append(await this.coverEl(entry, "qr-continue-cover"), info, el("span", "qr-continue-action", "继续阅读"));
    return card;
  }

  private async buildCard(entry: BookEntry): Promise<HTMLElement> {
    const healthy = isHealthyBook(entry);
    const title = healthy ? entry.reading.book.title : entry.id;
    const card = el("div", `qr-card${healthy ? "" : " qr-card-damaged"}`);
    const open = el("button", "qr-book-open");
    open.title = title;
    open.setAttribute("aria-label", healthy ? `阅读《${title}》` : `查看《${title}》的损坏文件夹`);
    open.onclick = (event) => {
      event.stopPropagation();
      if (healthy) void this.plugin.openReader(entry.id);
      else this.revealFolder(entry);
    };
    const more = el("button", "qr-icon-btn qr-card-more");
    more.setAttribute("aria-label", `《${title}》更多操作`);
    more.title = "更多操作";
    setIcon(more, "more-horizontal");
    more.onclick = (event) => { event.stopPropagation(); this.openCardMenu(event, entry); };
    if (isHealthyBook(entry)) {
      const progress = entry.reading.progress;
      open.appendChild(await this.coverEl(entry, ""));
      open.appendChild(el("span", "qr-card-title", title));
      const status = getBookReadStatus(entry.reading) === "read" ? "已读" : "未读";
      const meta = el("span", "qr-card-meta qr-muted", `${status} · ${Math.round(progress.percent * 100)}%`);
      meta.title = [meta.textContent, entry.reading.book.author, entry.reading.book.category].filter(Boolean).join(" · ");
      open.appendChild(meta);
    } else {
      const cover = el("span", "qr-cover qr-cover-empty");
      cover.setAttribute("aria-hidden", "true");
      setIcon(cover, "file-warning");
      open.append(cover, el("span", "qr-card-title", title), el("span", "qr-card-meta qr-inline-error", "记录损坏"));
      const error = el("div", "qr-card-error qr-inline-error", "请从更多操作恢复备份或重新建立记录。");
      card.appendChild(error);
    }
    const main = el("div", "qr-card-main");
    main.append(open, more);
    card.prepend(main);
    return card;
  }

  private openCardMenu(event: MouseEvent, entry: BookEntry): void {
    const menu = new Menu().setUseNativeMenu(true);
    if (isHealthyBook(entry)) {
      const nextStatus = getBookReadStatus(entry.reading) === "read" ? "unread" : "read";
      menu.addItem((item) => item.setTitle(nextStatus === "read" ? "标记为已读" : "标记为未读").setIcon(nextStatus === "read" ? "check" : "book-open").setDisabled(this.savingOrganization.has(entry.id)).onClick(() => {
        void this.updateOrganization(entry, { readStatus: nextStatus }).catch(() => {});
      }));
      menu.addItem((item) => item.setTitle(entry.reading.book.category ? `指定分类（${entry.reading.book.category}）` : "指定分类").setIcon("tag").setDisabled(this.savingOrganization.has(entry.id)).onClick(() => this.openCategoryAssignment(entry)));
      if (entry.reading.book.category) {
        menu.addItem((item) => item.setTitle("取消分类").setIcon("x").setDisabled(this.savingOrganization.has(entry.id)).onClick(() => {
          void this.updateOrganization(entry, { category: null }).catch(() => {});
        }));
      }
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("查看批注").setIcon("file-text").onClick(async () => {
        const file = this.app.vault.getAbstractFileByPath(`${entry.dir}/${ANNOTATIONS_MD}`);
        if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
        else new Notice("未找到批注.md");
      }));
      menu.addItem((item) => item.setTitle("进入复习").setIcon("repeat").onClick(() => void this.plugin.openReview(entry.id)));
    } else {
      menu.addItem((item) => item.setTitle("恢复备份").setIcon("history").onClick(() => void this.recover(entry, false)));
      menu.addItem((item) => item.setTitle("重新建立阅读记录").setIcon("refresh-cw").onClick(() => void this.recover(entry, true)));
    }
    menu.addItem((item) => item.setTitle("查看文件夹").setIcon("folder").onClick(() => this.revealFolder(entry)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("删除").setIcon("trash-2").onClick(async () => {
      const title = isHealthyBook(entry) ? entry.reading.book.title : entry.id;
      if (!(await this.confirm(`将《${title}》的原文件、批注和阅读记录移入 Obsidian 设置的回收站。`, "删除书籍"))) return;
      try {
        await this.plugin.library.deleteBook(entry);
        new Notice(`已移入回收站：《${title}》`);
      } catch (error) { new Notice(`删除失败：${error instanceof Error ? error.message : String(error)}`); }
    }));
    menu.showAtMouseEvent(event);
  }

  private async recover(entry: BookEntry, reset: boolean): Promise<void> {
    if (isHealthyBook(entry)) return;
    const action = reset ? "重新建立阅读记录" : "恢复备份";
    const message = reset ? "将保留原书及损坏文件，重新建立阅读记录；无法恢复原有回答和进度。" : "将从可用备份恢复阅读记录，损坏文件会保留。备份之后的改动可能无法恢复。";
    if (!(await this.confirm(message, action))) return;
    try {
      if (reset) await this.plugin.library.resetBroken(entry.id);
      else await this.plugin.library.restoreBroken(entry.id);
      new Notice(`${action}成功`);
      await this.refresh();
    } catch (error) { new Notice(`${action}失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  private revealFolder(entry: BookEntry): void {
    const folder = this.app.vault.getAbstractFileByPath(entry.dir);
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const view = leaf.view;
      if (folder && "revealInFolder" in view && typeof view.revealInFolder === "function") {
        view.revealInFolder(folder);
        void this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    const modal = new Modal(this.app);
    modal.titleEl.setText("书籍文件夹");
    modal.contentEl.appendChild(el("p", "qr-muted", entry.dir));
    if (folder instanceof TFolder) {
      for (const file of folder.children) {
        if (!(file instanceof TFile)) continue;
        const button = el("button", "qr-btn", file.name);
        button.onclick = () => { modal.close(); void this.app.workspace.getLeaf(false).openFile(file); };
        modal.contentEl.appendChild(button);
      }
    } else modal.contentEl.appendChild(el("p", "qr-muted", "文件夹尚未出现在 Obsidian 文件列表中，请在文件管理器中查看以上路径。"));
    modal.open();
  }

  private confirm(message: string, action: string): Promise<boolean> {
    return new Promise((resolve) => new ConfirmationModal(this.app, message, action, resolve).open());
  }

  pickFile(): void {
    if (this.importing) return;
    const input = el("input");
    input.type = "file";
    input.accept = BOOK_FILE_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || this.importing) return;
      this.importing = true;
      if (this.importButton) { this.importButton.disabled = true; this.importButton.setText("正在导入……"); }
      try {
        await this.plugin.library.importBook(file.name, await file.arrayBuffer());
        await this.refresh();
      } catch (error) { new Notice(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
      finally {
        this.importing = false;
        if (this.opened && this.importButton) { this.importButton.disabled = false; this.importButton.setText("导入"); }
      }
    };
    input.click();
  }
}
