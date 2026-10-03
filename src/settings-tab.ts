// Plugin settings tab (PRD §29): 阅读库, AI 配置, 阅读设置.

import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { QReaderPlugin } from "./main";
import { validateLibraryPath } from "./settings";
import { testConnection } from "./ai/client";

export class QReaderSettingTab extends PluginSettingTab {
  private testStatus = "";
  private testing = false;

  constructor(app: App, private plugin: QReaderPlugin) {
    super(app, plugin);
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

    containerEl.createEl("h3", { text: "AI 配置（OpenAI Compatible）" });
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("例如 https://api.openai.com/v1 或其他兼容接口地址")
      .addText((text) =>
        text.setPlaceholder("https://api.openai.com/v1").setValue(s.ai.baseUrl).onChange(async (v) => {
          s.ai.baseUrl = v.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl).setName("API Key")
      .setDesc("保存在插件本地 data.json 中，未加密。请保护 Vault 同步和备份；AI 请求只发往你配置的地址。")
      .addText((text) => {
      text.inputEl.type = "password";
      text.setValue(s.ai.apiKey).onChange(async (v) => {
        s.ai.apiKey = v.trim();
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("Model").addText((text) =>
      text.setPlaceholder("gpt-4o-mini").setValue(s.ai.model).onChange(async (v) => {
        s.ai.model = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("AI 只用于：三问生成、批注解释、回答反馈。不提供通用对话。")
      .addButton((btn) =>
        btn.setButtonText(this.testing ? "正在测试……" : "测试连接").setDisabled(this.testing).onClick(async () => {
          if (this.testing) return;
          this.testing = true;
          this.testStatus = "正在测试……";
          this.display();
          try {
            const res = await testConnection(s.ai);
            this.testStatus = res.message;
            new Notice(res.ok ? "连接成功" : "连接失败", 4000);
          } catch (error) {
            this.testStatus = error instanceof Error ? error.message : String(error);
          } finally {
            this.testing = false;
            this.display();
          }
        })
      );
    if (this.testStatus) {
      const p = containerEl.createEl("p", { text: this.testStatus });
      p.addClass("qr-settings-status");
    }

    containerEl.createEl("h3", { text: "阅读设置" });
    new Setting(containerEl).setName("字号").addSlider((slider) =>
      slider
        .setLimits(12, 28, 1)
        .setValue(s.reading.fontSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          s.reading.fontSize = v;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    );
    new Setting(containerEl).setName("行距").addDropdown((dd) =>
      dd
        .addOptions({ "1.5": "1.5", "1.75": "1.75", "2": "2.0" })
        .setValue(String(s.reading.lineHeight))
        .onChange(async (v) => {
          s.reading.lineHeight = Number(v);
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    );
    new Setting(containerEl).setName("主题").addDropdown((dd) =>
      dd
        .addOptions({ auto: "跟随 Obsidian", light: "明亮", dark: "深色" })
        .setValue(s.reading.theme)
        .onChange(async (v) => {
          s.reading.theme = v as typeof s.reading.theme;
          await this.plugin.saveSettings();
          this.plugin.notifySettingsChanged();
        })
    );
    new Setting(containerEl).setName("默认阅读模式").addDropdown((dd) =>
      dd
        .addOptions({ paginated: "左右翻页", scrolled: "上下滚动" })
        .setValue(s.reading.defaultMode)
        .onChange(async (v) => {
          s.reading.defaultMode = v as typeof s.reading.defaultMode;
          await this.plugin.saveSettings();
        })
    );
  }
}
