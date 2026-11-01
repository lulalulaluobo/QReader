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

## 后续调整：单击翻页方向

用户反馈左手单手持握时右侧难以触及，要求默认左侧下一页、右侧上一页，并允许改为相反设置。

- 增加 `reading.tapNextSide`，缺失或非法值默认 `left`，已保存的 `right` 保留。QReader 设置的阅读分类及书内字号与排版均提供方向选项，修改后立即更新 EPUB/PDF 引擎并持久保存；只改变单击方向，不改变滑动手势。
- `npm run build`、`test:reader`、`test:tools`、`test:speech` 和 `git diff --check` 通过。
- 独立 Obsidian 六格式桌面触摸模拟通过默认左侧下一页、切换反向立即生效、保存后重新加载及重开书籍、中央工具栏、滑动方向与滚动模式检查；PDF 缩放保护仍通过。
- 验证旧配置及非法值回退、左右方向保存/加载；中英文 × 320/375/414px × 全局/书内设置共 12 组检查通过。书内下拉使用“左侧下一页 / 右侧下一页”短标签，复用已有控件宽度。
- 本机验收脚本：`tmp/release-112-smoke/reader-edge-tap-test.mjs`、`tap-settings-layout-test.mjs`。仍为桌面模拟，未进行手机真机测试。

## 1.5.2 发布准备

- 用户再次明确要求推送 GitHub 和更新 Release；版本文件统一为 1.5.2，中英文 README 及发布说明补充默认左侧下一页和两个设置入口。
- 版本更新后重新构建通过，JS/CSS 与六格式方向设置及 12 组窄屏设置验收所用文件逐字节一致。
- 四个附件位于 `dist/1.5.2/`；ZIP 仅含三个安装文件，版本、独立附件和解压字节一致。
- 发布后沿用 `tmp/verify-release.mjs 1.5.2` 检查正式 latest、公开下载、SHA-256/GitHub digest、ZIP 内容和远程 main/标签对应提交。
