# 1.2.1 验收记录

## 实现

- 撤下思考线视图、跨书搜索与 AI 关联请求，移除 MiniSearch；阅读、翻译、生词与主动选段解读保留。
- 每本书沿用批注.md，收录纯划线、个人批注、已有整书想法、明确区分的 AI 参考解释与折叠历史。按书内顺序排列，带作者、原书、最近阅读/笔记日期和原文链接。
- 笔记页呈现实际文件，原生 Markdown 编辑器在当前标签页打开。自由文字无需额外表单、标签或整理。
- 使用 node-diff3 3.2.1（MIT），已克隆官方参考到忽略目录 references/node-diff3。以独立笔记边界缩小合并范围，基线/最终摘要/观察到的手工日期保存在 reading.json；同处修改保留双方，无待处理队列。
- 附属文档回读、JSON/Markdown 回滚、同步前外部修改保护、按书串行；页码保存不重写文档。离开原生文件时同步手工日期。
- 非空旧 thinking.json 只读归档为普通 Markdown，保留判断、疑问、理由、可用来源版本及缺失来源说明；原文件和已有快照不改，重扫不覆盖手工编辑，同名避让。
- 修正 Obsidian 来源协议的空格编码，兼容旧书名加号编码。

## 已通过

- npm run build；npm run test:documents；npm run test:notes；npm run test:translation；git diff --check。
- 文档测试：升级基线、纯高亮、手工改字/追加、同处修改、重复同步、重启、删除原记录且保留手工文字、日期区分、并发、JSON 与文档抛错/部分写入/错误回读的回滚、同步期间外部变化保护、文档重建、无效元数据拒绝、英文本地文档和归档避让/故障。
- 隔离 Obsidian 1.13.7 原生编辑/实际文件预览/手工与批注同时修改、历史整书版本锚点定位、真实 open-url 事件的 EPUB 和带空格书名 PDF 原文跳转。
- 旧思考文字/理由归档与原 JSON 字节保持不变，归档后手工编辑不覆盖；旧回答草稿与未知布局字段保留。
- reader/notes/legacy/bookshelf × 中英文 × 明暗主题 × 320/375/414/768/1024/1280/1440 共 112 组，无横向溢出，受检控件至少 44px，思考线界面不存在。
- 17 本原书字节 SHA-256、书籍元数据、旧章节/问题/回答/复习、旧批注/整书想法和 vocabulary.json 完整；新增测试记录明确删除后与基线一致。
- EPUB/PDF/FB2/MOBI/AZW3/CBZ 六格式打开/换章正常；被动 AI 请求 0、明确选段解读固定回复请求 1；未处理异步错误为空。

手机测试为桌面视口模拟，未宣称 Android/iOS 真机或外部模型质量验收。截图与原生验收脚本在忽略目录 tmp/release-112-smoke/。

## 发布

正式 latest [Release 1.2.1](https://github.com/lulalulaluobo/QReader/releases/tag/1.2.1) 已发布，非草稿/非预发布。

- 源码提交：aa7622dc0c171b53b0275ee154cdfdddec973b66；注解标签 1.2.1 与远程 main 的发布时提交一致。
- 四附件实际公开 GET 均 HTTP 200，逐字节与 dist/1.2.1 一致；GitHub digest 与实际 SHA-256 一致。
- ZIP 精确包含 qreader/main.js、qreader/manifest.json、qreader/styles.css，解压字节与单独附件及本地构建一致。
- 发布前补充带 #/空格/括号/中文的原书文件名编码单测，并重新通过文档测试和 build。
- 隔离 Obsidian 与测试服务器均已退出。

| 附件 | 字节数 | SHA-256 |
|---|---:|---|
| main.js | 6407493 | 6bef772474cc7b9848734d4c3ebc8711a2025d135fc487a342435b87be8fc930 |
| manifest.json | 254 | cb5ce4c969fa654ad6fb7907f23e717180c8fac20aea592becdc37a175d62425 |
| QReader-1.2.1.zip | 2934633 | ec9521c84154b2ee63a4507efd9cdb71a50adeb48e2b76ee570ca3e2120b045b |
| styles.css | 36212 | 50ff850b6384fcaa215b651633496c3b7ba30bca3f27f26da104fc80c15f0b65 |
