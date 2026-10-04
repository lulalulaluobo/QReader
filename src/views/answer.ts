import { ItemView, Modal, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { AnswerRecord, ChapterState, HealthyBookEntry, Question, QuestionType, ReviewRecord } from "../types";
import { QUESTION_LABELS, isHealthyBook } from "../types";
import type { QReaderPlugin } from "../main";
import { el } from "../util";
import { generateFeedback } from "../ai/tasks";
import { getAiConfig } from "../ai/providers";
import { chapterNotes } from "../core/chapter-notes";
import { feedbackBlock, noteBlock, renderNoteHistory } from "./note-content";

export const VIEW_TYPE_ANSWER = "qreader-answer";
export type AnswerMode = "answer" | "review";

type SavedSession = { kind: "answer"; record: AnswerRecord } | { kind: "review"; record: ReviewRecord };

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
  private unsubSettings: (() => void) | null = null;
  private requestedQuestionId: string | undefined;
  private versionModal: Modal | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: QReaderPlugin) {
    super(leaf);
    this.navigation = true;
  }
  getViewType(): string { return VIEW_TYPE_ANSWER; }
  getDisplayText(): string { return this.plugin.t("QReader · 阅读想法"); }
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
    result.history ||= this.bookId !== state.bookId || this.chapterId !== state.chapterId
      || this.mode !== ("mode" in state && state.mode === "review" ? "review" : "answer");
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
    this.requestedQuestionId = "requestedQuestionId" in state && typeof state.requestedQuestionId === "string" ? state.requestedQuestionId : undefined;
    this.questionsLoading = false;
    this.saved = null;
    this.phase = "questions";
    this.feedbackError = "";
    this.questionError = "";
    this.submissionError = "";
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
    this.contentEl.lang = this.plugin.settings.language;
    this.plugin.syncReadingChrome();
    this.contentEl.addClass("qr-view");
    this.unsubSettings = this.plugin.onSettingsChanged((reason) => {
      if (reason === "language" && this.opened) this.renderStep();
    });
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
    this.plugin.rememberPageState(this.getViewType(), this.getState());
    this.opened = false;
    this.versionModal?.close();
    this.lifetime++;
    this.questionsLoading = false;
    if (this.phase === "feedback-loading") {
      this.phase = "done";
      this.feedbackError = this.plugin.t("回答已保存，AI 反馈尚未完成，可重试。");
    }
    this.unsub?.();
    this.unsubSettings?.();
    this.unsubSettings = null;
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
    modal.titleEl.setText(this.plugin.t("切换问题版本？"));
    modal.contentEl.appendChild(el("p", undefined, this.plugin.t("当前想法尚未保存。切换后会清除本次草稿，并使用选中的问题版本。已保存的笔记不受影响。")));
    const actions = el("div", "qr-answer-actions");
    const cancel = el("button", "qr-btn", this.plugin.t("继续当前回答"));
    const confirm = el("button", "qr-btn qr-btn-primary", this.plugin.t("切换版本"));
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
      if (!latest || questions.some((question) => !question)) throw new Error(this.plugin.t("本章三问不完整，请重新生成"));
      this.questions = questions.filter((question): question is Question => question !== undefined).map((question) => ({ ...question }));
      this.questionVersion = latest.version;
      this.focusRequestedQuestion();
      this.app.workspace.requestSaveLayout();
    } catch (error) {
      if (session === this.session && lifetime === this.lifetime) this.questionError = this.plugin.errorText(error);
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
      root.appendChild(el("div", "qr-muted qr-empty", this.bookId ? this.plugin.t("章节不可用，请返回书架检查书籍。") : this.plugin.t("请从阅读页或笔记页选择章节。")));
      const back = el("button", "qr-btn", this.plugin.t("返回书架"));
      back.onclick = () => void this.plugin.openBookshelf();
      root.appendChild(back);
      return;
    }
    if (entry.reading.book.format === "cbz") {
      root.appendChild(el("div", "qr-muted qr-empty", this.plugin.t("图片书没有文字层，不能生成阅读三问。")));
      const back = el("button", "qr-btn", this.plugin.t("返回阅读"));
      back.onclick = () => this.back();
      root.appendChild(back);
      return;
    }
    const header = el("div", "qr-answer-header");
    const back = el("button", "qr-icon-btn");
    back.setAttribute("aria-label", this.mode === "review" ? this.plugin.t("返回笔记") : this.plugin.t("返回阅读"));
    setIcon(back, "arrow-left");
    back.disabled = this.phase === "saving";
    back.onclick = () => this.back();
    const titles = el("div", "qr-answer-titles");
    titles.append(el("div", "qr-answer-book", `${entry.reading.book.title} · ${chapter.title}`), el("div", "qr-muted qr-tiny", this.plugin.t("写下想法 · 可只记一题，也可以略过")));
    header.append(back, titles);
    root.appendChild(header);
    if (this.phase === "done") { this.renderResult(root, entry, chapter); return; }
    const body = el("div", "qr-answer-body");
    root.appendChild(body);
    if (this.phase === "saving" || this.phase === "feedback-loading") {
      const status = el("div", "qr-muted qr-pulse", this.phase === "saving" ? this.plugin.t("正在保存笔记……") : this.plugin.t("笔记已保存，正在获取 AI 参考评价……"));
      status.setAttribute("role", "status");
      body.appendChild(status);
      return;
    }
    if (!this.questions.length) {
      const status = el("div", "qr-muted", this.questionsLoading ? this.plugin.t("正在生成本章三问……") : this.plugin.localizeStatus(this.questionError) || this.plugin.t("本章问题尚未生成"));
      status.setAttribute("role", this.questionError ? "alert" : "status");
      body.appendChild(status);
      if (!this.questionsLoading) {
        const retry = el("button", "qr-btn qr-btn-primary", this.plugin.t("重新生成三问"));
        retry.onclick = () => void this.loadQuestions();
        body.appendChild(retry);
      }
      return;
    }
    const steps = el("div", "qr-answer-steps");
    steps.setAttribute("aria-label", this.plugin.t("第 {0} 题，共 3 题", this.step + 1));
    for (let index = 0; index < 3; index++) {
      const dot = el("button", `qr-step-dot${index === this.step ? " qr-step-active" : ""}`, String(index + 1));
      dot.setAttribute("aria-label", this.plugin.t("第 {0} 题，{1}{2}", index + 1, this.plugin.t(QUESTION_LABELS[this.questions[index].type]), this.answers[index].trim() ? this.plugin.t("，已填写") : this.plugin.t("，未填写")));
      dot.onclick = () => { this.step = index; this.app.workspace.requestSaveLayout(); this.renderStep(); };
      if (index === this.step) dot.setAttribute("aria-current", "step");
      steps.appendChild(dot);
    }
    const question = this.questions[this.step];
    body.append(steps, el("div", "qr-question-type", this.plugin.t(QUESTION_LABELS[question.type])), el("div", "qr-answer-question", question.text));
    const textarea = el("textarea", "qr-textarea qr-answer-input");
    textarea.rows = 7;
    textarea.placeholder = this.plugin.t("用自己的话记一点想法，可以暂时留空");
    textarea.setAttribute("aria-label", this.plugin.t("{0}的阅读想法", this.plugin.t(QUESTION_LABELS[question.type])));
    textarea.value = this.answers[this.step];
    body.appendChild(textarea);
    if (this.submissionError) {
      const error = el("div", "qr-inline-error", this.plugin.localizeStatus(this.submissionError));
      error.setAttribute("role", "alert");
      body.appendChild(error);
    }
    const actions = el("div", "qr-answer-actions");
    const previous = el("button", "qr-btn", this.step ? this.plugin.t("上一题") : this.mode === "review" ? this.plugin.t("返回笔记") : this.plugin.t("返回阅读"));
    previous.onclick = () => {
      if (!this.step) this.back();
      else { this.step--; this.app.workspace.requestSaveLayout(); this.renderStep(); }
    };
    const next = el("button", "qr-btn", this.step < 2 ? this.plugin.t("下一题") : this.plugin.t("回到第一题"));
    next.onclick = () => { this.step = (this.step + 1) % 3; this.app.workspace.requestSaveLayout(); this.renderStep(); };
    const save = el("button", "qr-btn qr-btn-primary", this.plugin.t("保存想法"));
    const updateSave = (): void => { save.disabled = !this.answers.some(answer => answer.trim()); };
    updateSave();
    textarea.oninput = () => {
      this.answers[this.step] = textarea.value;
      this.app.workspace.requestSaveLayout();
      updateSave();
    };
    save.onclick = () => void this.submitStep();
    actions.append(previous, next, save);
    body.appendChild(actions);
    body.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("保存不调用 AI。需要时，再主动获取参考评价。")));
    body.appendChild(renderNoteHistory(this.plugin, chapter));
    if (this.app.workspace.getActiveViewOfType(AnswerView) === this) textarea.focus({ preventScroll: true });
  }

  private async submitStep(): Promise<void> {
    if (this.phase !== "questions" || this.saved) return;
    if (this.questions.length !== 3 || !this.answers.some(answer => answer.trim())) {
      this.submissionError = this.plugin.t("请先记录一点想法，再保存笔记。");
      this.renderStep();
      return;
    }
    const entry = this.plugin.library.get(this.bookId);
    if (!entry || !isHealthyBook(entry)) return;
    const session = this.session;
    const chapterId = this.chapterId;
    const answerMap: Record<string, string> = {};
    this.questions.forEach((question, index) => { if (this.answers[index].trim()) answerMap[question.id] = this.answers[index].trim(); });
    this.phase = "saving";
    this.submissionError = "";
    this.renderStep();
    try {
      const saved: SavedSession = { kind: "answer", record: await this.plugin.library.recordAnswer(entry, chapterId, this.questionVersion, answerMap) };
      if (session !== this.session) return;
      this.saved = saved;
      this.plugin.rememberPageState(this.getViewType(), this.getState());
      this.app.workspace.requestSaveLayout();
      this.phase = "done";
      this.feedbackError = "";
      this.renderStep();
    } catch (error) {
      if (session !== this.session) return;
      this.phase = this.saved ? "done" : "questions";
      this.submissionError = this.plugin.t("保存失败：{0}", this.plugin.errorText(error));
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
      const feedback = await generateFeedback(getAiConfig(this.plugin.settings.ai), entry.reading.book.title, entry.reading.chapters[chapterId]?.title ?? "", text, questions, answerMap, this.plugin.settings.language);
      if (session !== this.session || lifetime !== this.lifetime || !this.opened) return;
      await this.plugin.library.attachFeedback(entry, chapterId, feedback, saved.record);
    } catch (error) {
      if (session === this.session && lifetime === this.lifetime) this.feedbackError = this.plugin.errorText(error);
    } finally {
      if (session === this.session && lifetime === this.lifetime) {
        this.phase = "done";
        if (!saved.record.feedback && !this.feedbackError) this.feedbackError = this.plugin.t("回答已保存，AI 反馈尚未完成，可重试。");
        if (lifetime === this.lifetime && this.opened) this.renderStep();
      }
    }
  }

  private renderResult(root: HTMLElement, entry: HealthyBookEntry, chapter: ChapterState): void {
    const body = el("div", "qr-answer-body");
    root.appendChild(body);
    body.appendChild(el("div", "qr-answer-question", this.plugin.t("笔记已保存")));
    const saved = this.saved;
    if (!saved) return;
    const current = chapterNotes(chapter).find(item => item.record === saved.record);
    if (current) body.appendChild(noteBlock(this.plugin, current, chapter));
    if (saved.record.feedback) body.appendChild(feedbackBlock(this.plugin, saved.record.feedback));
    else {
      body.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("可以到这里结束，也可以请 AI 提供参考评价。")));
      if (this.feedbackError) {
        const error = el("div", "qr-inline-error", this.plugin.localizeStatus(this.feedbackError));
        error.setAttribute("role", "alert");
        body.appendChild(error);
      }
      const evaluate = el("button", "qr-btn", this.plugin.t("获取 AI 参考评价"));
      evaluate.onclick = () => void this.fetchFeedback(entry, saved);
      body.appendChild(evaluate);
    }
    body.appendChild(el("p", "qr-muted qr-tiny", this.plugin.t("AI 评价只供参考，不是标准答案。理解作者不等于认同作者。")));
    const actions = el("div", "qr-answer-actions");
    const add = el("button", "qr-btn", this.plugin.t("补充想法"));
    add.onclick = () => {
      this.answers = this.questions.map(question => saved.record.answers?.[question.id] ?? "");
      this.saved = null; this.phase = "questions"; this.feedbackError = ""; this.submissionError = "";
      this.plugin.rememberPageState(this.getViewType(), this.getState());
      this.app.workspace.requestSaveLayout(); this.renderStep();
    };
    const notes = el("button", "qr-btn", this.plugin.t("查看本章笔记"));
    notes.onclick = () => void this.plugin.openNotes(entry.id, this.chapterId);
    const done = el("button", "qr-btn qr-btn-primary", this.mode === "review" ? this.plugin.t("返回笔记") : this.plugin.t("返回阅读"));
    done.onclick = () => this.back();
    actions.append(add, notes, done); body.appendChild(actions);
    body.appendChild(renderNoteHistory(this.plugin, chapter, saved.record));
  }

  private back(): void {
    if (this.mode === "review") void this.plugin.openNotes(this.bookId, this.chapterId);
    else void this.plugin.openReader(this.bookId);
  }
}
