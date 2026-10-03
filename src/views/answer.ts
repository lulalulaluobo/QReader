import { ItemView, Modal, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { AnswerRecord, ChapterState, Feedback, HealthyBookEntry, Question, QuestionType, ReviewRecord } from "../types";
import { QUESTION_LABELS, isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import { el, fmtDateTime, todayStr } from "../util";
import { generateFeedback } from "../ai/tasks";
import { getAiConfig } from "../ai/providers";

export const VIEW_TYPE_ANSWER = "qreader-answer";
export type AnswerMode = "answer" | "review";

type SavedSession = { kind: "answer"; record: AnswerRecord } | { kind: "review"; record: ReviewRecord };
interface HistoryItem {
  record: AnswerRecord | ReviewRecord;
  kind: AnswerMode;
  at: string;
  answers: Record<string, string>;
  version: number;
}

export class AnswerView extends ItemView {
  private bookId = "";
  private chapterId = "";
  private mode: AnswerMode = "answer";
  private scheduledFor: string | undefined;
  private step = 0;
  private answers = ["", "", ""];
  private questions: Question[] = [];
  private questionVersion = 0;
  private phase: "questions" | "saving" | "feedback-loading" | "done" = "questions";
  private feedbackError = "";
  private questionError = "";
  private submissionError = "";
  private questionsLoading = false;
  private saved: SavedSession | null = null;
  private opened = false;
  private session = 0;
  private lifetime = 0;
  private unsub: (() => void) | null = null;
  private requestedQuestionId: string | undefined;
  private versionModal: Modal | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_ANSWER; }
  getDisplayText(): string { return this.mode === "review" ? "QReader · 复习" : "QReader · 回答"; }
  getIcon(): string { return "message-square-quote"; }

  getState(): Record<string, unknown> {
    const entry = this.plugin.library.get(this.bookId);
    const chapter = entry && isHealthyBook(entry) ? entry.reading.chapters[this.chapterId] : undefined;
    const savedIndex = this.saved?.kind === "answer" ? chapter?.answers.indexOf(this.saved.record) : this.saved?.kind === "review" ? chapter?.reviews.indexOf(this.saved.record) : undefined;
    return {
      bookId: this.bookId, chapterId: this.chapterId, mode: this.mode,
      scheduledFor: this.scheduledFor, step: this.step, answers: [...this.answers],
      questionVersion: this.questionVersion, savedKind: this.saved?.kind, savedIndex,
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (!state || typeof state !== "object" || !("bookId" in state) || typeof state.bookId !== "string" || !("chapterId" in state) || typeof state.chapterId !== "string") {
      await super.setState(state, result);
      return;
    }
    this.versionModal?.close();
    this.session++;
    const session = this.session;
    this.bookId = state.bookId;
    this.chapterId = state.chapterId;
    this.mode = "mode" in state && state.mode === "review" ? "review" : "answer";
    this.scheduledFor = "scheduledFor" in state && typeof state.scheduledFor === "string" ? state.scheduledFor : undefined;
    this.step = "step" in state && typeof state.step === "number" && Number.isInteger(state.step) && state.step >= 0 && state.step <= 2 ? state.step : 0;
    this.answers = ["", "", ""];
    if ("answers" in state && Array.isArray(state.answers)) {
      for (let index = 0; index < 3; index++) {
        const answer: unknown = state.answers[index];
        if (typeof answer === "string") this.answers[index] = answer;
      }
    }
    this.questionVersion = "questionVersion" in state && typeof state.questionVersion === "number" ? state.questionVersion : 0;
    this.questions = [];
    this.requestedQuestionId = undefined;
    this.questionsLoading = false;
    this.saved = null;
    this.phase = "questions";
    this.renderStep();
    await this.plugin.library.scan();
    if (session !== this.session) return;
    const entry = this.plugin.library.get(this.bookId);
    const chapter = entry && isHealthyBook(entry) ? entry.reading.chapters[this.chapterId] : undefined;
    if (chapter && "savedIndex" in state && typeof state.savedIndex === "number" && Number.isInteger(state.savedIndex) && state.savedIndex >= 0 && "savedKind" in state) {
      if (state.savedKind === "answer") {
        const record = chapter.answers[state.savedIndex];
        if (record) this.saved = { kind: "answer", record };
      } else if (state.savedKind === "review") {
        const record = chapter.reviews[state.savedIndex];
        if (record?.completedAt && record.answers) this.saved = { kind: "review", record };
      }
    }
    if (this.saved) this.phase = "done";
    await super.setState(state, result);
    if (this.opened) await this.loadQuestions();
    this.renderStep();
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    this.contentEl.addClass("qr-view");
    this.unsub = this.plugin.onLibraryChanged(() => {
      if (!this.opened) return;
      const entry = this.plugin.library.get(this.bookId);
      if (!entry || !isHealthyBook(entry) || !entry.reading.chapters[this.chapterId]) this.renderStep();
      else if (!this.questions.length && !this.questionsLoading) void this.loadQuestions();
    });
    this.renderStep();
    if (this.bookId && !this.questions.length) await this.loadQuestions();
  }
  async onClose(): Promise<void> {
    this.opened = false;
    this.versionModal?.close();
    this.lifetime++;
    this.questionsLoading = false;
    if (this.phase === "feedback-loading") {
      this.phase = "done";
      this.feedbackError = "回答已保存，AI 反馈尚未完成，可重试。";
    }
    this.unsub?.();
    this.unsub = null;
  }

  async openFor(bookId: string, chapterId: string, mode: AnswerMode, scheduledFor?: string, question?: { id: string; version: number }): Promise<void> {
    this.versionModal?.close();
    const sameAnswer = mode === "answer" && this.bookId === bookId && this.chapterId === chapterId && this.mode === mode;
    if (sameAnswer && this.phase !== "done") {
      if (!question || !this.questionVersion || question.version === this.questionVersion) {
        this.requestedQuestionId = question?.id;
        this.focusRequestedQuestion();
        this.renderStep();
        if (!this.questions.length && !this.questionsLoading) await this.loadQuestions();
        return;
      }
      if (this.phase !== "questions") return;
      if (this.answers.some((answer) => answer.trim())) {
        const session = this.session;
        this.confirmQuestionVersion(() => {
          if (!this.opened || session !== this.session) return;
          this.answers = ["", "", ""];
          void this.openFor(bookId, chapterId, mode, scheduledFor, question);
        });
        return;
      }
    }
    this.session++;
    this.bookId = bookId;
    this.chapterId = chapterId;
    this.mode = mode;
    this.scheduledFor = scheduledFor;
    this.step = 0;
    this.answers = ["", "", ""];
    this.questions = [];
    this.questionVersion = question?.version ?? 0;
    this.requestedQuestionId = question?.id;
    this.phase = "questions";
    this.saved = null;
    this.feedbackError = "";
    this.questionError = "";
    this.submissionError = "";
    this.questionsLoading = false;
    this.app.workspace.requestSaveLayout();
    this.renderStep();
    await this.loadQuestions();
  }

  private confirmQuestionVersion(onConfirm: () => void): void {
    this.versionModal?.close();
    const modal = new Modal(this.app);
    this.versionModal = modal;
    modal.titleEl.setText("切换问题版本？");
    modal.contentEl.appendChild(el("p", undefined, "当前三问尚未提交。切换后会清除本次草稿，并使用刚刚选中的问题版本。已保存的历史回答不受影响。"));
    const actions = el("div", "qr-answer-actions");
    const cancel = el("button", "qr-btn", "继续当前回答");
    const confirm = el("button", "qr-btn qr-btn-primary", "切换版本");
    cancel.onclick = () => modal.close();
    confirm.onclick = () => { modal.close(); onConfirm(); };
    modal.onClose = () => { if (this.versionModal === modal) this.versionModal = null; };
    actions.append(cancel, confirm);
    modal.contentEl.appendChild(actions);
    modal.open();
    cancel.focus({ preventScroll: true });
  }

  private focusRequestedQuestion(): void {
    if (!this.requestedQuestionId || !this.questions.length) return;
    const index = this.questions.findIndex((question) => question.id === this.requestedQuestionId);
    if (index >= 0) this.step = index;
    this.requestedQuestionId = undefined;
  }

  private async loadQuestions(): Promise<void> {
    if (!this.opened || this.questionsLoading || this.questions.length) return;
    const entry = this.plugin.library.get(this.bookId);
    if (!entry || !isHealthyBook(entry)) { this.renderStep(); return; }
    if (entry.reading.book.format === "cbz") { this.renderStep(); return; }
    const chapter = entry.reading.chapters[this.chapterId];
    if (!chapter) { this.renderStep(); return; }
    const session = this.session;
    const lifetime = this.lifetime;
    const chapterId = this.chapterId;
    this.questionsLoading = true;
    this.questionError = "";
    this.renderStep();
    try {
      if (!chapter.questionVersions.length) await this.plugin.library.ensureQuestions(entry, chapterId);
      if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
      const versions = entry.reading.chapters[chapterId]?.questionVersions ?? [];
      const latest = this.questionVersion ? versions.find((version) => version.version === this.questionVersion) : versions.at(-1);
      const order: QuestionType[] = ["core", "logic", "retell"];
      const questions = order.map((type) => latest?.questions.find((question) => question.type === type));
      if (!latest || questions.some((question) => !question)) throw new Error("本章三问不完整，请重新生成");
      this.questions = questions.filter((question): question is Question => question !== undefined).map((question) => ({ ...question }));
      this.questionVersion = latest.version;
      this.focusRequestedQuestion();
      this.app.workspace.requestSaveLayout();
    } catch (error) {
      if (session === this.session && lifetime === this.lifetime) this.questionError = error instanceof Error ? error.message : String(error);
    } finally {
      if (session === this.session && lifetime === this.lifetime) {
        this.questionsLoading = false;
        if (lifetime === this.lifetime && this.opened) this.renderStep();
      }
    }
  }

  private renderStep(): void {
    if (!this.opened) return;
    const entry = this.plugin.library.get(this.bookId);
    this.contentEl.empty();
    const root = el("div", "qr-answer");
    this.contentEl.appendChild(root);
    const chapter = entry && isHealthyBook(entry) ? entry.reading.chapters[this.chapterId] : undefined;
    if (!entry || !isHealthyBook(entry) || !chapter) {
      root.appendChild(el("div", "qr-muted qr-empty", this.bookId ? "章节不可用，请返回书架检查书籍。" : "请从阅读页或复习页选择章节。"));
      const back = el("button", "qr-btn", "返回书架");
      back.onclick = () => void this.plugin.openBookshelf();
      root.appendChild(back);
      return;
    }
    if (entry.reading.book.format === "cbz") {
      root.appendChild(el("div", "qr-muted qr-empty", "图片书没有文字层，不能进行闭卷回答。"));
      const back = el("button", "qr-btn", "返回阅读");
      back.onclick = () => this.back();
      root.appendChild(back);
      return;
    }
    const header = el("div", "qr-answer-header");
    const back = el("button", "qr-icon-btn");
    back.setAttribute("aria-label", this.mode === "review" ? "返回复习" : "返回阅读");
    setIcon(back, "arrow-left");
    back.disabled = this.phase === "saving";
    back.onclick = () => this.back();
    const titles = el("div", "qr-answer-titles");
    titles.append(el("div", "qr-answer-book", `${entry.reading.book.title} · ${chapter.title}`), el("div", "qr-muted qr-tiny", this.mode === "review" ? "复习中 · 只看问题重新回答" : "回答中 · 原文已隐藏"));
    header.append(back, titles);
    root.appendChild(header);
    if (this.phase === "done") { this.renderResult(root, entry, chapter); return; }
    const body = el("div", "qr-answer-body");
    root.appendChild(body);
    if (this.phase === "saving" || this.phase === "feedback-loading") {
      const status = el("div", "qr-muted qr-pulse", this.phase === "saving" ? "正在保存三题回答……" : "回答已保存，正在获取 AI 反馈……");
      status.setAttribute("role", "status");
      body.appendChild(status);
      return;
    }
    if (!this.questions.length) {
      const status = el("div", "qr-muted", this.questionsLoading ? "正在生成本章三问……" : this.questionError || "本章问题尚未生成");
      status.setAttribute("role", this.questionError ? "alert" : "status");
      body.appendChild(status);
      if (!this.questionsLoading) {
        const retry = el("button", "qr-btn qr-btn-primary", "重新生成三问");
        retry.onclick = () => void this.loadQuestions();
        body.appendChild(retry);
      }
      return;
    }
    const steps = el("div", "qr-answer-steps");
    steps.setAttribute("aria-label", `第 ${this.step + 1} 题，共 3 题`);
    for (let index = 0; index < 3; index++) {
      const dot = el("button", `qr-step-dot${index === this.step ? " qr-step-active" : ""}`, String(index + 1));
      dot.setAttribute("aria-label", `第 ${index + 1} 题，${QUESTION_LABELS[this.questions[index].type]}${this.answers[index].trim() ? "，已填写" : "，未填写"}`);
      dot.onclick = () => { this.step = index; this.app.workspace.requestSaveLayout(); this.renderStep(); };
      if (index === this.step) dot.setAttribute("aria-current", "step");
      steps.appendChild(dot);
    }
    const question = this.questions[this.step];
    body.append(steps, el("div", "qr-question-type", QUESTION_LABELS[question.type]), el("div", "qr-answer-question", question.text));
    const textarea = el("textarea", "qr-textarea qr-answer-input");
    textarea.rows = 7;
    textarea.placeholder = "合上书，用自己的话回答";
    textarea.setAttribute("aria-label", `${QUESTION_LABELS[question.type]}回答`);
    textarea.value = this.answers[this.step];
    body.appendChild(textarea);
    if (this.submissionError) {
      const error = el("div", "qr-inline-error", this.submissionError);
      error.setAttribute("role", "alert");
      body.appendChild(error);
    }
    const actions = el("div", "qr-answer-actions");
    const previous = el("button", "qr-btn", this.step ? "上一题" : this.mode === "review" ? "返回复习" : "返回阅读");
    previous.onclick = () => {
      if (!this.step) this.back();
      else { this.step--; this.app.workspace.requestSaveLayout(); this.renderStep(); }
    };
    const next = el("button", "qr-btn qr-btn-primary");
    const updateNext = (): void => {
      next.setText(this.step < 2 ? "下一题" : this.answers.some((answer) => !answer.trim()) ? "下一道未答题" : "提交三题回答");
      next.disabled = !this.answers[this.step].trim();
    };
    updateNext();
    textarea.oninput = () => {
      this.answers[this.step] = textarea.value;
      this.app.workspace.requestSaveLayout();
      updateNext();
    };
    next.onclick = () => void this.submitStep();
    actions.append(previous, next);
    body.appendChild(actions);
    if (this.app.workspace.getActiveViewOfType(AnswerView) === this) textarea.focus({ preventScroll: true });
  }

  private async submitStep(): Promise<void> {
    if (this.phase !== "questions" || this.saved || !this.answers[this.step].trim()) return;
    if (this.step < 2) { this.step++; this.app.workspace.requestSaveLayout(); this.renderStep(); return; }
    const unanswered = this.answers.findIndex((answer) => !answer.trim());
    if (unanswered >= 0) { this.step = unanswered; this.app.workspace.requestSaveLayout(); this.renderStep(); return; }
    if (this.questions.length !== 3 || this.answers.some((answer) => !answer.trim())) {
      this.submissionError = "请先完成全部三题，再提交回答。";
      this.renderStep();
      return;
    }
    const entry = this.plugin.library.get(this.bookId);
    if (!entry || !isHealthyBook(entry)) return;
    const session = this.session;
    const chapterId = this.chapterId;
    const mode = this.mode;
    const answerMap: Record<string, string> = {};
    this.questions.forEach((question, index) => { answerMap[question.id] = this.answers[index].trim(); });
    this.phase = "saving";
    this.submissionError = "";
    this.renderStep();
    try {
      const saved: SavedSession = mode === "review"
        ? { kind: "review", record: await this.plugin.library.completeReview(entry, chapterId, this.questionVersion, answerMap, this.scheduledFor) }
        : { kind: "answer", record: await this.plugin.library.recordAnswer(entry, chapterId, this.questionVersion, answerMap) };
      if (session !== this.session) return;
      this.saved = saved;
      this.app.workspace.requestSaveLayout();
      if (!this.opened) {
        this.phase = "done";
        this.feedbackError = "回答已保存，重新打开后可获取 AI 反馈。";
        return;
      }
      await this.fetchFeedback(entry, saved);
    } catch (error) {
      if (session !== this.session) return;
      this.phase = this.saved ? "done" : "questions";
      this.submissionError = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      this.renderStep();
    }
  }

  private async fetchFeedback(entry: HealthyBookEntry, saved: SavedSession): Promise<void> {
    if (this.phase === "feedback-loading") return;
    const session = this.session;
    const lifetime = this.lifetime;
    const chapterId = this.chapterId;
    const questions = this.questions;
    const answerMap = saved.record.answers;
    if (!answerMap) return;
    this.phase = "feedback-loading";
    this.feedbackError = "";
    this.renderStep();
    try {
      const text = await this.plugin.library.getChapterText(entry, chapterId);
      if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
      const feedback = await generateFeedback(getAiConfig(this.plugin.settings.ai), entry.reading.book.title, entry.reading.chapters[chapterId]?.title ?? "", text, questions, answerMap);
      if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
      await this.plugin.library.attachFeedback(entry, chapterId, feedback, saved.record);
    } catch (error) {
      if (session === this.session && lifetime === this.lifetime) this.feedbackError = error instanceof Error ? error.message : String(error);
    } finally {
      if (session === this.session && lifetime === this.lifetime) {
        this.phase = "done";
        if (!saved.record.feedback && !this.feedbackError) this.feedbackError = "回答已保存，AI 反馈尚未完成，可重试。";
        if (lifetime === this.lifetime && this.opened) this.renderStep();
      }
    }
  }

  private renderResult(root: HTMLElement, entry: HealthyBookEntry, chapter: ChapterState): void {
    const body = el("div", "qr-answer-body");
    root.appendChild(body);
    body.appendChild(el("div", "qr-answer-question", this.mode === "review" ? "复习完成" : "回答已保存"));
    const saved = this.saved;
    if (!saved) return;
    if (saved.record.feedback) body.appendChild(this.feedbackBlock(saved.record.feedback));
    else {
      const error = el("div", "qr-feedback qr-feedback-error");
      error.append(el("div", "qr-feedback-title", "三题回答已保存，AI 反馈尚未获取"), el("div", "qr-muted", this.feedbackError));
      const retry = el("button", "qr-btn", "重试获取反馈");
      retry.onclick = () => void this.fetchFeedback(entry, saved);
      error.appendChild(retry);
      body.appendChild(error);
    }
    const timeline = this.timeline(chapter);
    const current = timeline.find((item) => item.record === saved.record);
    if (current) body.appendChild(this.answerBlock("本次回答", current, chapter));
    const history = timeline.filter((item) => item.record !== saved.record);
    const previous = history.at(-1);
    if (previous) body.appendChild(this.answerBlock("上一次回答", previous, chapter));
    if (history.length) {
      const section = el("section", "qr-history");
      section.appendChild(el("h2", "qr-question-type", "历次回答"));
      for (const item of [...history].reverse()) {
        const details = el("details", "qr-history-item");
        details.appendChild(el("summary", "qr-history-row", `${item.kind === "review" ? "复习" : "阅读回答"} · ${fmtDateTime(item.at)} · 问题版本 ${item.version}`));
        details.appendChild(this.answerBlock("", item, chapter));
        if (item.record.feedback) details.appendChild(this.feedbackBlock(item.record.feedback));
        section.appendChild(details);
      }
      body.appendChild(section);
    }
    body.appendChild(this.reviewScheduler(entry, chapter));
    const done = el("button", "qr-btn qr-btn-primary", "完成（可跳过复习日期）");
    done.onclick = () => this.back();
    body.appendChild(done);
  }

  private timeline(chapter: ChapterState): HistoryItem[] {
    const history: HistoryItem[] = chapter.answers.map((record) => ({ record, kind: "answer", at: record.answeredAt, answers: record.answers, version: record.questionVersion }));
    for (const record of chapter.reviews) {
      if (record.completedAt && record.answers) history.push({ record, kind: "review", at: record.completedAt, answers: record.answers, version: record.questionVersion ?? 0 });
    }
    return history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  private answerBlock(title: string, item: HistoryItem, chapter: ChapterState): HTMLElement {
    const box = el("div", "qr-compare");
    if (title) box.appendChild(el("div", "qr-question-type", title));
    box.appendChild(el("div", "qr-muted qr-tiny", `${fmtDateTime(item.at)} · 问题版本 ${item.version}`));
    const version = chapter.questionVersions.find((questionVersion) => questionVersion.version === item.version);
    if (!version) {
      box.appendChild(el("div", "qr-inline-error", "该次问题版本不可用；以下保留原回答及问题编号。"));
      for (const [id, answer] of Object.entries(item.answers)) {
        box.append(el("div", "qr-muted qr-tiny", id), el("div", "qr-compare-text", answer));
      }
      return box;
    }
    for (const question of version.questions) {
      const row = el("div", "qr-compare-item");
      row.append(el("div", "qr-muted qr-tiny", QUESTION_LABELS[question.type]), el("div", "qr-compare-question", question.text), el("div", "qr-compare-text", item.answers[question.id] || "（未作答）"));
      box.appendChild(row);
    }
    return box;
  }

  private feedbackBlock(feedback: Feedback): HTMLElement {
    const box = el("div", "qr-feedback");
    const sections = [
      { title: "作者观点", content: feedback.authorView },
      { title: "值得再想想", content: feedback.rethink },
      { title: "事实错误", content: feedback.factualErrors },
    ];
    for (const section of sections) {
      if (!section.content) continue;
      const row = el("div", "qr-feedback-section");
      row.append(el("div", "qr-feedback-title", section.title), el("div", "qr-feedback-text", section.content));
      box.appendChild(row);
    }
    box.appendChild(el("div", "qr-muted qr-tiny qr-feedback-motto", "理解作者，不等于认同作者。"));
    return box;
  }

  private reviewScheduler(entry: HealthyBookEntry, chapter: ChapterState): HTMLElement {
    const box = el("div", "qr-review-scheduler");
    box.append(el("div", "qr-question-type", "复习日期（可选）"), el("div", "qr-muted qr-tiny", "自由选择未来某天，也可以直接完成，不设置日期。"));
    const pending = chapter.reviews.filter((review) => review.scheduledFor && !review.completedAt);
    if (pending.length) box.appendChild(el("div", "qr-muted", `已安排：${pending.map((review) => review.scheduledFor).join("、")}`));
    const row = el("div", "qr-form-row");
    const date = el("input", "qr-input");
    date.type = "date";
    date.setAttribute("aria-label", "未来复习日期");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    date.min = fmtDateTime(tomorrow.toISOString()).slice(0, 10);
    const set = el("button", "qr-btn", "设置复习日期");
    set.disabled = true;
    date.oninput = () => { set.disabled = !date.value || date.value <= todayStr(); };
    const message = el("div", "qr-status qr-muted");
    message.setAttribute("role", "status");
    const session = this.session;
    const lifetime = this.lifetime;
    const chapterId = this.chapterId;
    set.onclick = async () => {
      if (!date.value || date.value <= todayStr()) { message.setText("请选择未来的日期。"); return; }
      const selected = date.value;
      set.disabled = true;
      date.disabled = true;
      set.setText("正在保存……");
      try {
        await this.plugin.library.scheduleReview(entry, chapterId, selected);
        if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
        message.setText(`已安排在 ${selected} 复习。`);
        set.setText("已设置");
      } catch (error) {
        if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
        message.setText(`设置失败：${error instanceof Error ? error.message : String(error)}`);
        set.disabled = false;
        date.disabled = false;
        set.setText("设置复习日期");
      }
    };
    row.append(date, set);
    box.append(row, message);
    return box;
  }

  private back(): void {
    if (this.mode === "review") void this.plugin.openReview(this.bookId);
    else void this.plugin.openReader(this.bookId);
  }
}

export function pendingReviewsOf(entry: HealthyBookEntry): { chapterId: string; ch: ChapterState; r: ReviewRecord }[] {
  const pending: { chapterId: string; ch: ChapterState; r: ReviewRecord }[] = [];
  for (const [chapterId, chapter] of Object.entries(entry.reading.chapters)) {
    for (const review of chapter.reviews) {
      if (review.scheduledFor && !review.completedAt) pending.push({ chapterId, ch: chapter, r: review });
    }
  }
  return pending;
}
