# 左右单击翻页验收

日期：2026-11-01。用户要求在现有滑动翻页之外增加左右单击翻页，并明确授权推送 GitHub 和发布 Release。

## 实现

- EPUB 及其共用格式、PDF 复用现有点击区域判断和 `next` / `prev` 导航，左侧三分之一上一页，右侧三分之一下一页，保留中央工具栏及原有滑动动画。
- 选区、批注、链接和表单控件优先处理；拖动后的点击不重复翻页，导航忙碌及布局恢复期间忽略边缘点击。
- 滚动模式、浏览器放大和 PDF 自定义缩放不启用边缘单击翻页。EPUB 使用宿主窗口的缩放比例，避免 iframe 的比例固定为 1。
- 不增加依赖，不修改书籍或阅读记录的数据结构。

## 验证

- `npm run build`、`test:reader`、`test:tools`、`test:speech`、`test:translation`、`test:notes`、`test:documents` 和 `git diff --check` 通过。
- 独立测试 Vault：`tmp/release-112-smoke/vault`，未操作用户实际阅读库。
- 使用独立 Obsidian 1.14.4、375 × 812 桌面视口和 CDP Touch 输入，六格式 EPUB、MOBI、AZW3、FB2、CBZ、PDF 均通过左右单击、往返定位、中央工具栏切换、滑动只翻一页、滑动后再次单击及滚动模式不翻页检查；PDF 另通过自定义缩放不翻页检查。
- 原生验收脚本保存在本机忽略目录 `tmp/release-112-smoke/reader-edge-tap-test.mjs`。验收结束恢复模拟设置并关闭独立测试进程。
- 以上为桌面触摸模拟，未进行 Android/iOS 真机验收。

## 1.5.1 发布准备

- `package.json`、锁文件及插件清单统一为 1.5.1，最低 Obsidian 版本保持 1.5.0；中英文 README 更新下载地址与操作说明。
- 更新版本后重新构建通过，产出的 `main.js`、`styles.css` 与六格式原生验收所用文件逐字节一致。
- `dist/1.5.1/` 包含独立的三个安装附件及 `QReader-1.5.1.zip`。ZIP 仅含 `qreader/main.js`、`qreader/manifest.json`、`qreader/styles.css`，解压字节与本地构建一致。
- 发布后使用现有 `tmp/verify-release.mjs 1.5.1` 核验正式 latest 状态、四附件公开下载、SHA-256/GitHub digest、ZIP 内容及远程 main/标签所指提交。
