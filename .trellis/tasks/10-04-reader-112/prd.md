# QReader 1.1.2：三问、单页导航、高亮与分类

## 用户要求
1. 每章三问帮助理解作者表达意图和推论，每题只有一个回答目标。在原生设置增加可编辑提示词，留空时使用下方用户原文，替换 `{{chapter_content}}` 为当前章节正文。
2. 书架、复习、阅读和回答在当前 Obsidian 标签页内跳转，支持原生回退；不再按页面类型创建常驻 leaf，关闭旧 renderer/订阅，保留阅读进度、回答草稿及版本。
3. 选文功能菜单和正文背景明显区分。划线按钮单按确认，长按展开二级颜色选择；选择颜色不立即创建新标记，确认后保存。已有高亮可改色，旧记录缺颜色仍为黄色，EPUB/PDF 重开保持颜色。
4. 有至少四本书时，手机首屏至少显示两列两行完整书籍卡。保留搜索、导入、继续阅读及原有菜单；默认「全部/未读/已读」，新增学科分类、给书指定分类、点分类过滤。用户的「未付」按「未读」处理。
5. 完成隔离运行验收，升级 1.1.2，中文提交并推送 main，发布正式 latest Release 和三个 BRAT 安装附件及 ZIP。

## 默认三问提示词（用户原文）
```text
你是一个阅读理解问题生成器。

请根据当前章节内容，生成 3 个问题：

1. 核心问题
检查读者是否抓住本章最重要的观点、冲突、动机或结论。

2. 逻辑问题
检查读者是否理解本章最关键的一条因果关系、推理关系、转折或证据链。

3. 复述问题
要求读者脱离原文，用自己的语言重新组织本章主要内容。

规则：

- 一问一靶：每道题只能有一个明确的回答目标。
- 不得在一道题中塞入多个子问题。
- 不使用“以及、同时、并且、分别、其中、又、还”等方式追加问题。
- 问题尽量简短，控制在 15～35 个汉字。
- 问题可以简单，但答案允许深入。
- 不追求覆盖整章，只选择最值得理解和记住的内容。
- 三道题不能重复考察同一信息。
- 不问无关紧要的日期、数字、人名等细节。
- 如果一道题需要用户回答“第一……第二……第三……”，说明问题过宽，必须重写。

生成后自检：
“这道题是否只问了一件事？”
如果不是，重新生成。

输出格式：

核心问题：
{问题}

逻辑问题：
{问题}

复述问题：
{问题}

只输出问题，不提供答案或解释。

当前章节内容：
{{chapter_content}}
```

## 决策与边界
- 沿用 Obsidian ItemView、原生导航历史、普通 DOM/CSS、现有 OpenAI-compatible client 与串行 JsonStore；不增加框架或第二个模型服务。
- 提示词跨 AI 提供方共用；旧缓存不自动删除，修改只作用于新生成/主动重新生成。没有占位符的自定义提示词追加章节正文，不让模型丢失内容。
- 标记已读/未读由读者控制；旧记录缺状态时以全书进度是否到 100% 作为显示默认，不自动重写磁盘。每本书可属于一个自定义分类；分类只记元数据，不移动原书或目录。
- 不强制关闭用户已有其他标签页，不清除旧回答、复习或批注。只保留未提交回答的轻量状态，不为回退保留后台阅读 renderer。
- 五种高亮：黄色、绿色、蓝色、粉色、紫色。所有背景下保持文字可读，增加边缘识别；颜色保存到标记，不靠临时 CSS 假装持久化。
- 只使用 tmp/release-112-smoke 独立 Vault 和样书；用户截图是 Android 问题事实，桌面模拟不冒充真机验收。

## 共享接口与编辑归属
- 集成负责人维护 src/types.ts、src/settings.ts、src/main.ts、src/core/library.ts、src/core/json-store.ts、styles.css、版本与 Trellis；统一构建和运行验收。
- `QReaderSettings.questionPrompt: string`（默认空）、`categories: string[]`（默认空）、`highlightColor: HighlightColor`（默认 yellow）。
- `HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple"`；`AnnotationRecord.color?: HighlightColor`。
- src/settings.ts 导出 `HIGHLIGHT_COLORS: Record<HighlightColor, { label: string; fill: string; edge: string }>`，菜单与两个引擎共用。
- `ReadingFile.book.readStatus?: "unread" | "read"`，`category?: string`；src/types.ts 导出 `getBookReadStatus(reading): BookReadStatus`。
- `LibraryManager.updateBookOrganization(entry, patch: { readStatus?: BookReadStatus; category?: string | null }): Promise<void>`；null 删除分类，未提供字段不修改。
- `updateAnnotation` patch 新增 color；沿用 JSON/Markdown 事务。
- `LibraryDeps.questionPrompt(): string`；`generateQuestions(cfg, bookTitle, chapterTitle, chapterText, promptTemplate = "")` 使用模板，支持用户标签文本格式并保留自定义 JSON 问题格式。
- 提示词工作面只编辑 src/ai/tasks.ts 和 src/settings-tab.ts。
- 高亮工作面只编辑 src/views/reader.ts、src/reader/epub-engine.ts、src/reader/pdf-engine.ts；Reader.setState 接收 ViewStateResult 并记录 bookId 变化供原生历史使用。
- 书架工作面只编辑 src/views/bookshelf.ts；新增分类/书籍组织 UI，getState/setState 保存搜索和分类。样式由集成负责人维护。
- 所有工作面中途禁止构建、lint、测试、格式化；完成后统一执行。

## 成熟方案参考
- 已克隆 references/qiaomu-reader（GPL-3.0-only），只调研，不复制源码。其 highlight-colors.js 展示统一的菜单/overlay 色表，main.js 展示 setViewState(type,state) 的视图载荷；使用已安装 Obsidian 声明中的 ViewStateResult.history 与当前 leaf，实现本项目自己的单页导航。
- TypeSafe 的原子问题设计只作提示词原则参考，不引入其 SDK 或 API：https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md 。

## 验收
- [x] 设置自定义提示词、重开、清空恢复默认；真实兼容请求含替换后的章节内容；严格解析三种不同类型且拒绝空/重复/多余问题。生成缓存及已作答版本保持正确。
- [x] 连续书架→阅读→回答→回退→复习→复习回答→回退后，leaf 数不增长，无后台阅读 iframe；阅读位置、筛选和未提交草稿恢复，首次直接进入任意题仍有效。
- [x] 四种阅读背景的菜单对比清晰；真实单按划线、长按选色、长按释放不误保存、取消不保存；EPUB/PDF 改色及重开颜色一致，旧黄色记录可见，批注/定位不丢。
- [x] 至少四本样书的手机首屏四卡可见；分类添加、赋值、过滤、未读/已读切换、搜索组合、重开持久化；原文件、题目、进度和批注不变。
- [x] 七种宽度浅深色及键盘可用，统一构建通过，版本/源码标签/latest/下载文件字节一致。
