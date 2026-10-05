# 1.2.0 发布验收回执

- 日期：2026-10-05
- 源码及注解标签：`804249d89e4810123865b9fa3f5a7db22d73d41d`
- Release：[QReader 1.2.0](https://github.com/lulalulaluobo/QReader/releases/tag/1.2.0)，正式、非预发布、latest。
- 发布时远程 main 与 1.2.0 标签对应同一源码；发布后仅追加本回执、任务状态与工作日志。
- Git 工作区保持干净，隔离 Obsidian GUI 和协议测试服务器已退出。

| 附件 | HTTP | 字节数 | SHA-256 |
|---|---|---:|---|
| main.js | 200 | 6442311 | `1fff9276df3bc6cb934ff6d18875e6608bda89b11e13348ee314755c1c4a14d6` |
| manifest.json | 200 | 244 | `817b1da7d59b1f621d288a4eb5fec29287acb4372c30db078903229c8fbea87a` |
| styles.css | 200 | 36730 | `9478ce3f2ceae37513e77ca8ba77ae6204193a4c5e15f872f8a2c64627b83302` |
| QReader-1.2.0.zip | 200 | 2944917 | `a48cb94c996ccae4655641b3138182f2a15ca85d819ca9fd06d0f5732480fcc0` |

四附件公开下载与本地构建逐字节一致，GitHub digest 一致；ZIP 恰好包含 qreader/main.js、qreader/manifest.json、qreader/styles.css。

构建与 test:thinking / test:notes / test:translation 通过。新增验证覆盖确切旧版本、CJK/英语检索、严格AI引用与输入边界、损坏/外部修改/并发冲突、回滚、删除和独立快照。旧问题/回答/复习不迁移。

独立 macOS Obsidian 1.13.7：六格式阅读与安静阅读回归；84组既有布局、28组思考线、28组输入弹窗（7宽度×2语言×浅深主题）；草稿语言切换保持、无溢出，新增输入和按钮至少44px。17本原书哈希、旧章节记录/批注/vocabulary.json 一致。

跨书思考验证包括实际新增/编辑整书想法与批注、确认两条来源、自己填写判断、搜索、导出、读取持久记录、删除失效来源、语言切换使迟到结果失效、清除批注后旧版本引用不可用。实际 open-url 协议及 EPUB/PDF 原文定位通过。

被动浏览/阅读零AI请求。AI协议验收使用本地固定响应；不把它作为外部模型关联质量的证明。窄屏为模拟，不宣称 Android/iOS 真机通过。词语检索可能漏掉措辞差异很大的关系，可手动连接。
