# QReader 1.3.1 设置布局验收

2026-10-08。用户提供 Android 截图并指出桌面原生设置入口无分页。未连接手机，使用独立 Vault 与真实 macOS Obsidian 1.14.4 验证；用户实际阅读库和配置未操作。

## 原因与修复

1.3.0 的说明和控件通用 `flex: 1 1 200px` 遇到手机宿主 `flex-direction:column` 时，两个 200px 变成高度。原生移动 CSS 复现基本页两项均高 444px。此前只检查横向溢出，未验证实际高度，这是上轮验收遗漏。

改为内容自适应网格，窄容器上下排列，600px 以上设置内容左右排列；子控件不再带固定高度 basis。六分类导航滚动保持可见，宽容器一行、窄容器两行。代码同步隐藏页 display，分页不只依赖新版样式。设置标题显示加载版本。

独立桌面 1.3.0 入口本身能显示六分类，未复现用户那边的缺失，不能直接归因于用户版本。1.3.1 已通过实际 GUI 的 Obsidian 设置 → QReader、基本/阅读/缓存点击与截图：当前页对应内容、其他页隐藏、标题为 QReader 1.3.1。

## 结果

- `npm run build`、`test:reader`、`test:tools`、脚本语法与 `git diff --check` 通过。
- `npm run qa:settings`：中英 × 浅深 × 七宽度 × 宿主移动/桌面方向，共 56 组；每组六页只有当前页可见、无横向溢出，草稿与键盘选择通过。实际设置 ownerDocument 接受移动/主题状态，不用主窗口代替设置窗口。
- 375px、中文浅色移动 CSS：语言卡约 146px，路径卡约 198px；说明末尾多余空白最大 0px，控件余量最大 24px 来自原生小开关，未再出现两个 200px 空白。摘要见 [evidence.json](evidence.json)，原始逐项结果由脚本输出到隔离 tmp。
- `npm run qa:reader`：六格式全文查找/取消/定位返回、四种文字双页、PDF 缩放/平移仍通过。设置修改未触及阅读引擎、定位或数据格式。
- 新可复用 `scripts/settings-ui-qa.mjs` 先核验隔离路径/前台，完成后恢复设置与宿主状态，不保存测试输入。命令见 README 与 [性能指南](../../spec/guides/reader-performance.md)。

升级同时替换 main.js、manifest.json、styles.css 并重新启动 Obsidian，查看标题版本。只有禁用/启用时，宿主仍可能保留旧 manifest/样式缓存；本轮通过正常退出重开验证三文件生效。此处是升级操作建议，不是对用户桌面原因的断言。

## 发布回执

最终三生产文件与被测隔离插件逐字节一致。安装包精确包含 qreader/main.js、qreader/manifest.json、qreader/styles.css，内容与单独文件一致；隔离 GUI 正常退出码 0。

| 附件 | 字节 | SHA-256 |
|---|---:|---|
| main.js | 6492921 | 22e3adf96e0061547fdae42c08451f146d7baeaab10ab37dbdbbaf09ca7e4e12 |
| manifest.json | 254 | 20880eb6c86017f7eead8c118a0a4150e24629a48146a617d884ac266e9c0340 |
| styles.css | 41451 | 9cd9af7c6404a88b688d623057d5b4395bc992f0c713df8fcae1e0240d89315b |
| QReader-1.3.1.zip | 2956080 | 692a1e4cea7dc617cabe82df2c222ac2b3f7db83a59db4080c8b54f5c2e26737 |

源码提交 `6db8231fc75c93b650bd852b5d461ab729175e6c`，main 与注解标签 1.3.1 已原子推送。[正式 Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.3.1) 于 2026-10-08 08:08:34 UTC 发布，draft=false、prerelease=false，latest 接口指向 1.3.1。

四个公开附件均 HTTP 200，字节、大小、SHA-256 与本地及 GitHub digest 一致。公开 ZIP 精确三文件，内容与单独附件一致。
