import { Notice, TFile } from "obsidian";
import type { QReaderPlugin } from "../main";
import type { MessageKey } from "../i18n";
import { el, fmtDateTime } from "../util";
import { relatedCandidates, RELATION_LABELS, traceKey } from "../core/thought-data";
import type { ThoughtThread, TraceSource } from "../core/thought-data";
import { suggestRelations } from "../ai/thought-relations";
import { getAiConfig } from "../ai/providers";
import { confirmAction, joinThread, TextEditorModal } from "./thought-editor";

export interface ThoughtUiState { selectedThread: string | null; query: string }
export class ThoughtPanel {
  private generation = 0;
  private activePanel: HTMLElement | null = null;
  private searchLimit = 50;
  private threads: ThoughtThread[] = [];
  private failure = "";
  constructor(private plugin: QReaderPlugin, public state: ThoughtUiState, private changed: () => void) {}
  invalidate(): void { this.generation++; this.activePanel?.remove(); this.activePanel = null; }
  private button(label: MessageKey, run: () => void | Promise<void>): HTMLButtonElement {
    const button = el("button", "qr-btn qr-btn-sm", this.plugin.t(label));
    button.onclick = async () => {
      if (button.disabled) return; button.disabled = true;
      try { await run(); }
      catch (error) { new Notice(this.plugin.errorText(error)); }
      finally { button.disabled = false; }
    };
    return button;
  }
  openThread(id: string): void { this.state.selectedThread = id; this.changed(); }
  sourceActions(parent: HTMLElement, source: TraceSource): void {
    const actions = el("div", "qr-note-actions");
    actions.append(this.button(source.ref.kind === "annotation" ? "回到原文" : "查看书籍想法", () => this.plugin.openTrace(source.ref)),
      this.button("加入思考线", () => joinThread(this.plugin, source, {}, id => this.openThread(id))));
    if (source.note.trim()) actions.append(this.button("找相关笔记", () => this.showRelated(parent, source)));
    parent.appendChild(actions);
  }
  sourceCard(source: TraceSource): HTMLElement {
    const article = el("article", "qr-reading-note qr-trace-source"); article.dataset.traceKey = source.key;
    article.appendChild(el("div", "qr-note-meta", `${source.bookTitle}${source.chapterTitle ? " · " + source.chapterTitle : ""} · ${fmtDateTime(source.at)}`));
    if (source.baseline) article.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("既有笔记：此前修改历史未记录。")));
    if (source.quote) article.appendChild(el("blockquote", "qr-note-quote", source.quote));
    if (source.note) article.appendChild(el("p", "qr-note-understanding", source.note));
    if (source.aiExplanation) { const ai = el("details", "qr-note-ai"); ai.append(el("summary", undefined, this.plugin.t("已收录的 AI 解释")), el("p", undefined, source.aiExplanation)); article.appendChild(ai); }
    return article;
  }
  async showRelated(parent: HTMLElement, source: TraceSource): Promise<void> {
    this.invalidate(); const generation = this.generation;
    parent.querySelector(".qr-related-panel")?.remove();
    const panel = el("section", "qr-related-panel"); panel.setAttribute("aria-live", "polite"); parent.appendChild(panel);
    this.activePanel = panel;
    const status = el("p", "qr-muted", this.plugin.t("正在寻找相关笔记……")); panel.appendChild(status);
    const cancel = this.button("关闭", () => { this.invalidate(); panel.remove(); }); panel.appendChild(cancel);
    const scope = JSON.stringify([this.plugin.settings.libraryPath, this.plugin.settings.language, this.plugin.settings.ai]);
    const current = (): boolean => generation === this.generation && panel.isConnected && scope === JSON.stringify([this.plugin.settings.libraryPath, this.plugin.settings.language, this.plugin.settings.ai]);
    try {
      const candidates = relatedCandidates(source, this.plugin.traceSources(true));
      if (!candidates.length) { status.setText(this.plugin.t("暂无相关记录。你仍可手动加入思考线。")); return; }
      const suggestions = await suggestRelations(getAiConfig(this.plugin.settings.ai), source, candidates, this.plugin.settings.language);
      if (!current()) return;
      status.setText(this.plugin.t(suggestions.length ? "以下关联仅为建议，确认后才会保存。" : "暂未找到有意义的联系。"));
      for (const suggestion of suggestions) {
        const target = this.plugin.resolveTraceSource(candidates.find(item => item.key === suggestion.targetKey)!.ref);
        if (!target) continue;
        const card = this.sourceCard(target);
        card.appendChild(el("p", "qr-note-understanding", this.plugin.t("建议关系：{0}", this.plugin.t(RELATION_LABELS[suggestion.relation]))));
        card.appendChild(el("p", "qr-note-understanding", suggestion.reason));
        const actions = el("div", "qr-note-actions");
        actions.append(this.button("放在一起", () => joinThread(this.plugin, source, { target, ...suggestion }, id => this.openThread(id))), this.button("忽略", () => card.remove()));
        card.appendChild(actions); panel.appendChild(card);
      }
    } catch (error) {
      if (!current()) return;
      status.setText(this.plugin.t("寻找关联失败：{0}", this.plugin.errorText(error)));
      panel.appendChild(this.button("重试", () => this.showRelated(parent, source)));
    }
  }
  async render(host: HTMLElement): Promise<void> {
    this.invalidate(); const generation = this.generation;
    host.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("把自己的想法连接起来。关联与当前判断都由你决定。")));
    const actions = el("div", "qr-note-actions");
    actions.appendChild(this.button("新建思考线", () => this.editThread())); host.appendChild(actions);
    const search = el("input", "qr-input"); search.placeholder = this.plugin.t("搜索思考线或自己的笔记"); search.setAttribute("aria-label", search.placeholder); search.value = this.state.query;
    host.appendChild(search);
    const body = el("div", "qr-thought-list"); host.appendChild(body);
    search.oninput = () => { this.state.query = search.value; this.searchLimit = 50; this.plugin.app.workspace.requestSaveLayout(); this.renderList(body); };
    try {
      this.threads = (await this.plugin.thinking.load()).threads;
      if (generation !== this.generation || !host.isConnected) return;
      this.failure = ""; this.renderList(body);
    } catch (error) {
      if (generation !== this.generation || !host.isConnected) return;
      this.failure = this.plugin.errorText(error);
      body.append(el("p", "qr-inline-error", this.plugin.t("读取思考线失败：{0}", this.failure)),
        this.button("重试", async () => { await this.plugin.thinking.load(true); this.changed(); }),
        this.button("恢复思考线备份", async () => { await this.plugin.thinking.restoreBackup(); this.changed(); }));
    }
  }
  private renderList(body: HTMLElement): void {
    this.invalidate();
    body.empty();
    const query = this.state.query.trim().toLowerCase();
    const sources = this.plugin.traceSources(); const byKey = new Map(sources.map(item => [item.key, item]));
    const filtered = this.threads.filter(thread => !query || [thread.title, thread.judgment, thread.unresolved, ...thread.items.map(item => byKey.get(traceKey(item.ref))?.note ?? "")].join(" ").toLowerCase().includes(query));
    if (query) {
      body.appendChild(el("h3", "qr-question-type", this.plugin.t("匹配的阅读笔记")));
      const matches = sources.filter(source => [source.note, source.quote, source.bookTitle].join(" ").normalize("NFKC").toLowerCase().includes(query.normalize("NFKC"))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (!matches.length) body.appendChild(el("p", "qr-muted", this.plugin.t("没有匹配的阅读笔记")));
      for (const source of matches.slice(0, this.searchLimit)) { const card = this.sourceCard(source); this.sourceActions(card, source); body.appendChild(card); }
      if (matches.length > this.searchLimit) body.appendChild(this.button("显示更多笔记", () => { this.searchLimit += 50; this.renderList(body); }));
    }
    if (!filtered.length) body.appendChild(el("p", "qr-muted qr-empty", this.plugin.t("还没有匹配的思考线。可以从一条批注开始。")));
    for (const thread of filtered) {
      const details = el("details", "qr-notes-chapter qr-thought-thread"); details.dataset.threadId = thread.id; details.open = thread.id === this.state.selectedThread;
      details.appendChild(el("summary", "qr-history-row", thread.title));
      details.ontoggle = () => { if (details.open) this.state.selectedThread = thread.id; else if (this.state.selectedThread === thread.id) this.state.selectedThread = null; this.plugin.app.workspace.requestSaveLayout(); };
      const content = el("div", "qr-notes-chapter-body");
      content.append(el("h3", "qr-question-type", this.plugin.t("我目前怎么看")), el("p", "qr-note-understanding", thread.judgment || this.plugin.t("尚未记录")), el("h3", "qr-question-type", this.plugin.t("仍想探索")), el("p", "qr-note-understanding", thread.unresolved || this.plugin.t("尚未记录")));
      const actions = el("div", "qr-note-actions");
      actions.append(this.button("编辑思考线", () => this.editThread(thread)), this.button("导出 Markdown 快照", async () => {
        const path = await this.plugin.thinking.exportMarkdown(thread, this.plugin.traceSources(), this.plugin.settings.language, this.plugin.app.vault.getName());
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.plugin.app.workspace.getLeaf(false).openFile(file);
        else new Notice(this.plugin.t("已导出：{0}", path));
      }), this.button("删除思考线", () => confirmAction(this.plugin, "删除这条思考线？原书和笔记会保留。", () => this.plugin.thinking.deleteThread(thread.id))));
      content.appendChild(actions);
      const ordered = [...thread.items].sort((a, b) => Date.parse(byKey.get(traceKey(a.ref))?.at ?? a.addedAt) - Date.parse(byKey.get(traceKey(b.ref))?.at ?? b.addedAt));
      for (const item of ordered) {
        const source = byKey.get(traceKey(item.ref));
        const card = source ? this.sourceCard(source) : el("article", "qr-reading-note", this.plugin.t("来源已删除或不可用"));
        card.append(el("div", "qr-note-meta", this.plugin.t("关系：{0}", this.plugin.t(RELATION_LABELS[item.relation]))));
        if (item.reason) card.appendChild(el("p", "qr-note-understanding", item.reason));
        if (source) this.sourceActions(card, source);
        card.appendChild(this.button("移出思考线", () => this.plugin.thinking.removeItem(thread.id, item.ref))); content.appendChild(card);
      }
      if (!thread.items.length) content.appendChild(el("p", "qr-muted", this.plugin.t("还没有加入记录。可从书籍笔记选择一条想法。")));
      details.appendChild(content); body.appendChild(details);
    }
  }
  private editThread(thread?: ThoughtThread): void {
    new TextEditorModal(this.plugin, thread ? "编辑思考线" : "新建思考线", [
      { label: "思考线标题", value: thread?.title ?? "" }, { label: "我目前怎么看", value: thread?.judgment ?? "", multiline: true }, { label: "仍想探索", value: thread?.unresolved ?? "", multiline: true },
    ], async values => { const id = await this.plugin.thinking.saveThread(thread?.id, values[0], values[1], values[2]); this.openThread(id); }).open();
  }
}
