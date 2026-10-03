# QReader · 带着问题读书

An Obsidian reader that helps you understand an author's ideas and reasoning, then recall them in your own words. / 在 Obsidian 中阅读，理解作者的表达与推理，再合上书用自己的话复述。

[Download / 下载 1.1.4](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.4) · [中文说明](#中文说明) · [English](#english)

## 中文说明

### 功能

- EPUB、PDF、FB2（含 `.fb2.zip`）、未加密 MOBI、AZW3 和 CBZ；原文件保存在 Vault 中。
- 每页四本真实封面卡片，支持搜索、未读/已读和自定义分类。
- 沉浸阅读、翻页/滚动、字体和背景设置，自动保存阅读位置。
- 选文菜单为单行图标：复制、AI 解读、颜色圆圈、批注、关闭。短按色圈保存高亮，长按选色；正文使用无边框半透明高亮。
- 每章三问分别检查核心观点、关键推理和自己的复述，一题只问一件事。
- 闭卷回答、简短 AI 反馈、历史答案对比和自行安排复习日期。
- 书架、阅读、回答、复习在当前标签页跳转，使用 Obsidian 原生回退。

### 安装

需要 Obsidian 1.5.0 或以上。下载 Release 的 `QReader-1.1.4.zip`，解压后将 `qreader/` 放入 Vault 的 `.obsidian/plugins/`，目录中应包含 `main.js`、`manifest.json`、`styles.css`。重启或刷新 Obsidian，在社区插件中启用 QReader。

也可通过 BRAT 添加仓库 `lulalulaluobo/QReader`，安装最新正式版本。升级时替换以上三个文件，保留 `data.json`、书籍目录和阅读记录。

### 语言与 AI

打开 **设置 → QReader → 语言**，选择 **简体中文** 或 **English**。首次安装与旧配置默认中文。界面、菜单、图标名称、通知和默认 AI 提示词跟随选择。

在 QReader 设置中选择 DeepSeek、Agnes 或自定义 OpenAI Compatible 接口，并填写对应密钥。只有使用 AI 功能时才需要配置接口；阅读和本地批注不依赖 AI。

**每章三问提示词**留空时，使用当前语言的默认模板。自定义提示词按原文保存；用 `{{chapter_content}}` 插入章节正文，不写占位符时会自动追加正文。三问输出可用中文标签“核心问题/逻辑问题/复述问题”、英文标签“Core question/Logic question/Retelling question”，或 `questions` JSON 数组。

切换语言不会翻译原书、分类名称、笔记、旧问题、答案或反馈，也不会重置阅读位置和未提交回答。新生成的默认三问、AI 解读和反馈使用当前语言；已有问题保留，需要新语言时可重新生成。自定义出题模板保留自己的语言和要求。

### 数据与限制

每本书的目录保存原书、`reading.json` 和 `批注.md`；语言切换不改这些文件的名称或存储字段。API Key 保存在插件本地 `data.json` 中，未加密，请保护 Vault 同步和备份。AI 生成会将相应章节、选文及上下文或回答发送至你选择的接口；连接测试仅发送探针。

CBZ 仅供图片阅读，没有文字问答。DRM/加密书籍不受支持。1.1.4 在 macOS Obsidian 1.13.7 独立 Vault 验收，中英文窄屏使用移动 CSS 模拟；Android/iOS 真机和真实 AI 模型质量尚未验证。

## English

### Features

- Read EPUB, PDF, FB2 (including `.fb2.zip`), unencrypted MOBI, AZW3 and CBZ. Original files stay in your Vault.
- Four real cover cards per page, search, unread/read filters and your own categories.
- Immersive reading, paginated or scrolling layouts, font/background controls and saved reading positions.
- A single row of selection icons: copy, AI explanation, color circle, annotation and close. Tap the circle to save a highlight; hold it to choose a color. Highlights use a soft fill without an outline.
- Three chapter questions focus on the core idea, one key reasoning link and retelling in your own words. Each question has one clear target.
- Closed-book answers, brief AI feedback, complete answer history and review dates you choose.
- Library, reader, answers and review share the current tab and support Obsidian's native back navigation.

### Installation

Requires Obsidian 1.5.0 or later. Download `QReader-1.1.4.zip` from the Release, then copy its `qreader/` folder into your Vault's `.obsidian/plugins/`. The plugin folder must contain `main.js`, `manifest.json` and `styles.css`. Restart or reload Obsidian and enable QReader under Community plugins.

Alternatively, add `lulalulaluobo/QReader` through BRAT to install the latest stable release. When updating manually, replace only those three files and retain `data.json`, your books and reading records.

### Language and AI

Open **Settings → QReader → 语言 / Language** and choose **English** or **简体中文**. New installations and older settings default to Simplified Chinese. The interface, menus, accessible icon labels, notices and built-in AI prompts follow this choice.

Choose DeepSeek, Agnes or a custom OpenAI Compatible endpoint in QReader settings and enter its API key. AI setup is needed only for AI features; reading and local annotations work without it.

Leave **Chapter question prompt** empty to use the built-in template in the selected language. Custom prompts are preserved exactly. Insert `{{chapter_content}}` where the chapter belongs; without this placeholder, QReader appends the chapter automatically. Question output accepts the labels `Core question`, `Logic question`, `Retelling question`, their Chinese equivalents, or a `questions` JSON array.

Changing language preserves book text, category names, notes, existing questions, answers and feedback, as well as reading positions and unsubmitted answers. New questions from the default template, explanations and feedback use the selected language. Regenerate existing questions if you want them in the new language. Custom question templates retain their own language and instructions.

### Data and limitations

Each book folder keeps the original file, `reading.json` and `批注.md`. Changing language does not rename these files or their data fields. API keys are stored unencrypted in the plugin's local `data.json`; protect your Vault sync and backups. AI generation sends the relevant chapter, selected passage/context or answers to your chosen endpoint. Connection testing sends only a probe.

CBZ supports image reading only. DRM/encrypted books are unsupported. Version 1.1.4 is validated in an isolated macOS Obsidian 1.13.7 Vault; narrow layouts use mobile CSS simulation. Android/iOS devices and real AI model quality have not been tested.

## 从源码构建 / Build from source

```sh
npm ci
npm run build
```

Copy the generated `main.js` together with `manifest.json` and `styles.css` to the plugin folder. `main.js` is a build artifact and is not tracked in Git. / 将生成的 `main.js` 与 `manifest.json`、`styles.css` 放入插件目录；Git 不跟踪生成的 `main.js`。

## License

MIT (see [package.json](package.json)). Dependencies retain their upstream licenses. / 依赖保留上游许可证。
