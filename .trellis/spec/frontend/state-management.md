# 状态管理

reading.json 是每本书阅读、批注与问答的事实源，批注.md 是可重建的派生输出。vocabulary.json 独立保存活跃生词。插件配置通过 Obsidian loadData/saveData 保存，AI 密钥不进入阅读库。

## 1.1.6 免密查词契约（覆盖下述 1.1.5 有道凭据方案）

- 1.1.7 交互修正：单击原文不查询，只通过原生长按单词选区（桌面选词同样可用）进入卡片。词层仅高亮和统计曝光，不再命中点击或持有查词回调。
- 卡片垃圾桶显式删除当前书的当前词；其他词/书不变，删除回读验证并通知即时消除高亮。译文留在卡片，刷新不重新加入，关闭后再次主动查询从 lookupCount=1 开始；没有历史库或撤销档案。

- 用户改用 englishPodStudy 的免密方式：GET `dict.youdao.com/jsonapi?q=...`，原文仅单个英文词。ec/simple 音标和嵌套释义从 unknown 校验，web_trans 优先 `web-translation`；不返回空释义，不复制参考项目的词库/课程功能。
- 发音直接 `dict.youdao.com/dictvoice?audio=...&type=2`，只用户点按播放，关闭暂停。旧活跃词可继续读定义，播放和再次保存改用免密音频地址。
- translation 设置仅 autoAdd/highlight/deletionThreshold，删除密钥字段和签名请求；归一化丢弃旧 appKey/appSecret，下一次设置保存移除磁盘旧字段。查词无需 AI 或有道凭据，既有 vocabulary.json 无迁移。
- 公开单词接口不支持整句，明确入口/卡片“AI 翻译”通过已配置 AI 服务翻译成中文；提示词按界面语言编写但目标中文固定，选文只作为翻译资料。整句不写生词、不统计单词查询、不建立翻译缓存/历史；超过 5000 字拒绝，未配置 AI 显示正常配置错误。
- 保留 128 条/30 分钟单词会话缓存和并发/清空代次保护、按书活跃词优先、曝光与默认 5 次删除。网络/HTTP/非 JSON/空结果错误可重试且不写生词。公开端点可调整，不能宣称永久稳定的商业 API。

## 1.1.5 翻译与生词契约

- 首版只用有道文本翻译 `/v2/api`，v3 SHA-256 签名、英文到中文、音频只接受有道 HTTPS 地址；用户确认不使用禁止缓存的独立词典 `/v2/dict`。不承诺文本接口提供音标或未开通 TTS 的发音。
- `translation` 配置 appKey/appSecret、autoAdd/highlight、deletionThreshold（默认 5，1–100）；旧配置无该字段时补默认。翻译设置通知用 `translation` 原因，更新词层且不重排阅读引擎。
- `vocabulary.json: {version:1,words:VocabularyWord[]}` 每书一份，第一次成功加入才创建；只保存活跃词，不创建历史、复习或永久翻译库。现有原书/reading.json/批注.md 不迁移。
- 单词按英文边界、大小写归一，保留词形；句子只翻译，不加入。重新查询增加 lookupCount，noLookupCount 清零，seenParagraphs 重启并排除查询所在段落。
- exposureCount 为累计有效段落出现，noLookupCount 为本轮连续未查询次数；同词同段落一次，稳定 EPUB spine/paragraph 或 PDF page/text-block ID 保证跨重排/重开去重。事件携带 lookupCount，旧轮迟到曝光不能改变重查后的状态。
- 只有词实际可见才开启曝光，离开整个段落或显式翻页结算；长段中词先离开视口不可提前结算。后台/隐藏/面板遮挡暂停；章节加载不直接计数。到阈值从 words 删除，无历史库。
- 按 adapter/路径串行读最新文件再修改，校验写入与回读，可恢复失败还原旧文件；损坏文件不覆盖。订阅只在视图打开期间存在，同书不同视图同步新词数据；队列完成后清理路径。
- 有容量/寿命的会话缓存为 128 条/30 分钟，同词并发请求合并。清空/卸载使迟到请求不能回填缓存；持久缓存只在活跃词记录内，删除记录后不保留旧词历史。
- 预设 DeepSeek/Agnes 的 URL/model/key 也独立可改，模板只改变模型。支持 Base URL 与完整 `/chat/completions` URL；仅官方 DeepSeek origin/path 和支持的模板模型禁用 thinking，代理不加该选项。
- 2026-10-04 官方模板：DeepSeek deepseek-flash/deepseek-v4-pro；Agnes agnes-3.0-flash/agnes-2.5-flash/agnes-2.5-pro。新安装 Agnes 默认 3.0，旧结构缺 model 仍保留 2.5；默认完整 URL 为 https://apihub.agnes-ai.com/v1/chat/completions。

## 1.1.4 语言契约

- 配置 `language: "zh-CN" | "en"`；旧配置、缺失或非法值回退中文，不迁移阅读库。
- `src/i18n.ts` 与 `src/locales/` 维护类型安全消息表，编号占位符保留动态值。状态切换只转换 QReader 自有文案，较具体模板优先；未知外部错误及用户文字不翻译。
- 空白 `questionPrompt` 使用当前语言的默认模板；非空自定义模板按原文保存，不追加强制输出语言。三问、独立/批注解读、阅读想法参考评价的所有调用点传入语言。连接测试保持固定协议探针。
- 解析同时接受中英三个标签（英文忽略大小写）与既有 JSON，统一为 core/logic/retell、q1/q2/q3；重复、缺失或额外问题拒绝入库。
- 设置通知携带 settings/language/translation 原因；语言切换重绘控件，保留阅读引擎/CFI、当前答题步骤和草稿。不会翻译历史内容，新请求使用发出时所选语言；已生成题目需由用户重新生成才换语言。
- 分类原样存储；创建分类时同时保留中英文内置筛选名称，避免语言切换后名称歧义。

## 写入

src/core/json-store.ts 对每本书串行执行变更、写入与校验，保留 .recovery。磁盘或结构损坏时停止写入；显式恢复前保留原始损坏内容。失败不能污染后续队列；回滚必须保持视图引用一致。Markdown 输出与 JSON 更新保持顺序一致。

## 阅读想法与笔记（1.1.8）

题目有版本；阅读想法引用具体版本，参考评价引用具体记录。重新生成始终追加版本，即使尚未保存也保留旧问题，防止导航草稿引用的题目被替换。三问可全部略过或只记部分题；保存只写本地记录，评价由读者主动请求。历史可随时查看，不以重新回答作为门槛。旧 answers/reviews 以及预约原样保留，取消新增预约和复习任务；已完成 reviews 作为历史笔记读取。

新 Feedback 使用 `{kind:"reference",comment,perspectives?,evidenceNotes?}`；旧 authorView/rethink/factualErrors 验证及显示保持兼容，不改旧文字。新评价只发送有内容的问题/想法，不评分、不提供标准答案、不评价未回答问题。生成三问、保存想法、附加参考评价均在 JsonStore 队列内同步 `批注.md`；附属文件失败必须回滚 JSON/内存，并可重试，不产生重复记录。`批注.md` 沿用文件名扩展阅读笔记，按章节与历史题目版本对应。

健康书籍和损坏书籍使用判别联合；访问 reading 前先用 isHealthyBook 缩窄。

## 1.1.2 提示词、导航、分类与高亮

- 插件 `questionPrompt` 默认空，留空/空白使用用户提供的默认模板；`{{chapter_content}}` 替换章节正文，不含占位符时追加正文。支持三个中文标签或原有 questions JSON；拒绝空题、重复题、重复类型和多余标签，失败不更新问题版本。修改提示词只作用于后续生成，不自动清理缓存。
- 四个视图启用 `navigation = true`；通过 `getMostRecentLeaf()` 复用当前主标签页，没有主标签页才使用 `getLeaf(false)`。`setState` 增加历史时保留宿主已设置的 `history`，不得将跨视图导航的历史标志覆盖为 false。
- 回答草稿由 Obsidian 视图历史和插件 `pageStates` 记录轻量数据，按阅读库、书籍、章节、模式、预约日期区分；提交成功清除暂存草稿。书架搜索和筛选、笔记书籍/章节筛选随导航恢复，不保留旧阅读引擎。
- `settings.categories` 保存用户分类；每本书的 `book.category?` 和 `book.readStatus?` 经串行 JsonStore 写入。旧记录不迁移，缺状态以全书进度是否完成为显示默认；分类变化不移动原书、不改章节/进度/批注。
- `AnnotationRecord.color?` 保存五种颜色；旧记录缺色时黄色。菜单选色只是草稿，短按确认才写盘；EPUB/PDF 共用 `HIGHLIGHT_COLORS` 并保存标记对象副本，改色后立即重绘，避免对象原地修改隐藏旧值。默认下次颜色另存插件设置。
- 1.1.3：书架 `pageIndex` 随原生导航/插件页面状态恢复，筛选或搜索变化重置为 0，书籍减少时夹到最后有效页；仅为当前四本加载封面。图标菜单 `colorsOpen/actionsOpen/confirmDelete` 都是短期 UI 状态，不新增磁盘字段。正文高亮去描边不迁移颜色或记录。

## 六种书籍格式与 AI 提供方契约

### 1. 范围与触发
- 导入、原书读取、缓存、阅读引擎、配置、AI 请求和持久化为跨层契约；扩展格式或提供方时同步所有调用点，不加兼容别名。
- 六类格式：EPUB/PDF 原生引擎；FB2/MOBI/AZW3/CBZ 只在运行时转换为内存 EPUB。CBZ 是固定图像页，无文字问答或文本批注。
- `references/qiaomu-reader` 为 GPL-3.0-only 调研样本；不复制插件源码。Foliate.js 1.0.1 与 fflate 0.8.2 使用独立 MIT 许可并在代码中保留声明。

### 2. 接口
- `detectBookFormat(fileName: string, bytes: ArrayBuffer): Promise<BookFormat>` 验证扩展名、容器签名与可读取结构；`.fb2.zip` 记录为 `fb2`。
- `bookAsEpub(bytes: ArrayBuffer, fileName: string, format: BookFormat): Promise<ArrayBuffer>`：EPUB 返回同一书籍数据；PDF 拒绝；其余格式生成确定性内存 EPUB，不写转换副本。
- `BookCache.getEpub(entry)` 仅读阅读库 `book.fileName` 中的原书。`EpubEngine` 使用原格式身份共享章节 CFI；PDF 保存 `pdfPage` 与 `pdfPageFraction`。
- `loadAiSettings(raw: unknown): AiSettings` 迁移旧版扁平地址/密钥/模型到 `custom`；`getAiConfig(settings)` 只读取当前提供方键。`chatCompletion(config, messages, opts?)` 接受基础或完整 URL，发送 `{ model, messages, temperature, max_tokens? }`；仅官方 DeepSeek origin、规范路径与 deepseek-flash/deepseek-v4-pro 附 `thinking: {type:"disabled"}`。按实际地址和模型判断，代理地址不附。

### 3. 持久化与请求契约
- `reading.json` `version: 1` 仍保存实际 `book.format`、清洗后安全 `book.fileName`、原书内容、原版 CFI/PDF 定位、批注、问题版本、答案/反馈/复习。改版不迁移、不覆盖用户原书或书库记录。
- CBZ 仅保存 `book.format: "cbz"`、序页及进度。不得为图像页生成空正文三问、回答、文本标记或复习记录。
- 密钥仅存 Obsidian 插件 `data.json`，按 `deepseekApiKey` / `agnesApiKey` / `custom.apiKey` 独立保存；未加密，UI 用 password 控件并明确备份风险。AI 只在三问、选文解释、整句翻译和提交反馈场景调用。
- 默认 Base URL/model 与可编辑模板见 1.1.5 契约。旧自定义配置以原字符串迁入，不向任一预设提供方复制密钥。

### 4. 验证与错误矩阵

| 条件 | 结果 |
| --- | --- |
| 扩展名与文件头/container 不相符，或 ZIP/FB2 XML/MOBI EXTH/记录结构损坏 | 导入前明确拒绝；不得部分创建书籍目录 |
| DRM/加密保护的 EPUB/MOBI/AZW3 | 拒绝，不绕过保护 |
| `.fb2.zip` 中没有恰好一本 `.fb2`，或 CBZ 无可读图片 | 拒绝导入 |
| AI Base URL 非 HTTP(S)、包含凭据/查询/片段、model/key 空 | 不发请求；显示明确、安全的验证错误 |
| HTTP 401/403/404/429、其他非 2xx、损坏响应或网络异常 | 显示通用状态说明；绝不暴露原始响应/Authorization；答案保存结果不得因此重复提交 |
| provider、key、model 或设置视图在连接探针期间变化/关闭重开 | 作废过期结果；下一视图需重新渲染，不残留永久禁用状态 |

### 5. Good / Base / Bad
- Good：校验 EPUB、PDF、FB2、FB2 ZIP、MOBI、KF8/AZW3、CBZ 后再执行原子导入；在内存转换，读取原字节，保存并恢复 CFI；CBZ 图片自然页序并精确恢复图片页。
- Base：旧 `reading.json` 对新旧格式的 `format` 与定位继续判别；缺字段时仅按当前原有默认规则，不暗中重写既有历史。
- Bad：扩展名即可信任而接受损坏容器、把 DRM 当解析缺陷降级、把另一家密钥当默认值、请求错误回显密钥、将 CBZ 伪装成文字正文、因为排版修改复位 CFI。

### 6. 必需消费者级检查
- 构建通过；隔离 Vault 真实导入和阅读六类原书，六类退出后重开回原位置；FB2/MOBI/AZW3 的批注可精确回到原句。
- 保留旧 EPUB CFI/笔记和 PDF 页码/页内比例、旧题目版本/答案/反馈/复习；CBZ 只运行图片翻页/位置恢复。
- 无效签名、畸形容器及 DRM 无部分落盘；验证 `.fb2.zip` 别名，比较安全存名下原始文件字节。
- 本地兼容端点验证两预设各自模型/Authorization 与 URL、自定义端点、老配置迁移、失败脱敏、连接探针和过期结果抑制；无真实密钥时不得宣称外部连接成功。

### 7. 错误与正确
**错误：**
```ts
// 将旧扁平 API Key 作为新默认供应商凭证。
const ai = { provider: "deepseek", ...raw };
// 将 CBZ 生成空章并调用文字出题。
await ensureQuestions(cbzEntry, chapterId);
```

**正确：**
```ts
const ai = loadAiSettings(raw); // 旧扁平凭证只进入 custom。
if (entry.reading.book.format !== "cbz") {
  await ensureQuestions(entry, chapterId);
}
```

只有内存转换的格式共享 EPUB 引擎，不改变磁盘格式、原文件字节或历史定位格式。

## 1.1.1 选文与底部弹窗契约（回答部分已由 1.1.8 替代）

### 1. 作用域与签名
- `EngineSelection` 新增可选 `copyText`：浏览器完整原始选区，只用于复制；`text` 仍为批注引用，EPUB 去首尾空白，PDF 限当前页。
- `QReaderPlugin.openAnswer(bookId, chapterId, mode, scheduledFor?, question?)` 的 `question` 为 `{ id: string; version: number }`，与 `AnswerView.openFor` 一起定位题目及版本；未提供时保留从第一题开始的流程。
- `LibraryManager.coverPath(entry): Promise<string>` 使用目录名的 SHA-256 十六进制值命名插件 `.cover-cache/<hash>.txt`，不改变原书目录或记录格式。

### 2. 状态与载荷
- 选区菜单可复制、划线、批注或 AI 解读；AI 解读弹窗持有选区和一次性结果，显式存入笔记前没有 `AnnotationRecord`。
- `generation` 标识阅读书代次，`panelSession` 标识弹窗代次；`confirmingNoteId` 持有待确认删除的笔记，不以临时 DOM 代替状态。
- 回答草稿、题目版本、当前题目分别保存；任意一题有想法即可保存，想法和参考评价继续绑定 `questionVersion`。
- EPUB `suspended` 表示隐藏/零尺寸 renderer；`position.cfi` 是恢复事实源，不从隐藏或失效 iframe 反推新位置。

### 3. 数据流与持久化
- 复制使用 `copyText ?? text`，不写磁盘；PDF 跨页完整复制与单页批注定位分别处理。
- AI 解读经现有 `explainSelection` 接口请求，按需重试；仅用户确认存入时调用 `saveAnnotation`，再更新高亮及 Markdown。
- 删除确认后调用现有 `deleteAnnotation`，沿用串行 JSON 写入与 `批注.md` 重建；取消只清确认状态。
- 点击任意三问传递题目 ID/版本，先保存阅读位置再打开可选阅读想法；参考评价失败后重试复用已保存记录，不重复创建记录。

### 4. 错误与边界
- 弹窗关闭、切换、书籍变化后，迟到 AI 结果不更新 DOM、不新增笔记；错误可见且可重试。
- JSON/Markdown 删除失败不伪装成功；待删除确认在题目生成等库通知后继续显示。
- 原生选区滚动不能写入错误阅读进度；清空选区、重排、resize、模式切换或销毁时释放选区锁。
- EPUB 零尺寸时不 resize；恢复可见后重建 rendition 并精确恢复已保存 CFI，禁止读隐藏 DOM 将进度改为章首。
- 长书名封面缓存不得直接使用 `encodeURIComponent(entry.dir)` 作为文件名；旧缓存不需要迁移，未命中时从原书重新生成。

### 5. Good / Base / Bad
- Good：原始选区精确复制，批注引用保持既有规范；独立 AI 解读在明确存入后持久化；任意题先答仍统一提交三问。
- Base：没有 `copyText` 的引擎调用可复制 `text`；既有阅读、批注及问题版本无需 schema 迁移。
- Bad：打开解读即保存、关闭后迟到结果覆盖新弹窗、库重绘吞掉删除确认、用零尺寸 iframe 定位覆盖保存 CFI。

### 6. 必需消费者级检查
- 隔离 Vault 中原生选区扰动前后整页偏移/CFI 一致；复制精确，删除取消无变化，确认后的 JSON/Markdown/高亮一致。
- EPUB 隐藏阅读页返回、退出重开、滚动/分页切换仍在同一原文；PDF 跨页复制与单页批注各自正确。
- 本地兼容端点覆盖解读失败/重试/关闭迟到结果及单次明确保存；第三题先答、问题版本切换、反馈重试后历史完整且无重复记录。
- 320/375/414/768/1024/1280/1440px 浅深色书架、弹窗、回答页无横向溢出；真实封面与长书名磁盘缓存可用。macOS 模拟不作为 Android 真机证据。

### 7. 错误与正确
```ts
// 错误：一打开解读便将暂存结果变成笔记。
await saveAnnotation(entry, draft);
// 正确：只有显式保存动作才持久化；复制保持原始选区。
const copiedText = selection.copyText ?? selection.text;
// 正确：隐藏 leaf 不上报章首；恢复时使用 position.cfi 重建定位。
if (!container.clientWidth || !container.clientHeight) return;
```
