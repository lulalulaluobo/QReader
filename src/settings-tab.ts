// Plugin settings tab (PRD §29): 阅读库, AI 配置, 阅读设置.

import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { QReaderPlugin } from "./main";
import { validateLibraryPath } from "./settings";
import { testConnection } from "./ai/client";
import { DEFAULT_QUESTION_PROMPT } from "./ai/tasks";
import { AI_PRESETS, getAiConfig } from "./ai/providers";
import type { AiProvider } from "./ai/providers";

export class QReaderSettingTab extends PluginSettingTab {
  private testStatus = "";
  private testing = false;
  private configRevision = 0;
  private renderAi: (() => void) | null = null;
  private renderPrompt: (() => void) | null = null;
  private promptDraft = "";
  private promptSaving = false;
  private promptStatus = "";

  constructor(app: App, private plugin: QReaderPlugin) {
    super(app, plugin);
  }

  hide(): void {
    this.configRevision++;
    this.testStatus = "";
    this.renderAi = null;
    this.renderPrompt = null;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    let proposedPath = s.libraryPath;

    containerEl.createEl("h2", { text: "QReader" });

    new Setting(containerEl)
      .setName("阅读库路径")
      .setDesc("Vault 内的相对路径，例如 Books。导入的书籍会存放在这里。")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(s.libraryPath)
          .onChange((value) => { proposedPath = value; })
      )
      .addButton((button) => button.setButtonText("保存路径").onClick(async () => {
        const result = validateLibraryPath(proposedPath);
        if (!result.ok) {
          new Notice(result.error ?? "路径无效");
          return;
        }
        const previous = s.libraryPath;
        button.setDisabled(true);
        try {
          s.libraryPath = result.path;
          await this.plugin.saveSettings();
          await this.plugin.library.scan(true);
          this.plugin.notifyChanged();
          new Notice("阅读库路径已保存");
        } catch (error) {
          s.libraryPath = previous;
          await this.plugin.saveSettings();
          new Notice(`路径保存失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          button.setDisabled(false);
        }
      }));

    const aiContainer = containerEl.createDiv({ cls: "qr-ai-settings" });
    const renderAi = (): void => {
      aiContainer.empty();
      const ai = s.ai;
      const provider = ai.provider;
      aiContainer.createEl("h3", { text: "AI 配置" });
      const providers = new Setting(aiContainer)
        .setName("AI 服务")
        .setDesc("DeepSeek 和 Agnes 只需填写各自的 API Key；自定义接口配置独立保留。");
      providers.settingEl.addClass("qr-ai-providers");
      const options: AiProvider[] = ["deepseek", "agnes", "custom"];
      for (const option of options) {
        providers.addButton((button) => {
          button.setButtonText(option === "custom" ? "自定义接口" : AI_PRESETS[option].name);
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
            catch { new Notice("AI 服务选择保存失败，请重试"); }
          });
        });
      }
      const persistAiChange = async (): Promise<void> => {
        this.configRevision++;
        this.testStatus = "";
        statusEl.setText("");
        try { await this.plugin.saveSettings(); }
        catch { new Notice("AI 配置保存失败，请重新编辑后重试"); }
      };
      if (provider === "custom") {
        new Setting(aiContainer).setName("Base URL")
          .setDesc("自定义 OpenAI Compatible 接口地址，不影响内置服务。")
          .addText((text) => {
            text.inputEl.setAttribute("aria-label", "自定义接口 Base URL");
            text.setPlaceholder("https://api.openai.com/v1").setValue(ai.custom.baseUrl).onChange(async (value) => {
              ai.custom.baseUrl = value;
              await persistAiChange();
            });
          });
        new Setting(aiContainer).setName("Model").addText((text) => {
          text.inputEl.setAttribute("aria-label", "自定义接口 Model");
          text.setPlaceholder("模型 ID").setValue(ai.custom.model).onChange(async (value) => {
            ai.custom.model = value;
            await persistAiChange();
          });
        });
      } else {
        const preset = AI_PRESETS[provider];
        new Setting(aiContainer).setName("模型（预设）").setDesc(preset.model);
        new Setting(aiContainer).setName("接口地址（预设）").setDesc(preset.baseUrl);
      }
      const keyLabel = provider === "custom" ? "自定义接口 API Key" : `${AI_PRESETS[provider].name} API Key`;
      const apiKey = provider === "deepseek" ? ai.deepseekApiKey : provider === "agnes" ? ai.agnesApiKey : ai.custom.apiKey;
      new Setting(aiContainer).setName(keyLabel)
        .setDesc("保存在插件本地 data.json 中，未加密。请保护 Vault 同步和备份；不同服务的密钥互不继承。")
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.inputEl.setAttribute("aria-label", keyLabel);
          text.setPlaceholder("填写该服务的 API Key").setValue(apiKey).onChange(async (value) => {
            if (provider === "deepseek") ai.deepseekApiKey = value;
            else if (provider === "agnes") ai.agnesApiKey = value;
            else ai.custom.apiKey = value;
            await persistAiChange();
          });
        });
      new Setting(aiContainer).setName("测试连接")
        .setDesc("仅将章节正文、选文或回答发送到所选接口，用于三问生成、批注解释和回答反馈；不提供通用对话。连接测试只发送探针。")
        .addButton((button) => button.setButtonText(this.testing ? "正在测试……" : "测试连接")
          .setDisabled(this.testing).onClick(async () => {
            if (this.testing) return;
            const snapshot = { ...getAiConfig(ai) };
            const revision = this.configRevision;
            this.testing = true;
            this.testStatus = "正在测试……";
            renderAi();
            try {
              const result = await testConnection(snapshot);
              const current = getAiConfig(s.ai);
              if (this.configRevision !== revision || s.ai.provider !== provider || current.baseUrl !== snapshot.baseUrl || current.model !== snapshot.model || current.apiKey !== snapshot.apiKey) return;
              this.testStatus = result.message;
              new Notice(result.ok ? "连接成功" : "连接失败", 4000);
            } catch {
              if (this.configRevision === revision && s.ai.provider === provider) {
                this.testStatus = "AI 连接失败，请检查网络和接口配置";
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

    // 提示词独立于 provider 重绘，切换接口不会丢失编辑草稿或串配置。
    if (!this.promptSaving) {
      this.promptDraft = s.questionPrompt;
      this.promptStatus = "";
    }
    const promptContainer = containerEl.createDiv({ cls: "qr-question-prompt-settings" });
    const renderPrompt = (): void => {
      promptContainer.empty();
      const setting = new Setting(promptContainer)
        .setName("每章三问提示词")
        .setDesc("留空使用默认的一问一靶提示词。{{chapter_content}} 会替换为当前章节正文；没有占位符时自动追加正文。所有 AI 服务共用，保存后对新生成或重新生成的问题生效。");
      setting.settingEl.addClass("qr-question-prompt-setting");
      setting.addTextArea((text) => {
        text.inputEl.setAttribute("aria-label", "每章三问提示词");
        text.inputEl.rows = 12;
        text.setPlaceholder(DEFAULT_QUESTION_PROMPT).setValue(this.promptDraft)
          .setDisabled(this.promptSaving)
          .onChange((value) => {
            this.promptDraft = value;
            this.promptStatus = "修改尚未保存";
            statusEl.setText(this.promptStatus);
          });
      });
      const savePrompt = async (restoreDefault: boolean): Promise<void> => {
        if (this.promptSaving) return;
        const previous = s.questionPrompt;
        const draft = this.promptDraft;
        const next = restoreDefault || !draft.trim() ? "" : draft;
        this.promptSaving = true;
        this.promptStatus = "正在保存……";
        renderPrompt();
        try {
          s.questionPrompt = next;
          await this.plugin.saveSettings();
          this.promptDraft = next;
          this.promptStatus = next ? "自定义提示词已保存" : "已恢复默认提示词";
          new Notice(this.promptStatus);
        } catch {
          s.questionPrompt = previous;
          this.promptDraft = draft;
          this.promptStatus = "提示词保存失败，已回滚；可点击保存重试";
          new Notice(this.promptStatus);
        } finally {
          this.promptSaving = false;
          this.renderPrompt?.();
        }
      };
      new Setting(promptContainer)
        .setName(this.promptDraft.trim() ? "自定义提示词" : "当前使用默认提示词")
        .setDesc("默认生成核心、逻辑、复述问题各一个。")
        .addButton((button) => button.setButtonText(this.promptSaving ? "正在保存……" : "保存提示词")
          .setCta().setDisabled(this.promptSaving).onClick(() => savePrompt(false)))
        .addButton((button) => button.setButtonText("清空并恢复默认")
          .setDisabled(this.promptSaving).onClick(() => savePrompt(true)));
      const statusEl = promptContainer.createEl("p", { text: this.promptStatus, cls: "qr-settings-status" });
      statusEl.setAttribute("role", "status");
      statusEl.setAttribute("aria-live", "polite");
    };
    this.renderPrompt = renderPrompt;
    renderPrompt();

    containerEl.createEl("h3", { text: "阅读设置" });
    containerEl.createEl("p", { text: "排版选项适用于可重排书籍；PDF、CBZ 与固定版式书籍保留原页面。", cls: "setting-item-description" });
    new Setting(containerEl).setName("字号").addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", "字号");
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
    new Setting(containerEl).setName("行距").addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", "行距");
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
    new Setting(containerEl).setName("页边距").setDesc("可重排书籍的左右留白，单位为像素。").addSlider((slider) => {
      slider.sliderEl.setAttribute("aria-label", "页边距");
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
    new Setting(containerEl).setName("字体").addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute("aria-label", "字体");
      return dropdown.addOptions({ original: "原书字体", sans: "系统黑体", serif: "系统宋体" })
        .setValue(s.reading.fontFamily)
        .onChange(async (value) => {
          s.reading.fontFamily = value === "sans" || value === "serif" ? value : "original";
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName("首行缩进").addToggle((toggle) => {
      toggle.toggleEl.setAttribute("aria-label", "首行缩进");
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
    new Setting(containerEl).setName("主题").addDropdown((dd) => {
      dd.selectEl.setAttribute("aria-label", "主题");
      return dd
        .addOptions({ auto: "跟随 Obsidian", light: "纸白", sepia: "暖纸", sage: "青绿", dark: "夜间" })
        .setValue(s.reading.theme)
        .onChange(async (v) => {
          s.reading.theme = v as typeof s.reading.theme;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    });
    new Setting(containerEl).setName("默认阅读模式").addDropdown((dd) => {
      dd.selectEl.setAttribute("aria-label", "默认阅读模式");
      return dd
        .addOptions({ paginated: "左右翻页", scrolled: "上下滚动" })
        .setValue(s.reading.defaultMode)
        .onChange(async (v) => {
          s.reading.defaultMode = v as typeof s.reading.defaultMode;
          await this.plugin.saveSettings();
        })
    });
  }
}
