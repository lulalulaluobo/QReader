# QReader · 沉浸阅读，按需辅助

An Obsidian reader for focused reading, on-demand explanations and local annotations. / 在 Obsidian 中专注阅读，遇到困难时查词或解读，随手记录自己的理解。

[Download / 下载 1.1.10](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.10) · [中文说明](#中文说明) · [English](#english)

## 中文说明

### 功能

- EPUB、PDF、FB2（含 `.fb2.zip`）、未加密 MOBI、AZW3 和 CBZ；原文件保存在 Vault 中。
- 每页四本真实封面卡片，支持搜索、未读/已读和自定义分类。
- 沉浸阅读、翻页/滚动、字体和背景设置，自动保存阅读位置。
- 选文菜单为单行图标：复制、翻译、颜色圆圈、批注、更多。AI 解读和关闭位于更多菜单；短按色圈保存高亮，长按选色，正文高亮没有外边框。
- 长按选中英文词查释义，单击继续阅读；每本书独立保存当前生词，后续出现逐渐淡化，默认连续 5 次未查询后删除，也可在翻译卡手动移除。
- 选段后主动调用 AI 解读，结合前后文解释；只有明确存入笔记才保存。
- 笔记按书籍和章节回看批注；以前的三问、回答和 AI 评价保留为折叠的历史记录。
- 书架、阅读和笔记在当前标签页跳转，使用 Obsidian 原生回退。

### 安装

需要 Obsidian 1.5.0 或以上。下载 Release 的 `QReader-1.1.10.zip`，解压后将 `qreader/` 放入 Vault 的 `.obsidian/plugins/`，目录中应包含 `main.js`、`manifest.json`、`styles.css`。重启或刷新 Obsidian，在社区插件中启用 QReader。

也可通过 BRAT 添加仓库 `lulalulaluobo/QReader`，安装最新正式版本。升级时替换以上三个文件，保留 `data.json`、书籍目录和阅读记录。

### 语言与 AI

打开 **设置 → QReader → 语言**，选择 **简体中文** 或 **English**。首次安装与旧配置默认中文。界面、菜单、图标名称、通知和默认 AI 提示词跟随选择。

在 QReader 设置中选择 DeepSeek、Agnes 或自定义 OpenAI Compatible 接口，并填写对应密钥。只有使用 AI 功能时才需要配置接口；阅读和本地批注不依赖 AI。

各服务独立保存 URL、模型和密钥，预设也可手动修改。URL 可填基础地址或完整 `/chat/completions` 地址，不会重复追加路径。模型模板只填模型 ID，不覆盖当前 URL 或密钥。

| 服务 | 默认 URL | 可选模型模板 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash`、`deepseek-v4-pro` |
| Agnes | `https://apihub.agnes-ai.com/v1/chat/completions` | `agnes-3.0-flash`、`agnes-2.5-flash`、`agnes-2.5-pro` |

模板按 2026-10-04 的 [DeepSeek 官方集成文档](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/) 和 [Agnes 官方模型目录](https://wiki.agnes-ai.com/llms.txt) 核实；尚未发布的模型不列入模板。新安装默认 Flash，升级保留旧 Agnes 模型选择；可选择新模板或手动填写账户可用的其他模型。

切换语言不会翻译原书、分类名称、笔记或历史记录，也不会重置阅读位置。按需调用的 AI 解读使用当前界面语言。

### 阅读辅助与笔记

**1.1.10 已撤销每章三问。** 打开书籍、切换章节不会生成问题，三问、重新生成、回答与提示词设置均已移除。阅读时遇到困难再使用长按查词或选段 AI 解读；有自己的想法时，通过选文菜单添加批注。

书架的 **笔记** 入口按书籍和章节显示批注。已有问题版本、回答、AI 评价及已完成复习在“历史三问与回答”中折叠保留；旧预约数据不产生任务。阅读页也能主动回看历史记录。

原有 `reading.json`、`批注.md` 与 `vocabulary.json` 继续使用，不迁移或删除旧记录。打开旧回答标签会显示只读笔记，未保存的旧回答草稿仍可查看和复制，不会自动变成已保存笔记。历史 AI 评价只供参考，不是标准答案。

后续辅助方案与优先级见[阅读辅助评估](docs/read-assistance-assessment.md)：优先改进主动选段解读，再考虑手动回顾已读上下文。

### 翻译与动态生词

**有道查词无需密钥或额外配置。** 手机长按选中英文词即可查询中文释义、可用音标；单击原文不查词。桌面选中单词也可查询。点击声音图标播放发音；更多图标可返回复制、画线和批注菜单。

单词已加入当前书的生词表时，卡片会显示垃圾桶图标。点击即可删除该词记录和生词高亮，保留当前译文；本卡片刷新不会重新加入，以后再次主动查词会重新开始。

查词使用[有道公开词典](https://dict.youdao.com/)的单词查询与发音接口，不需要有道智云账户。公开接口可能调整；请求失败时可重试，已有生词仍可读取本书保存的释义。

公开查词接口不提供整句译文。选中句子后点击 **AI 翻译** 图标，使用已配置的 DeepSeek、Agnes 或自定义 AI 服务译为中文，卡片明确显示 AI 来源。整句只翻译，不加入生词表；使用此功能需要现有 AI 配置，单词查词不依赖 AI。

查询成功的单词默认自动保存到当前书籍的 `vocabulary.json`，重新查询会清零连续未查询次数并恢复最强高亮。词形按原样记录，忽略大小写，不自动猜词根。可分别关闭自动加入和后续高亮。

生词所在段落真正进入视口后，在离开段落或翻页时计一次有效出现。同词同段只计一次，回看、重排和重开不重复；重新查询开启新一轮。连续 **5 次**有效出现且未查询后，逐渐淡化的高亮和单词记录一起删除。设置可选择 **3 / 4 / 5**，或自定义 **1–100** 次。没有单词历史库、背诵、测试或复习任务。

活跃生词优先读取本书保存的释义。其他单词查询使用最多 128 条、30 分钟有效的会话缓存，关闭插件后清空；整句译文仅显示在当前卡片，不建立永久翻译库。

### 数据与限制

每本书的目录保存原书、`reading.json` 和 `批注.md`；首次成功加入生词后只多一个 `vocabulary.json`。语言切换不改旧文件名或数据。AI 密钥保存在插件本地 `data.json` 中，未加密，请保护 Vault 同步和备份。升级保留现有生词，旧有道凭据不再使用并在下一次保存设置时移除。AI 生成或整句翻译会将相应文本发送至所选接口；连接测试仅发送探针。有道仅接收主动查询的单词和播放发音的单词。查词释义与整句译文使用中文，不随界面语言改变。

CBZ 和扫描 PDF 没有可查询的文本；普通 PDF 依赖原文件的文字层和段落布局。DRM/加密书籍不受支持。免密有道单词查询与音频已实际连通；AI 整句译文质量和 Android/iOS 真机尚未验证。桌面验收使用 macOS Obsidian 1.13.7 独立 Vault，窄屏使用移动 CSS 模拟。

## English

### Features

- Read EPUB, PDF, FB2 (including `.fb2.zip`), unencrypted MOBI, AZW3 and CBZ. Original files stay in your Vault.
- Four real cover cards per page, search, unread/read filters and your own categories.
- Immersive reading, paginated or scrolling layouts, font/background controls and saved reading positions.
- A single row of selection icons: copy, translate, color circle, annotation and more. AI explanation and close are in More. Tap the circle to save a highlight; hold it to choose a color. Highlights have no outline.
- Hold and select an English word to look it up; a single tap keeps reading. Vocabulary is saved per book and fades on later appearances; words are removed after 5 missed lookups by default, or manually from the translation card.
- Request a contextual AI explanation for a selected passage. Save it to notes only when you choose to.
- Revisit annotations by book and chapter; earlier questions, answers and AI feedback remain in a collapsed archive.
- Library, reader and notes share the current tab and support Obsidian's native back navigation.

### Installation

Requires Obsidian 1.5.0 or later. Download `QReader-1.1.10.zip` from the Release, then copy its `qreader/` folder into your Vault's `.obsidian/plugins/`. The plugin folder must contain `main.js`, `manifest.json` and `styles.css`. Restart or reload Obsidian and enable QReader under Community plugins.

Alternatively, add `lulalulaluobo/QReader` through BRAT to install the latest stable release. When updating manually, replace only those three files and retain `data.json`, your books and reading records.

### Language and AI

Open **Settings → QReader → 语言 / Language** and choose **English** or **简体中文**. New installations and older settings default to Simplified Chinese. The interface, menus, accessible icon labels, notices and built-in AI prompts follow this choice.

Choose DeepSeek, Agnes or a custom OpenAI Compatible endpoint in QReader settings and enter its API key. AI setup is needed only for AI features; reading and local annotations work without it.

Every provider keeps its own editable URL, model and key. Both base URLs and full `/chat/completions` URLs work. Templates fill only the model ID, preserving your URL and key.

| Provider | Default URL | Model templates |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash`, `deepseek-v4-pro` |
| Agnes | `https://apihub.agnes-ai.com/v1/chat/completions` | `agnes-3.0-flash`, `agnes-2.5-flash`, `agnes-2.5-pro` |

Verified on 2026-10-04 against the [official DeepSeek integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/) and [Agnes model directory](https://wiki.agnes-ai.com/llms.txt). Unreleased models are excluded. New installations use Flash; upgrades preserve the older Agnes model selection. You can choose another template or enter any model available to your account.

Changing language preserves book text, category names, notes, earlier records and reading positions. On-demand AI explanations follow the selected interface language.

### Reading assistance and notes

**Chapter questions have been retired in 1.1.10.** Opening a book or changing chapters does not generate questions. Question controls, regeneration, answering and prompt settings have been removed. Long-press an unfamiliar word, request an explanation for a difficult passage or add your own annotation when needed.

**Notes** shows annotations by book and chapter. Earlier question versions, answers, AI feedback and completed reviews remain under the collapsed “Archived questions and answers” section. Old appointments do not create tasks. The reader also lets you revisit earlier records when you choose.

Books retain their existing `reading.json`, `批注.md` and `vocabulary.json`, without migrating or deleting earlier records. Restoring an old answer tab displays read-only notes. Unsubmitted drafts remain available to read and copy; they are not automatically saved as notes. Historical AI feedback is a reference rather than a standard answer.

See the [reading assistance assessment (Chinese)](docs/read-assistance-assessment.md) for proposed next steps: improve on-demand passage explanations first, then consider a manual recap of previously read content.

### Translation and dynamic vocabulary

**Youdao word lookup needs no key or setup.** On mobile, hold and select an English word to look it up. A single tap on the passage does not query it. Selecting a word also works on desktop. The card shows Chinese definitions and available phonetics; press the speaker icon to play pronunciation. More returns to copying, highlighting and annotations.

If the word is saved in the current book, a trash icon removes its vocabulary record and highlight while keeping the displayed translation. Refreshing this card will not add it again. A later new lookup starts a fresh record.

Lookup uses the [public Youdao dictionary](https://dict.youdao.com/) word and pronunciation endpoints without a Youdao cloud account. Public endpoints may change. Retry failed requests; active words retain their saved definitions in the current book.

The public dictionary does not return sentence translations. Select a passage and press **AI translation** to translate it into Chinese using your configured DeepSeek, Agnes or custom AI service. The card identifies its AI source. Passages are not saved as vocabulary. This feature needs your existing AI setup; word lookup does not use AI.

Successful single-word lookups are saved in the current book's `vocabulary.json` by default. Another lookup resets the consecutive missed-lookup count and restores the strongest highlight. Words are case-insensitive but are not stemmed. Automatic saving and highlighting can be disabled separately.

A paragraph must actually enter the reading viewport. An appearance is counted when leaving that paragraph or turning a page; the same word in the same paragraph counts once. Rereading, reflowing and reopening do not count again. A new lookup starts another round. After **5 consecutive appearances without a lookup**, the word and its fading highlight are removed. Choose **3 / 4 / 5** or a custom **1–100** in settings. There is no vocabulary history, memorization, testing or review schedule.

Active words use their saved per-book definitions first. Other word lookups use a session cache of at most 128 entries, valid for 30 minutes and cleared when the plugin closes. Sentence translations appear only in the current card. There is no permanent translation archive.

### Data and limitations

Each book folder keeps the original file, `reading.json` and `批注.md`. A first successful saved-word lookup adds only `vocabulary.json`. Language changes preserve existing files and data. AI keys are stored unencrypted in the plugin's local `data.json`; protect your Vault sync and backups. Upgrades retain vocabulary; old Youdao credentials are unused and removed on the next settings save. AI sends relevant text to your chosen endpoint for AI features and sentence translation; connection tests send only a probe. Youdao receives only words you actively look up or play. Definitions and sentence translations use Chinese regardless of interface language.

CBZ and scanned PDFs have no queryable text; other PDFs depend on their text layer and paragraph layout. DRM/encrypted books are unsupported. Live keyless Youdao word and audio requests passed. AI sentence translation quality and Android/iOS devices have not been tested. Desktop validation uses an isolated macOS Obsidian 1.13.7 Vault; narrow layouts use mobile CSS simulation.

## 从源码构建 / Build from source

```sh
npm ci
npm run build
npm run test:translation
```

Copy the generated `main.js` together with `manifest.json` and `styles.css` to the plugin folder. `main.js` is a build artifact and is not tracked in Git. / 将生成的 `main.js` 与 `manifest.json`、`styles.css` 放入插件目录；Git 不跟踪生成的 `main.js`。

## License

MIT (see [package.json](package.json)). Dependencies retain their upstream licenses. / 依赖保留上游许可证。
