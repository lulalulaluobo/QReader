# 状态管理

reading.json 是每本书唯一事实源，批注.md 是可重建的派生输出。插件配置通过 Obsidian loadData/saveData 保存，API Key 不进入阅读库。

## 1.1.4 语言契约

- 配置 `language: "zh-CN" | "en"`；旧配置、缺失或非法值回退中文，不迁移阅读库。
- `src/i18n.ts` 与 `src/locales/` 维护类型安全消息表，编号占位符保留动态值。状态切换只转换 QReader 自有文案，较具体模板优先；未知外部错误及用户文字不翻译。
- 空白 `questionPrompt` 使用当前语言的默认模板；非空自定义模板按原文保存，不追加强制输出语言。三问、独立/批注解读、回答/复习反馈的所有调用点传入语言。连接测试保持固定协议探针。
- 解析同时接受中英三个标签（英文忽略大小写）与既有 JSON，统一为 core/logic/retell、q1/q2/q3；重复、缺失或额外问题拒绝入库。
- 设置通知携带 settings/language 原因；语言切换重绘控件，保留阅读引擎/CFI、当前答题步骤和草稿。不会翻译历史内容，新请求使用发出时所选语言；已生成题目需由用户重新生成才换语言。
- 分类原样存储；创建分类时同时保留中英文内置筛选名称，避免语言切换后名称歧义。

## 写入

src/core/json-store.ts 对每本书串行执行变更、写入与校验，保留 .recovery。磁盘或结构损坏时停止写入；显式恢复前保留原始损坏内容。失败不能污染后续队列；回滚必须保持视图引用一致。Markdown 输出与 JSON 更新保持顺序一致。

## 回答与复习

题目有版本；答案引用具体版本，反馈引用具体提交。重新生成始终追加版本，即使尚未提交回答也保留旧问题，防止导航草稿引用的题目被替换。复习前隐藏原文、批注、旧答案及反馈；完成后才展示完整历史。任意章节可即时复习，但不能因此吞掉未来预约。日期按本地日历日解释，不按 UTC 截断。

健康书籍和损坏书籍使用判别联合；访问 reading 前先用 isHealthyBook 缩窄。

## 1.1.2 提示词、导航、分类与高亮

- 插件 `questionPrompt` 默认空，留空/空白使用用户提供的默认模板；`{{chapter_content}}` 替换章节正文，不含占位符时追加正文。支持三个中文标签或原有 questions JSON；拒绝空题、重复题、重复类型和多余标签，失败不更新问题版本。修改提示词只作用于后续生成，不自动清理缓存。
- 四个视图启用 `navigation = true`；通过 `getMostRecentLeaf()` 复用当前主标签页，没有主标签页才使用 `getLeaf(false)`。`setState` 增加历史时保留宿主已设置的 `history`，不得将跨视图导航的历史标志覆盖为 false。
- 回答草稿由 Obsidian 视图历史和插件 `pageStates` 记录轻量数据，按阅读库、书籍、章节、模式、预约日期区分；提交成功清除暂存草稿。书架搜索和筛选、复习筛选随导航恢复，不保留旧阅读引擎。
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
- `loadAiSettings(raw: unknown): AiSettings` 迁移旧版扁平地址/密钥/模型到 `custom`；`getAiConfig(settings)` 只读取当前提供方键。`chatCompletion(config, messages, opts?)` 向 `${baseUrl}/chat/completions` 发送 `{ model, messages, temperature, max_tokens? }`，仅当请求 origin 为 `https://api.deepseek.com`、pathname 为 `/chat/completions` 或 `/v1/chat/completions` 且模型为 `deepseek-flash` 时附 `thinking: {type:"disabled"}`；Agnes、custom 不附。

### 3. 持久化与请求契约
- `reading.json` `version: 1` 仍保存实际 `book.format`、清洗后安全 `book.fileName`、原书内容、原版 CFI/PDF 定位、批注、问题版本、答案/反馈/复习。改版不迁移、不覆盖用户原书或书库记录。
- CBZ 仅保存 `book.format: "cbz"`、序页及进度。不得为图像页生成空正文三问、回答、文本标记或复习记录。
- 密钥仅存 Obsidian 插件 `data.json`，按 `deepseekApiKey` / `agnesApiKey` / `custom.apiKey` 独立保存；未加密，UI 用 password 控件并明确备份风险。AI 仍只调用三问、选文解释、提交反馈的既定场景。
- 内置 Base URL/model 为 `https://api.deepseek.com` + `deepseek-flash` 与 `https://apihub.agnes-ai.com/v1` + `agnes-2.5-flash`；用户只需填写其对应 API Key。旧自定义配置以原字符串迁入，不向任一内置提供方复制密钥。

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

## 1.1.1 选文、底部弹窗与闭卷回答契约

### 1. 作用域与签名
- `EngineSelection` 新增可选 `copyText`：浏览器完整原始选区，只用于复制；`text` 仍为批注引用，EPUB 去首尾空白，PDF 限当前页。
- `QReaderPlugin.openAnswer(bookId, chapterId, mode, scheduledFor?, question?)` 的 `question` 为 `{ id: string; version: number }`，与 `AnswerView.openFor` 一起定位题目及版本；未提供时保留从第一题开始的流程。
- `LibraryManager.coverPath(entry): Promise<string>` 使用目录名的 SHA-256 十六进制值命名插件 `.cover-cache/<hash>.txt`，不改变原书目录或记录格式。

### 2. 状态与载荷
- 选区菜单可复制、划线、批注或 AI 解读；AI 解读弹窗持有选区和一次性结果，显式存入笔记前没有 `AnnotationRecord`。
- `generation` 标识阅读书代次，`panelSession` 标识弹窗代次；`confirmingNoteId` 持有待确认删除的笔记，不以临时 DOM 代替状态。
- 回答草稿、题目版本、当前题目分别保存；三题全部有回答才提交，答案和反馈继续绑定 `questionVersion`。
- EPUB `suspended` 表示隐藏/零尺寸 renderer；`position.cfi` 是恢复事实源，不从隐藏或失效 iframe 反推新位置。

### 3. 数据流与持久化
- 复制使用 `copyText ?? text`，不写磁盘；PDF 跨页完整复制与单页批注定位分别处理。
- AI 解读经现有 `explainSelection` 接口请求，按需重试；仅用户确认存入时调用 `saveAnnotation`，再更新高亮及 Markdown。
- 删除确认后调用现有 `deleteAnnotation`，沿用串行 JSON 写入与 `批注.md` 重建；取消只清确认状态。
- 点击任意三问传递题目 ID/版本，先保存阅读位置再打开闭卷回答；反馈失败后重试复用已保存答案，不重复创建记录。

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
