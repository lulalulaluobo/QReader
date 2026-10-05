# 1.1.10 验收

日期：2026-10-05。只使用 tmp/release-112-smoke 内的独立 Vault 和 Obsidian，不修改用户现用库。

## 已通过

- npm run check / npm run build：TypeScript 与生产构建。
- npm run test:notes：旧/新历史评价、问题版本、部分回答记录、Markdown、损坏校验与失败回滚；退休的生成问题/新评价协议不再测试或保留执行入口。
- npm run test:translation：免密有道、解析/发音/缓存/错误、默认阈值 5、按书生词队列/回滚/去重/重查/自动和手动删除、双语整句 AI 翻译与模型/URL 设置。
- 原生独立 Obsidian quiet-1110-test.mjs：MOBI/AZW3/FB2/PDF/EPUB/CBZ 打开与换章、原生回退、旧回答/复习布局、草稿关闭重开与语言切换、设置无三问提示词。
- 书籍打开、换章、笔记、旧布局与语言切换全程新增 AI 请求 0；主动选段解读新增请求 1，明确保存才新增批注，删除测试批注后恢复原状态。
- Reader/Notes/旧回答只读笔记 × 中英文 × 浅深主题 × 320/375/414/768/1024/1280/1440：84 组无横向溢出，导航点击区至少 44px。
- 17 本书的原书 SHA-256、书籍元信息、章节问题版本/回答/评价/复习和批注逐项一致；阅读位置按正常阅读保存，无三问自动写入。异步错误为空。
- 历史三问默认折叠，普通笔记与草稿不出现输入框或答题操作；原草稿按 core/logic/retell 的顺序对应原问题。

## 范围

固定本地 AI 端点验证调用与明确保存流程，不评价真实模型质量。测试使用 macOS Obsidian；手机屏宽布局覆盖不等于 Android/iOS 真机手势验证。本次没有改变查词的长按规则。

发布前检查发现 AI 设置仍描述“三问与反馈”，已修正中英文说明，重新构建并在原生 Obsidian 核验两种语言的最终设置；无残留三问提示词或用途。新建且尚未发布的标签使用明确旧 SHA 的 force-with-lease 更新至修正提交，未重写 main 历史。

## 发布核验

源码：`ac75406de06a0334cd82a5fa01a7dfbbc7de391d`；main 与注解标签 1.1.10 推送。[正式 Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.10) 为 latest，非草稿、非预发行。

`tmp/verify-release.mjs 1.1.10` 验证四个公开附件 HTTP 200，逐字节匹配最终产物，远程源码/tag 一致，GitHub digest 匹配；ZIP 严格只含 qreader/main.js、manifest.json、styles.css，内容与散装附件相同。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| main.js | 6379501 | 71bf80ca3fe77fe3baa11df9ce10c6bea499fc4a0817679f1f4fdc8cfc677ef1 |
| manifest.json | 239 | 478d4de7d2949a5bb0cab64446bb142197ff1e0534f987d1c745bf624157e770 |
| styles.css | 35313 | ce5e25f64616ddd50928141e8b7d0a4738303703edd08a8a94b7f9171bc17048 |
| QReader-1.1.10.zip | 2926050 | ef997dd1ad454a0b8d4ba6fdaa58e9d91d9416d865b3dfc0b512a4dcbf26d49e |

独立 GUI 和协议服务器均已退出。
