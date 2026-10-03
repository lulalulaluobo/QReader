# 状态管理

reading.json 是每本书唯一事实源，annotations.md 是可重建的派生输出。插件配置通过 Obsidian loadData/saveData 保存，API Key 不进入阅读库。

## 写入

src/core/json-store.ts 对每本书串行执行变更、写入与校验，保留 .recovery。磁盘或结构损坏时停止写入；显式恢复前保留原始损坏内容。失败不能污染后续队列；回滚必须保持视图引用一致。Markdown 输出与 JSON 更新保持顺序一致。

## 回答与复习

题目有版本；答案引用具体版本，反馈引用具体提交。重新生成不得破坏已作答历史。复习前隐藏原文、批注、旧答案及反馈；完成后才展示完整历史。任意章节可即时复习，但不能因此吞掉未来预约。日期按本地日历日解释，不按 UTC 截断。

健康书籍和损坏书籍使用判别联合；访问 reading 前先用 isHealthyBook 缩窄。

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
