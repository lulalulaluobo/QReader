# QReader · 沉浸阅读，按需辅助

An Obsidian reader for focused reading, on-demand explanations and local annotations. / 在 Obsidian 中专注阅读，遇到困难时查词或解读，随手记录自己的理解。

[Download / 下载 1.2.3](https://github.com/lulalulaluobo/QReader/releases/tag/1.2.3) · [中文说明](#中文说明) · [English](#english)

## 中文说明

### 功能

- EPUB、PDF、FB2（含 `.fb2.zip`）、未加密 MOBI、AZW3 和 CBZ；原文件保存在 Vault 中。
- 每页四本真实封面卡片，支持搜索、未读/已读和自定义分类。
- 沉浸阅读、翻页/滚动、字体和背景设置，自动保存阅读位置。
- 阅读页听书，从当前位置逐句朗读、临时标示原文并自动跟随翻页；支持暂停、停止、语速和声音选择。
- 选文菜单为单行图标：复制、翻译、颜色圆圈、批注、更多。AI 解读和关闭位于更多菜单；短按色圈保存高亮，长按选色，正文高亮没有外边框。
- 长按选中英文词查释义，单击继续阅读；每本书独立保存当前生词，后续出现逐渐淡化，默认连续 5 次未查询后删除，也可在翻译卡手动移除。
- 选段后主动调用 AI 解读，结合前后文解释；只有明确存入笔记才保存。
- 每本书持续汇总为一份 Markdown 笔记，包含摘抄、个人批注、日期和原文定位；整书想法可直接在文档中自由书写。
- 原生编辑器里的手工修改会保留，批注更新同时修改同一处时，两份内容都留下供回看。
- 书架、阅读和笔记在当前标签页跳转，使用 Obsidian 原生回退。

### 安装

需要 Obsidian 1.5.0 或以上。下载 Release 的 `QReader-1.2.3.zip`，解压后将 `qreader/` 放入 Vault 的 `.obsidian/plugins/`，目录中应包含 `main.js`、`manifest.json`、`styles.css`。重启或刷新 Obsidian，在社区插件中启用 QReader。

也可通过 BRAT 添加仓库 `lulalulaluobo/QReader`，安装最新正式版本。升级时替换以上三个文件，保留 `data.json`、书籍目录和阅读记录。

### 听书（1.2.3）

阅读页点击耳机图标，显示一条紧凑控制栏，只有播放/暂停、语速、声音设置和停止四项；默认不遮罩正文。点击播放后从当前可见句子开始，正在朗读的短句临时标色；下一句不在当前页时自动翻页或滚动，读完后继续下一部分。点语速选择倍速，点设置才展开语音方式和声音；停止后控制栏收起。手动翻页、跳章、换书或离开阅读页会停止朗读。

想指定起读位置时，选中文字，点击选文菜单中的播放三角图标。从选区起点所在的完整短句开始，继续顺序朗读；已有划线和批注也可以从原文位置起读。选文菜单打开时，底部播放键同样优先使用选区；正在播放或暂停时重新选文播放，会切换到新位置，不会回到页首。

桌面默认使用网页系统语音；Android 的 Obsidian WebView 不支持该接口，自动使用 **Bing 在线语音**，直接在 Obsidian 内播放，无需个人 API 密钥。控制栏可点选 0.5–2 倍语速，声音设置中可切换服务及中英文声音。系统模式更改语速后从下一句生效；暂停续听会重新读当前短句，在线模式则从音频暂停点继续。

在线模式需要联网，播放时将当前短句及至多下一短句发送至 Bing，短期会话和音频只在内存中保存。该网页语音接口可能变化或暂时不可用，失败时会显示错误，允许重试或切换系统语音。语音选择遵循书中文字，不受界面语言影响。只支持有文字层的书籍；CBZ 和扫描 PDF 不提供 OCR 朗读。正文跟随以短句为单位，不提供逐字同步时间戳；首版不保证锁屏和后台连续播放。

实现参考：[GTranslate 的 Bing SSML 请求协议](https://github.com/d4n3436/GTranslate/blob/master/src/GTranslate/Translators/BingTranslator.cs)、[Web Speech 兼容性](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechSynthesis.json)。

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

书架的 **笔记** 直接展示每本书的 `批注.md`。纯划线也作为摘抄收录，按章节和书内顺序汇总；原文、你的笔记、保存的 AI 解释分开呈现。每条记录保留日期与原文链接。旧问题、回答、AI 评价和已完成复习仍保存在折叠的历史区域，旧预约不产生任务。

### 每本书一份笔记（1.2.1）

点 **编辑笔记文档**，在当前标签页进入 Obsidian 原生 Markdown 编辑器。你可以在“关于这本书的想法”中自由书写，也可以补充或修改任何一处。阅读时随手摘抄、批注，读完就已经得到整本书的笔记，无需再做一次整理。

新增、修改、删除批注以及离开阅读页时会同步；普通翻页不会重写笔记。同步比较上次生成内容、当前文档和新的批注：保留你在文档中做的修改。两边同时改同一处时，手工文字留在原处，新的批注列为“同步补充”；删除记录时，你改过的文字也会保留。文档手工修改不会反向修改阅读器中的结构化批注，回到原文编辑批注仍以阅读器保存的记录为准。

文档包含书名、作者、原书路径、最近阅读与最近笔记时间。阅读时间不会冒充笔记时间；手工编辑的时间在下一次同步或离开原生编辑器时记录。文档首次生成时采用当前界面语言，之后切换语言不改已有文档与个人文字。文件无需插件也能阅读、编辑或交给本地 LLM；QReader 不生成跨书关系或维护思考线。

思考线界面与关联请求已移除。已有非空 `.qreader/thinking.json` 自动归档为阅读库中的 **旧版思考记录.md**，保存此前的判断、疑问、关联理由与可用来源；同名文件存在时使用新文件名，原始 JSON 和既有导出快照保留不变。归档后手工编辑不会被后续扫描覆盖。损坏的旧记录保留原文件并提示，不阻碍阅读。

原有 `reading.json`、`批注.md` 与 `vocabulary.json` 继续使用。旧回答标签中的未保存草稿仍可查看和复制，不会自动变成已保存笔记。历史 AI 评价只供参考，不是标准答案。

### 翻译与动态生词

**有道查词无需密钥或额外配置。** 手机长按选中英文词即可查询中文释义、可用音标；单击原文不查词。桌面选中单词也可查询。点击声音图标播放发音；更多图标可返回复制、画线和批注菜单。

单词已加入当前书的生词表时，卡片会显示垃圾桶图标。点击即可删除该词记录和生词高亮，保留当前译文；本卡片刷新不会重新加入，以后再次主动查词会重新开始。

查词使用[有道公开词典](https://dict.youdao.com/)的单词查询与发音接口，不需要有道智云账户。公开接口可能调整；请求失败时可重试，已有生词仍可读取本书保存的释义。

公开查词接口不提供整句译文。选中句子后点击 **AI 翻译** 图标，使用已配置的 DeepSeek、Agnes 或自定义 AI 服务译为中文，卡片明确显示 AI 来源。整句只翻译，不加入生词表；使用此功能需要现有 AI 配置，单词查词不依赖 AI。

查询成功的单词默认自动保存到当前书籍的 `vocabulary.json`，重新查询会清零连续未查询次数并恢复最强高亮。词形按原样记录，忽略大小写，不自动猜词根。可分别关闭自动加入和后续高亮。

生词所在段落真正进入视口后，在离开段落或翻页时计一次有效出现。同词同段只计一次，回看、重排和重开不重复；重新查询开启新一轮。连续 **5 次**有效出现且未查询后，逐渐淡化的高亮和单词记录一起删除。设置可选择 **3 / 4 / 5**，或自定义 **1–100** 次。没有单词历史库、背诵、测试或复习任务。

活跃生词优先读取本书保存的释义。其他单词查询使用最多 128 条、30 分钟有效的会话缓存，关闭插件后清空；整句译文仅显示在当前卡片，不建立永久翻译库。

### 数据与限制

每本书的目录保存原书、`reading.json` 和 `批注.md`；首次成功加入生词后只多一个 `vocabulary.json`。语言切换不改旧文件名或数据。AI 密钥保存在插件本地 `data.json` 中，未加密，请保护 Vault 同步和备份。升级保留现有生词，旧有道凭据不再使用并在下一次保存设置时移除。AI 解读或整句翻译会将相应文本发送至所选接口；连接测试仅发送探针。有道仅接收主动查询的单词和播放发音的单词。查词释义与整句译文使用中文，不随界面语言改变。

CBZ 和扫描 PDF 没有可查询的文本；普通 PDF 依赖原文件的文字层和段落布局。DRM/加密书籍不受支持。免密有道单词查询与音频已实际连通；AI 整句译文质量和 Android/iOS 真机尚未验证。桌面验收使用 macOS Obsidian 1.13.7 独立 Vault，窄屏使用移动 CSS 模拟。

## English

### Features

- Read EPUB, PDF, FB2 (including `.fb2.zip`), unencrypted MOBI, AZW3 and CBZ. Original files stay in your Vault.
- Four real cover cards per page, search, unread/read filters and your own categories.
- Immersive reading, paginated or scrolling layouts, font/background controls and saved reading positions.
- Listening in the reader, starting at the current sentence with temporary source highlights and automatic page following; pause, stop, speed and voice controls.
- A single row of selection icons: copy, translate, color circle, annotation and more. AI explanation and close are in More. Tap the circle to save a highlight; hold it to choose a color. Highlights have no outline.
- Hold and select an English word to look it up; a single tap keeps reading. Vocabulary is saved per book and fades on later appearances; words are removed after 5 missed lookups by default, or manually from the translation card.
- Request a contextual AI explanation for a selected passage. Save it to notes only when you choose to.
- Each book has one continuously updated Markdown document with excerpts, personal notes, dates and source links. Write book-level thoughts directly in it.
- Native Markdown edits are preserved. When both the document and reader change the same passage, both versions remain available.
- Library, reader and notes share the current tab and support Obsidian's native back navigation.

### Installation

Requires Obsidian 1.5.0 or later. Download `QReader-1.2.3.zip` from the Release, then copy its `qreader/` folder into your Vault's `.obsidian/plugins/`. The plugin folder must contain `main.js`, `manifest.json` and `styles.css`. Restart or reload Obsidian and enable QReader under Community plugins.

Alternatively, add `lulalulaluobo/QReader` through BRAT to install the latest stable release. When updating manually, replace only those three files and retain `data.json`, your books and reading records.

### Listening (1.2.3)

Select the headphones icon to reveal a compact bar with four controls: play/pause, speed, voice settings and stop. It leaves the book unobscured. Narration starts at your current visible sentence, temporarily highlights the passage and follows it across pages or scroll positions, continuing into the next part of the book. Press speed to choose a rate; open settings only when you want to change the speech service or voice. Stopping hides the bar. Manual page/chapter navigation, changing books or leaving the reader stops playback.

To choose a starting point, select text and press the play triangle in the selection menu. Narration starts with the complete short sentence containing the selection's beginning and continues forward. Existing highlights and annotations can also start narration at their source. The bottom play button uses the selection while its menu is open. Selecting a new passage while playing or paused replaces the old position instead of restarting at the top of the page.

Desktop defaults to Web Speech system voices. Android's Obsidian WebView does not support that API, so it automatically uses **Bing online speech**, playing inside Obsidian with no personal API key. Choose 0.5–2× speed from the bar, and a service or Chinese/English voice in voice settings. System speed changes apply from the next sentence; resuming repeats the current short sentence. Online audio resumes at its paused position.

Online playback requires internet and sends the current short passage and at most the following passage to Bing. Sessions and audio stay in memory. This web endpoint can change or become unavailable; errors offer retry or a manual service switch. Speech follows the book's text, independently of interface language. Text-based books and PDFs are supported; image-only CBZ/scanned PDFs require a text layer and are not OCR processed. Following operates per short sentence, without word-level timestamps. Background/lock-screen playback is not guaranteed in this first version.

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

**Notes** displays each book's actual `批注.md` document. Highlights are included as excerpts in chapter and reading order. Quotes, your words and saved AI explanations are distinct, with dates and links back to the source. Earlier prompts, answers, AI feedback and completed reviews remain in the collapsed archive. Old appointments do not create tasks.

### One note document per book (1.2.1)

Choose **Edit note document** to open Obsidian's native Markdown editor in the same tab. Write freely under “My thoughts on this book”, or edit and add text elsewhere. Excerpts and annotations accumulate while you read, so the finished book already has its own note document.

Annotations sync when saved, edited or deleted, and when you leave the reader. Ordinary page turns do not rewrite the document. Sync compares the previous generated text, your current document and new annotations. Manual edits remain in place. Simultaneous changes to one passage retain the new reader text in a sync supplement; manually edited text also survives deleting its annotation. Direct document edits do not change the reader's structured annotation records.

The document includes title, author, original-file path, last reading time and last note time. Reading later does not imply a newer note. Manual-edit time is recorded during the next sync or when leaving the native editor. A document uses the interface language when first generated; later language changes preserve existing documents and personal text. Read, edit or provide these plain files to a local LLM independently of QReader.

Thought-thread views and connection requests have been removed. A non-empty legacy `.qreader/thinking.json` is archived as **旧版思考记录.md** in the library, keeping your earlier judgments, questions, connection reasons and available sources. Existing filenames get unique alternatives. Original JSON and earlier exported snapshots remain untouched; later scans preserve your archive edits. Damaged legacy records remain intact and do not prevent reading.

Books retain `reading.json`, `批注.md` and `vocabulary.json`. Unsubmitted old answer drafts remain available to read and copy without automatic saving. Historical AI feedback is a reference rather than a standard answer.

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
npm run test:notes
npm run test:thinking
```

Copy the generated `main.js` together with `manifest.json` and `styles.css` to the plugin folder. `main.js` is a build artifact and is not tracked in Git. / 将生成的 `main.js` 与 `manifest.json`、`styles.css` 放入插件目录；Git 不跟踪生成的 `main.js`。

## License

MIT (see [package.json](package.json)). Dependencies retain their upstream licenses. / 依赖保留上游许可证。
