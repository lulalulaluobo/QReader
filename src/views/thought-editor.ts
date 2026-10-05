import { Modal, Notice } from "obsidian";
import type { QReaderPlugin } from "../main";
import type { MessageKey } from "../i18n";
import { el } from "../util";
import { RELATIONS, RELATION_LABELS } from "../core/thought-data";
import type { Relation, ThoughtItem, TraceSource } from "../core/thought-data";

export class TextEditorModal extends Modal {
  private unsubscribe: (() => void) | null = null;
  constructor(private plugin: QReaderPlugin, private heading: MessageKey, private fields: { label: MessageKey; value: string; multiline?: boolean }[], private save: (values: string[]) => Promise<void>) { super(plugin.app); }
  onOpen(): void {
    this.contentEl.addClass("qr-thought-editor");
    const title = el("h2"); this.contentEl.appendChild(title);
    const labels: HTMLLabelElement[] = [];
    const inputs: (HTMLInputElement | HTMLTextAreaElement)[] = [];
    for (const [index, field] of this.fields.entries()) {
      const label = el("label", "qr-question-type"); labels.push(label);
      const input = field.multiline ? el("textarea", "qr-input qr-thought-input") : el("input", "qr-input");
      input.id = `qr-thought-field-${index}`; label.htmlFor = input.id; input.value = field.value;
      if (input.tagName === "TEXTAREA") (input as HTMLTextAreaElement).rows = 4;
      inputs.push(input); this.contentEl.append(label, input);
    }
    const actions = el("div", "qr-note-actions");
    const cancel = el("button", "qr-btn"); cancel.onclick = () => this.close();
    const save = el("button", "qr-btn qr-btn-primary");
    const root = this.plugin.settings.libraryPath;
    save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        if (root !== this.plugin.settings.libraryPath) throw new Error(this.plugin.t("阅读库已切换，请重新打开"));
        await this.save(inputs.map(input => input.value)); this.close();
      } catch (error) { new Notice(this.plugin.errorText(error)); }
      finally { save.disabled = false; }
    };
    actions.append(cancel, save); this.contentEl.appendChild(actions);
    const translate = (): void => {
      this.contentEl.lang = this.plugin.settings.language;
      title.setText(this.plugin.t(this.heading));
      labels.forEach((label, index) => label.setText(this.plugin.t(this.fields[index].label)));
      cancel.setText(this.plugin.t("取消")); save.setText(this.plugin.t("保存"));
    };
    translate(); this.unsubscribe = this.plugin.onSettingsChanged(reason => { if (reason === "language") translate(); });
  }
  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
}

class ScopedModal extends Modal {
  unsubscribe: (() => void) | undefined;
  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
}

export function confirmAction(plugin: QReaderPlugin, message: MessageKey, run: () => Promise<void>): void {
  const modal = new ScopedModal(plugin.app);
  const scope = plugin.settings.libraryPath;
  const text = el("p", "qr-note-understanding", plugin.t(message));
  const actions = el("div", "qr-note-actions");
  const cancel = el("button", "qr-btn", plugin.t("取消")); cancel.onclick = () => modal.close();
  const ok = el("button", "qr-btn qr-btn-danger", plugin.t("确认删除"));
  ok.onclick = async () => {
    if (ok.disabled) return; ok.disabled = true;
    try { if (scope !== plugin.settings.libraryPath) throw new Error(plugin.t("阅读库已切换，请重新打开")); await run(); modal.close(); }
    catch (error) { new Notice(plugin.errorText(error)); }
    finally { ok.disabled = false; }
  };
  const translate = (): void => { modal.contentEl.lang = plugin.settings.language; text.setText(plugin.t(message)); cancel.setText(plugin.t("取消")); ok.setText(plugin.t("确认删除")); };
  translate(); modal.unsubscribe = plugin.onSettingsChanged(reason => { if (reason === "language") translate(); });
  actions.append(cancel, ok); modal.contentEl.append(text, actions); modal.open();
}

export async function joinThread(plugin: QReaderPlugin, source: TraceSource, options: { target?: TraceSource; relation?: Relation; reason?: string; title?: string }, done: (id: string) => void): Promise<void> {
  const scope = plugin.settings.libraryPath;
  const file = await plugin.thinking.load();
  if (scope !== plugin.settings.libraryPath) throw new Error(plugin.t("阅读库已切换，请重新打开"));
  const modal = new ScopedModal(plugin.app);
  modal.contentEl.addClass("qr-thought-editor"); modal.contentEl.lang = plugin.settings.language;
  const heading = el("h2", undefined, plugin.t("加入思考线"));
  const label = el("label", "qr-question-type", plugin.t("选择思考线"));
  const select = el("select", "qr-input"); select.id = "qr-thought-target"; label.htmlFor = select.id;
  const create = el("option", undefined, plugin.t("新建思考线")); create.value = ""; select.appendChild(create);
  for (const thread of file.threads) { const option = el("option", undefined, thread.title); option.value = thread.id; select.appendChild(option); }
  const titleLabel = el("label", "qr-question-type", plugin.t("思考线标题"));
  const title = el("input", "qr-input"); title.id = "qr-thought-new-title"; titleLabel.htmlFor = title.id; title.value = options.title ?? "";
  select.onchange = () => { title.disabled = !!select.value; };
  const relationLabel = el("label", "qr-question-type", plugin.t("与已有记录的关系"));
  const relation = el("select", "qr-input"); relation.id = "qr-thought-relation"; relationLabel.htmlFor = relation.id;
  for (const type of RELATIONS) { const option = el("option", undefined, plugin.t(RELATION_LABELS[type])); option.value = type; relation.appendChild(option); }
  relation.value = options.relation ?? "related";
  const reasonLabel = el("label", "qr-question-type", plugin.t("关联说明（可修改）"));
  const reason = el("textarea", "qr-input qr-thought-input"); reason.id = "qr-thought-reason"; reasonLabel.htmlFor = reason.id; reason.rows = 3; reason.value = options.reason ?? "";
  const cancel = el("button", "qr-btn", plugin.t("取消")); cancel.onclick = () => modal.close();
  const save = el("button", "qr-btn qr-btn-primary", plugin.t("确认加入"));
  save.onclick = async () => {
    if (save.disabled) return; save.disabled = true;
    try {
      if (scope !== plugin.settings.libraryPath) throw new Error(plugin.t("阅读库已切换，请重新打开"));
      const at = new Date().toISOString();
      const items: ThoughtItem[] = options.target ? [{ ref: options.target.ref, relation: "related", reason: "", addedAt: at }] : [];
      items.push({ ref: source.ref, relation: relation.value as Relation, reason: reason.value, addedAt: at });
      let id = select.value;
      if (id) await plugin.thinking.addItems(id, items);
      else id = await plugin.thinking.saveThread(undefined, title.value, "", "", items);
      done(id); modal.close();
    } catch (error) { new Notice(plugin.errorText(error)); }
    finally { save.disabled = false; }
  };
  const actions = el("div", "qr-note-actions"); actions.append(cancel, save);
  modal.contentEl.append(heading, label, select, titleLabel, title, relationLabel, relation, reasonLabel, reason, actions);
  const translate = (): void => {
    modal.contentEl.lang = plugin.settings.language;
    heading.setText(plugin.t("加入思考线")); label.setText(plugin.t("选择思考线")); create.setText(plugin.t("新建思考线"));
    titleLabel.setText(plugin.t("思考线标题")); relationLabel.setText(plugin.t("与已有记录的关系")); reasonLabel.setText(plugin.t("关联说明（可修改）"));
    RELATIONS.forEach((type, index) => relation.options[index].setText(plugin.t(RELATION_LABELS[type])));
    cancel.setText(plugin.t("取消")); save.setText(plugin.t("确认加入"));
  };
  translate(); modal.unsubscribe = plugin.onSettingsChanged(reason => { if (reason === "language") translate(); });
  modal.open();
}
