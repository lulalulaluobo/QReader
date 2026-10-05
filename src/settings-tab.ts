// Plugin settings tab (PRD §29): 阅读库, AI 配置, 阅读设置.

import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { QReaderPlugin } from "./main";
import { validateLibraryPath } from "./settings";
import { testConnection } from "./ai/client";
import { normalizeLanguage } from "./i18n";
import { AI_PRESETS, getAiConfig } from "./ai/providers";
import type { AiProvider } from "./ai/providers";

export class QReaderSettingTab extends PluginSettingTab {
  private testStatus = "";
  private testing = false;
  private configRevision = 0;
  private renderAi: (() => void) | null = null;
  private pathDraft: string | null = null;

  constructor(app: App, private plugin: QReaderPlugin) {
    super(app, plugin);
  }

  hide(): void {
    this.configRevision++;
    this.testStatus = "";
    this.renderAi = null;
    this.pathDraft = null;
  }

  display(preserveDraft = false): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    containerEl.lang = s.language;
    let proposedPath = preserveDraft ? this.pathDraft ?? s.libraryPath : s.libraryPath;
    this.pathDraft = proposedPath;
    this.testStatus = this.plugin.localizeStatus(this.testStatus);

    containerEl.createEl("h2", { text: "QReader" });

    new Setting(containerEl).setName(this.plugin.t("语言"))
      .setDesc(this.plugin.t("界面和默认 AI 提示词使用所选语言；已有书籍、笔记、问题和回答保持原样。"))
      .addDropdown((dropdown) => {
        dropdown.selectEl.id = "qreader-language";
        dropdown.selectEl.setAttribute("aria-label", this.plugin.t("语言"));
        dropdown.addOptions({ "zh-CN": "简体中文", en: "English" }).setValue(s.language)
          .onChange(async (value) => {
            const next = normalizeLanguage(value);
            if (next === s.language) return;
            const previous = s.language;
            dropdown.setDisabled(true);
            this.configRevision++;
            try {
              s.language = next;
              await this.plugin.saveSettings();
              this.plugin.notifySettingsChanged("language");
              this.display(true);
              this.containerEl.querySelector<HTMLElement>("#qreader-language")?.focus();
            } catch {
              s.language = previous;
              new Notice(this.plugin.t("语言保存失败，请重试"));
              dropdown.setValue(previous);
            } finally { dropdown.setDisabled(false); }
          });
      });

    new Setting(containerEl)
      .setName(this.plugin.t("阅读库路径"))
      .setDesc(this.plugin.t("Vault 内的相对路径，例如 Books。导入的书籍会存放在这里。"))
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(proposedPath)
          .onChange((value) => { proposedPath = value; this.pathDraft = value; })
      )
      .addButton((button) => button.setButtonText(this.plugin.t("保存路径")).onClick(async () => {
        const result = validateLibraryPath(proposedPath);
        if (!result.ok) {
          new Notice(result.error ? this.plugin.errorText(result.error) : this.plugin.t("路径无效"));
          return;
        }
        const previous = s.libraryPath;
        button.setDisabled(true);
        try {
          s.libraryPath = result.path;
          await this.plugin.saveSettings();
          await this.plugin.library.scan(true);
          this.plugin.notifyChanged();
          new Notice(this.plugin.t("阅读库路径已保存"));
        } catch (error) {
          s.libraryPath = previous;
          await this.plugin.saveSettings();
          new Notice(this.plugin.t("路径保存失败：{0}", this.plugin.errorText(error)));
        } finally {
          button.setDisabled(false);
        }
      }));

    const aiContainer = containerEl.createDiv({ cls: "qr-ai-settings" });
    const renderAi = (): void => {
      aiContainer.empty();
      const ai = s.ai;
      const provider = ai.provider;
      aiContainer.createEl("h3", { text: this.plugin.t("AI 配置") });
      const providers = new Setting(aiContainer)
        .setName(this.plugin.t("AI 服务"))
        .setDesc(this.plugin.t("每个服务独立保存接口地址、模型和密钥。请填写你信任的 OpenAI Compatible 接口。"));
      providers.settingEl.addClass("qr-ai-providers");
      const options: AiProvider[] = ["deepseek", "agnes", "custom"];
      for (const option of options) {
        providers.addButton((button) => {
          button.setButtonText(option === "custom" ? this.plugin.t("自定义接口") : AI_PRESETS[option].name);
          button.buttonEl.addClass("qr-ai-provider");
          if (option === provider) button.buttonEl.addClass("qr-ai-provider-active");
          button.buttonEl.setAttribute("aria-pressed", String(option === provider));
          button.buttonEl.style.minHeight = "44px";
          button.buttonEl.style.minWidth = "44px";
          button.onClick(async () => {
            if (ai.provider === option) return;
            ai.provider = option;
            this.configRevision++;
            this.testStatus = "";
            renderAi();
            aiContainer.querySelector<HTMLButtonElement>(".qr-ai-provider-active")?.focus();
            try { await this.plugin.saveSettings(); }
            catch { new Notice(this.plugin.t("AI 服务选择保存失败，请重试")); }
          });
        });
      }
      const persistAiChange = async (): Promise<void> => {
        this.configRevision++;
        this.testStatus = "";
        statusEl.setText("");
        try { await this.plugin.saveSettings(); }
        catch { new Notice(this.plugin.t("AI 配置保存失败，请重新编辑后重试")); }
      };
      const config = getAiConfig(ai);
      const changeConfig = (field: "baseUrl" | "model", value: string): void => {
        if (provider === "custom") ai.custom[field] = value;
        else if (provider === "deepseek") {
          if (field === "baseUrl") ai.deepseekBaseUrl = value;
          else ai.deepseekModel = value;
        } else {
          if (field === "baseUrl") ai.agnesBaseUrl = value;
          else ai.agnesModel = value;
        }
      };
      if (provider !== "custom") {
        new Setting(aiContainer).setName(this.plugin.t("模型模板"))
          .setDesc(this.plugin.t("选择模板填写模型 ID；接口地址和密钥保持当前值，也可手动填写其他模型。"))
          .addDropdown((dropdown) => {
            dropdown.selectEl.setAttribute("aria-label", this.plugin.t("模型模板"));
            dropdown.addOption("", this.plugin.t("选择模型模板"));
            for (const model of AI_PRESETS[provider].models) dropdown.addOption(model, model);
            dropdown.onChange(async (value) => {
              if (!value) return;
              changeConfig("model", value);
              await persistAiChange();
              renderAi();
            });
          });
      }
      new Setting(aiContainer).setName("Base URL")
        .setDesc(this.plugin.t("每个服务独立保存接口地址、模型和密钥。请填写你信任的 OpenAI Compatible 接口。"))
        .addText((text) => {
          text.inputEl.setAttribute("aria-label", `${provider} Base URL`);
          text.setPlaceholder(provider === "custom" ? "https://api.openai.com/v1" : AI_PRESETS[provider].baseUrl)
            .setValue(config.baseUrl).onChange(async (value) => { changeConfig("baseUrl", value); await persistAiChange(); });
        });
      new Setting(aiContainer).setName("Model").addText((text) => {
        text.inputEl.setAttribute("aria-label", `${provider} Model`);
        text.setPlaceholder(this.plugin.t("模型 ID")).setValue(config.model)
          .onChange(async (value) => { changeConfig("model", value); await persistAiChange(); });
      });
      const keyLabel = provider === "custom" ? this.plugin.t("自定义接口 API Key") : `${AI_PRESETS[provider].name} API Key`;
      const apiKey = provider === "deepseek" ? ai.deepseekApiKey : provider === "agnes" ? ai.agnesApiKey : ai.custom.apiKey;
      new Setting(aiContainer).setName(keyLabel)
        .setDesc(this.plugin.t("保存在插件本地 data.json 中，未加密。请保护 Vault 同步和备份；不同服务的密钥互不继承。"))
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.inputEl.setAttribute("aria-label", keyLabel);
          text.setPlaceholder(this.plugin.t("填写该服务的 API Key")).setValue(apiKey).onChange(async (value) => {
            if (provider === "deepseek") ai.deepseekApiKey = value;
            else if (provider === "agnes") ai.agnesApiKey = value;
            else ai.custom.apiKey = value;
            await persistAiChange();
          });
        });
      new Setting(aiContainer).setName(this.plugin.t("测试连接"))
        .setDesc(this.plugin.t("选文与相关上下文会按需发送到所选接口，用于解读和整句翻译。寻找笔记关联时，会发送当前想法和最多十条候选笔记片段。连接测试只发送探针。"))
        .addButton((button) => button.setButtonText(this.testing ? this.plugin.t("正在测试……") : this.plugin.t("测试连接"))
          .setDisabled(this.testing).onClick(async () => {
            if (this.testing) return;
            const snapshot = { ...getAiConfig(ai) };
            const revision = this.configRevision;
            this.testing = true;
            this.testStatus = this.plugin.t("正在测试……");
            renderAi();
            try {
              const result = await testConnection(snapshot);
              const current = getAiConfig(s.ai);
              if (this.configRevision !== revision || s.ai.provider !== provider || current.baseUrl !== snapshot.baseUrl || current.model !== snapshot.model || current.apiKey !== snapshot.apiKey) return;
              this.testStatus = this.plugin.localizeStatus(result.message);
              new Notice(result.ok ? this.plugin.t("连接成功") : this.plugin.t("连接失败"), 4000);
            } catch {
              if (this.configRevision === revision && s.ai.provider === provider) {
                this.testStatus = this.plugin.t("AI 连接失败，请检查网络和接口配置");
                new Notice(this.testStatus);
              }
            } finally {
              this.testing = false;
              this.renderAi?.();
            }
          }));
      const statusEl = aiContainer.createEl("p", { text: this.testStatus, cls: "qr-settings-status" });
      statusEl.setAttribute("role", "status");
      statusEl.setAttribute("aria-live", "polite");
    };
    this.renderAi = renderAi;
    renderAi();

    containerEl.createEl("h3", { text: this.plugin.t("翻译") });
    new Setting(containerEl).setName(this.plugin.t("翻译服务")).setDesc(this.plugin.t("有道单词查询，无需密钥；主动查词时获取中文释义、音标和发音。"));
    new Setting(containerEl).setName(this.plugin.t("整句翻译")).setDesc(this.plugin.t("选句后点击 AI 翻译，使用已配置的 AI 服务译为中文，不加入生词表。"));
    const saveTranslation = async (): Promise<void> => {
      try { await this.plugin.saveSettings(); this.plugin.notifySettingsChanged("translation"); }
      catch { new Notice(this.plugin.t("翻译设置保存失败，请重试")); }
    };
    containerEl.createEl("h3", { text: this.plugin.t("动态生词") });
    new Setting(containerEl).setName(this.plugin.t("查询后自动加入生词表")).addToggle((toggle) =>
      toggle.setValue(s.translation.autoAdd).onChange(async (value) => { s.translation.autoAdd = value; await saveTranslation(); }));
    new Setting(containerEl).setName(this.plugin.t("后续出现自动高亮")).addToggle((toggle) =>
      toggle.setValue(s.translation.highlight).onChange(async (value) => { s.translation.highlight = value; await saveTranslation(); }));
    const threshold = new Setting(containerEl).setName(this.plugin.t("自动删除阈值"))
      .setDesc(this.plugin.t("连续遇到但未查询的次数，默认 5 次。离开段落或翻页时结算，同段回看不重复。"));
    threshold.addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute("aria-label", this.plugin.t("自动删除阈值"));
      dropdown.addOptions({ "3": "3", "4": "4", "5": "5", custom: this.plugin.t("自定义") })
        .setValue([3, 4, 5].includes(s.translation.deletionThreshold) ? String(s.translation.deletionThreshold) : "custom")
        .onChange(async (value) => {
          if (value === "custom") { threshold.settingEl.querySelector<HTMLInputElement>("input")?.focus(); return; }
          s.translation.deletionThreshold = Number(value);
          const input = threshold.settingEl.querySelector<HTMLInputElement>("input"); if (input) input.value = value;
          await saveTranslation();
        });
    }).addText((text) => {
      text.inputEl.type = "number"; text.inputEl.min = "1"; text.inputEl.max = "100"; text.inputEl.step = "1";
      text.inputEl.setAttribute("aria-label", this.plugin.t("自定义未查询次数"));
      text.setValue(String(s.translation.deletionThreshold)).onChange(async (value) => {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 100) { text.inputEl.setAttribute("aria-invalid", "true"); return; }
        text.inputEl.removeAttribute("aria-invalid"); s.translation.deletionThreshold = number;
        const select = threshold.settingEl.querySelector<HTMLSelectElement>("select"); if (select) select.value = [3, 4, 5].includes(number) ? value : "custom";
        await saveTranslation();
      });
    });

    containerEl.createEl("h3", { text: this.plugin.t("阅读设置") });
    containerEl.createEl("p", { text: this.plugin.t("排版选项适用于可重排书籍；PDF、CBZ 与固定版式书籍保留原页面。"), cls: "setting-item-description" });
    new Setting(containerEl).setName(this.plugin.t("字号")).addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", this.plugin.t("字号"));
      return slider
        .setLimits(12, 28, 1)
        .setValue(s.reading.fontSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          s.reading.fontSize = v;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName(this.plugin.t("行距")).addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", this.plugin.t("行距"));
      return slider
        .setLimits(1.4, 2.4, 0.05)
        .setValue(s.reading.lineHeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          s.reading.lineHeight = value;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName(this.plugin.t("页边距")).setDesc(this.plugin.t("可重排书籍的左右留白，单位为像素。")).addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", this.plugin.t("页边距"));
      return slider
        .setLimits(12, 48, 2)
        .setValue(s.reading.pageMargin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          s.reading.pageMargin = value;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName(this.plugin.t("字体")).addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute("aria-label", this.plugin.t("字体"));
      return dropdown.addOptions({ original: this.plugin.t("原书字体"), sans: this.plugin.t("系统黑体"), serif: this.plugin.t("系统宋体") })
        .setValue(s.reading.fontFamily)
        .onChange(async (value) => {
          s.reading.fontFamily = value === "sans" || value === "serif" ? value : "original";
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName(this.plugin.t("首行缩进")).addToggle((toggle) => {
      toggle.toggleEl.setAttribute("aria-label", this.plugin.t("首行缩进"));
      toggle.toggleEl.setAttribute("role", "switch");
      toggle.toggleEl.setAttribute("aria-checked", String(s.reading.paragraphIndent));
      const input = toggle.toggleEl.querySelector("input");
      if (input) {
        input.setAttribute("aria-hidden", "true");
        input.tabIndex = -1;
      }
      toggle.toggleEl.addEventListener("keydown", (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        toggle.onClick();
      });
      return toggle.setValue(s.reading.paragraphIndent).onChange(async (value) => {
        toggle.toggleEl.setAttribute("aria-checked", String(value));
        s.reading.paragraphIndent = value;
        await this.plugin.saveSettings();
        this.plugin.notifySettingsChanged();
      })
    });
    new Setting(containerEl).setName(this.plugin.t("主题")).addDropdown((dd) => {
      dd.selectEl.setAttribute("aria-label", this.plugin.t("主题"));
      return dd
        .addOptions({ auto: this.plugin.t("跟随 Obsidian"), light: this.plugin.t("纸白"), sepia: this.plugin.t("暖纸"), sage: this.plugin.t("青绿"), dark: this.plugin.t("夜间") })
        .setValue(s.reading.theme)
        .onChange(async (v) => {
          s.reading.theme = v as typeof s.reading.theme;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName(this.plugin.t("默认阅读模式")).addDropdown((dd) => {
      dd.selectEl.setAttribute("aria-label", this.plugin.t("默认阅读模式"));
      return dd
        .addOptions({ paginated: this.plugin.t("左右翻页"), scrolled: this.plugin.t("上下滚动") })
        .setValue(s.reading.defaultMode)
        .onChange(async (v) => {
          s.reading.defaultMode = v as typeof s.reading.defaultMode;
          await this.plugin.saveSettings();
        })
    });
  }
}
