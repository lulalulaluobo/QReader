import { ItemView, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { HealthyBookEntry } from "../types";
import { isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import { el, relTime, todayStr } from "../util";
import { pendingReviewsOf } from "./answer";
import { isReviewableChapter } from "../core/review-chapters";

export const VIEW_TYPE_REVIEW = "qreader-review";

export class ReviewView extends ItemView {
  private tab: "due" | "all" = "due";
  private selectedBook: string | null = null;
  private entries: HealthyBookEntry[] = [];
  private reviewExclusions = new Map<string, ReadonlyMap<string, boolean>>();
  private classificationError = "";
  private opened = false;
  private revision = 0;
  private loading = false;
  private error = "";
  private unsub: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
    this.navigation = true;
  }
  getViewType(): string { return VIEW_TYPE_REVIEW; }
  getDisplayText(): string { return this.plugin.t("QReader 复习"); }
  getIcon(): string { return "repeat"; }

  getState(): Record<string, unknown> { return { tab: this.tab, selectedBook: this.selectedBook }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const previousTab = this.tab;
    const previousBook = this.selectedBook;
    if (state && typeof state === "object") {
      if ("tab" in state && (state.tab === "due" || state.tab === "all")) this.tab = state.tab;
      if ("selectedBook" in state && (typeof state.selectedBook === "string" || state.selectedBook === null)) this.selectedBook = state.selectedBook;
    }
    result.history ||= previousTab !== this.tab || previousBook !== this.selectedBook;
    await super.setState(state, result);
    this.render();
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.lang = this.plugin.settings.language;
    this.plugin.syncReadingChrome();
    this.contentEl.addClass("qr-view");
    this.unsub = this.plugin.onLibraryChanged(() => void this.refresh());
    this.unsubSettings = this.plugin.onSettingsChanged((reason) => {
      if (reason === "language") this.render();
    });
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.plugin.rememberPageState(this.getViewType(), this.getState());
    this.opened = false;
    this.revision++;
    this.unsub?.();
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.unsub = null;
  }

  private async refresh(): Promise<void> {
    if (!this.opened) return;
    const revision = ++this.revision;
    this.loading = true;
    this.error = "";
    if (!this.entries.length) this.render();
    try {
      const entries = (await this.plugin.library.scan()).filter(isHealthyBook);
      const failures: string[] = [];
      const classifications = await Promise.all(entries.map(async (entry): Promise<[string, ReadonlyMap<string, boolean>]> => {
        try { return [entry.id, await this.plugin.cache.getReviewExclusions(entry)]; }
        catch (error) {
          failures.push(`《${entry.reading.book.title}》：${this.plugin.errorText(error)}`);
          return [entry.id, new Map()];
        }
      }));
      if (!this.opened || revision !== this.revision) return;
      this.entries = entries;
      this.reviewExclusions = new Map(classifications);
      this.classificationError = failures.length ? this.plugin.t("部分书籍的结构信息读取失败，暂按章节标题和路径筛选。{0}", failures.join("；")) : "";
      if (!this.entries.some((entry) => entry.id === this.selectedBook)) this.selectedBook = this.entries[0]?.id ?? null;
    } catch (error) {
      if (!this.opened || revision !== this.revision) return;
      this.error = this.plugin.t("读取复习记录失败：{0}", this.plugin.errorText(error));
    } finally {
      if (this.opened && revision === this.revision) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    if (!this.opened) return;
    this.contentEl.empty();
    const root = el("div", "qr-review");
    const header = el("div", "qr-review-header");
    header.appendChild(el("h1", "qr-review-title", this.plugin.t("复习")));
    const tabs = el("div", "qr-tabs");
    tabs.setAttribute("aria-label", this.plugin.t("复习章节范围"));
    for (const tab of [{ id: "due", title: this.plugin.t("待复习") }, { id: "all", title: this.plugin.t("全部章节") }]) {
      const button = el("button", `qr-tab${this.tab === tab.id ? " qr-tab-active" : ""}`, tab.title);
      button.setAttribute("aria-pressed", String(this.tab === tab.id));
      button.onclick = () => {
        this.tab = tab.id === "due" ? "due" : "all";
        this.app.workspace.requestSaveLayout();
        this.render();
      };
      tabs.appendChild(button);
    }
    header.appendChild(tabs);
    root.appendChild(header);
    if (this.classificationError) {
      const warning = el("div", "qr-inline-error", this.plugin.localizeStatus(this.classificationError));
      warning.setAttribute("role", "status");
      const retry = el("button", "qr-btn", this.plugin.t("重试读取结构"));
      retry.onclick = () => void this.refresh();
      root.append(warning, retry);
    }
    if (this.error) {
      const error = el("div", "qr-inline-error", this.plugin.localizeStatus(this.error));
      error.setAttribute("role", "alert");
      const retry = el("button", "qr-btn", this.plugin.t("重试"));
      retry.onclick = () => void this.refresh();
      root.append(error, retry);
    } else if (this.loading && !this.entries.length) {
      const status = el("div", "qr-muted qr-empty", this.plugin.t("正在读取复习记录……"));
      status.setAttribute("role", "status");
      root.appendChild(status);
    } else if (this.tab === "due") this.renderDue(root);
    else this.renderAll(root);
    root.appendChild(this.bottomNav());
    this.contentEl.appendChild(root);
  }

  private renderDue(root: HTMLElement): void {
    const body = el("div", "qr-review-body");
    root.appendChild(body);
    const today = todayStr();
    const rows = this.entries.flatMap((entry) => pendingReviewsOf(entry)
      .filter(({ r, ch, chapterId }) => isReviewableChapter(ch, this.reviewExclusions.get(entry.id)?.get(chapterId)) && Boolean(r.scheduledFor && r.scheduledFor <= today))
      .map((pending) => ({ entry, ...pending })));
    rows.sort((a, b) => (a.r.scheduledFor ?? "").localeCompare(b.r.scheduledFor ?? ""));
    if (!rows.length) {
      const hasChapters = this.entries.some((entry) => Object.entries(entry.reading.chapters)
        .some(([id, chapter]) => isReviewableChapter(chapter, this.reviewExclusions.get(entry.id)?.get(id))));
      const copy = this.entries.length && !hasChapters
        ? this.plugin.t("还没有可复习的正文章节。封面、序言等辅助内容仍可在阅读页查看；PDF 可在阅读页的目录中新建章节。")
        : this.plugin.t("没有到期的复习。\n你可以自由设置未来的复习日期，也可以从“全部章节”随时重新回答。");
      body.appendChild(el("div", "qr-muted qr-empty", copy));
      return;
    }
    for (const { entry, chapterId, ch, r } of rows) {
      const row = el("div", "qr-review-row");
      const info = el("div", "qr-review-row-info");
      info.append(el("div", "qr-review-row-book", `${entry.reading.book.title} · ${ch.title}`), el("div", "qr-muted qr-tiny", this.plugin.t("复习日期：{0}", r.scheduledFor ?? "")));
      const go = el("button", "qr-btn qr-btn-primary", this.plugin.t("重新回答"));
      go.setAttribute("aria-label", this.plugin.t("重新回答《{0}》{1}", entry.reading.book.title, ch.title));
      go.onclick = () => void this.plugin.openAnswer(entry.id, chapterId, "review", r.scheduledFor);
      row.append(info, go);
      body.appendChild(row);
    }
  }

  private renderAll(root: HTMLElement): void {
    const body = el("div", "qr-review-body");
    root.appendChild(body);
    if (!this.entries.length) { body.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("还没有可复习的书籍。请先导入书籍；损坏书籍可在书架中恢复。"))); return; }
    const chips = el("div", "qr-book-chips");
    chips.setAttribute("aria-label", this.plugin.t("选择复习书籍"));
    for (const entry of this.entries) {
      const chip = el("button", `qr-chip${this.selectedBook === entry.id ? " qr-chip-active" : ""}`, entry.reading.book.title);
      chip.setAttribute("aria-pressed", String(this.selectedBook === entry.id));
      chip.onclick = () => {
        this.selectedBook = entry.id;
        this.app.workspace.requestSaveLayout();
        this.render();
      };
      chips.appendChild(chip);
    }
    body.appendChild(chips);
    const target = this.entries.find((entry) => entry.id === this.selectedBook);
    if (!target) return;
    const chapters = Object.entries(target.reading.chapters)
      .filter(([id, chapter]) => isReviewableChapter(chapter, this.reviewExclusions.get(target.id)?.get(id)))
      .sort((a, b) => a[1].index - b[1].index);
    if (!chapters.length) {
      const copy = Object.keys(target.reading.chapters).length
        ? this.plugin.t("这本书没有可复习的正文章节。封面、序言等辅助内容仍可在阅读页查看。")
        : this.plugin.t("这本书还没有章节。PDF 可在阅读页的目录中新建章节。");
      body.appendChild(el("div", "qr-muted qr-empty", copy));
      return;
    }
    body.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("每次选择章节都会开始新的回忆；三题提交之后才能查看历次回答。")));
    for (const [chapterId, chapter] of chapters) {
      const row = el("div", "qr-review-row");
      const info = el("div", "qr-review-row-info");
      info.appendChild(el("div", "qr-review-row-book", chapter.title));
      const completed = chapter.reviews.filter((review) => review.completedAt);
      const times = chapter.answers.length + completed.length;
      const dates = [...chapter.answers.map((answer) => answer.answeredAt), ...completed.map((review) => review.completedAt ?? "")].filter(Boolean).sort();
      const last = dates.at(-1);
      info.appendChild(el("div", "qr-muted qr-tiny", times ? this.plugin.t("已回答 {0} 次{1}", times, last ? this.plugin.t(" · 上次 {0}", relTime(last, this.plugin.settings.language)) : "") : this.plugin.t("尚未回答")));
      const go = el("button", "qr-btn", this.plugin.t("重新回答"));
      go.setAttribute("aria-label", this.plugin.t("重新回答{0}", chapter.title));
      go.onclick = () => void this.plugin.openAnswer(target.id, chapterId, "review");
      row.append(info, go);
      body.appendChild(row);
    }
  }

  private bottomNav(): HTMLElement {
    const nav = el("nav", "qr-bottom-nav");
    nav.setAttribute("aria-label", this.plugin.t("QReader 导航"));
    const routes = [
      { label: this.plugin.t("书架"), icon: "library", active: false, go: () => this.plugin.openBookshelf() },
      { label: this.plugin.t("复习"), icon: "repeat", active: true, go: () => this.plugin.openReview() },
      { label: this.plugin.t("设置"), icon: "settings", active: false, go: () => this.plugin.openSettings() },
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
}
