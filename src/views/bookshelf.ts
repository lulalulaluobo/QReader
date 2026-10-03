import { ItemView, Menu, Modal, Notice, TFile, TFolder, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { BookEntry, HealthyBookEntry } from "../types";
import { isHealthyBook } from "../types";
import { el } from "../util";
import type { QReaderPlugin } from "../main";
import { ANNOTATIONS_MD } from "../core/library";
import { BOOK_FILE_ACCEPT } from "../core/book-formats";

export const VIEW_TYPE_BOOKSHELF = "qreader-bookshelf";

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
  private unsub: (() => void) | null = null;
  private opened = false;
  private loadRevision = 0;
  private renderRevision = 0;
  private entries: BookEntry[] = [];
  private listBox: HTMLElement | null = null;
  private continueBox: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private importButton: HTMLButtonElement | null = null;
  private importing = false;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
  }
  getViewType(): string { return VIEW_TYPE_BOOKSHELF; }
  getDisplayText(): string { return "QReader 书架"; }
  getIcon(): string { return "library"; }

  getState(): Record<string, unknown> { return { search: this.search }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object" && "search" in state && typeof state.search === "string") this.search = state.search;
    await super.setState(state, result);
    if (this.opened) { this.buildShell(); await this.refresh(); }
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.addClass("qr-view");
    this.buildShell();
    this.unsub = this.plugin.onLibraryChanged(() => void this.refresh());
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.opened = false;
    this.loadRevision++;
    this.renderRevision++;
    this.unsub?.();
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
      this.app.workspace.requestSaveLayout();
      void this.renderCards();
    };
    searchBox.append(icon, input);
    root.appendChild(searchBox);
    top.appendChild(el("h1", "qr-shelf-heading", "书架"));
    const importButton = el("button", "qr-btn qr-btn-primary", this.importing ? "正在导入……" : "导入");
    importButton.setAttribute("aria-label", "导入书籍");
    importButton.disabled = this.importing;
    importButton.onclick = () => this.pickFile();
    this.importButton = importButton;
    top.appendChild(importButton);
    root.appendChild(top);
    this.status = el("div", "qr-status qr-muted");
    this.status.setAttribute("role", "status");
    root.appendChild(this.status);
    this.continueBox = el("section", "qr-continue");
    root.appendChild(this.continueBox);
    this.listBox = el("div", "qr-book-list");
    root.appendChild(this.listBox);
    root.appendChild(this.bottomNav());
    this.contentEl.appendChild(root);
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
      return searchable.toLocaleLowerCase().includes(query);
    });
    const cards = await Promise.all(filtered.map((entry) => this.buildCard(entry)));
    const latest = this.entries.find((entry): entry is HealthyBookEntry => isHealthyBook(entry) && Boolean(entry.reading.progress.lastReadAt));
    const continuing = latest && !query ? await this.buildContinue(latest) : null;
    if (!this.opened || revision !== this.renderRevision) return;
    box.empty();
    continueBox.empty();
    if (continuing) {
      continueBox.appendChild(continuing);
    }
    if (cards.length) box.append(...cards);
    else box.appendChild(el("div", "qr-muted qr-empty", this.entries.length ? "没有匹配的书" : "书架是空的。支持 EPUB、PDF、FB2、MOBI、AZW3 与 CBZ，导入原书即可开始阅读。"));
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
      open.appendChild(el("span", "qr-card-meta qr-muted", progress.lastReadAt ? `已读 ${Math.round(progress.percent * 100)}%` : "未读"));
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
    const menu = new Menu();
    if (isHealthyBook(entry)) {
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
