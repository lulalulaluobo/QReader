# 1.1.9 手机输入布局验收

## 改动

- 手机/窄面板进入阅读想法页不自动聚焦输入，避免直接拉起输入法。已经开始输入时切题延续焦点；同题重绘保留文字、光标选区及输入框滚动。
- 题目、textarea 和三个动作组成独立编辑区；输入时临时收起内部书名/题号/历史/辅助说明，长回答滚动 textarea，长自定义问题在提示区独立滚动。输入退出恢复历史，均不更改磁盘数据。
- `VisualViewport.height/offsetTop` 与所属窗口、内容面板的交集决定高度/偏移；兼容只缩视觉视口、视觉视口平移、整个 WebView/窗口缩小以及缺 VisualViewport 回退。窗口/视口 resize/scroll、ResizeObserver 和 focus 事件使用动画帧合并，关闭释放监听/观察器/待执行帧/临时样式。
- 现有笔记、保存和 AI 行为保持；更新中英 README，版本 1.1.9。

## 验证

- `npm run build`、`npm run test:notes`、`npm run test:translation`、`git diff --check` 通过。
- macOS Obsidian 1.13.7 独立 Vault 安装最终 1.1.9 三文件，`keyboard-119-test.mjs` 通过：窄屏不自动聚焦，原生 Input.insertText 写入 90 行中文；三种键盘视口约束下题目/输入区/按钮均可见且输入高度至少 50px。双语主题七宽度共 84 组无横向溢出。
- 长自定义问题可在上方独立滚动；切题保留原草稿，语言重绘保持文字/光标/输入滚动；失焦恢复历史，缺 VisualViewport 回退；onClose 所属视口监听数量为零，观察器/动画帧/窗口引用均释放。保存正常，17 本书旧题目、回答、复习及批注保持，未处理异步错误为空。
- 截图 `tmp/release-112-smoke/keyboard-119.png` 的灰色区域明确为模拟输入法约束。以上验证键盘缩放/平移的布局适配，**没有启动 Android/iOS 原生输入法，不宣称真机已通过**。
- `notes-118-test.mjs` 在最终安装文件继续通过可选保存无 AI、评价失败/重试、Markdown 回滚、迟到关闭、原生草稿/CFI 回退、旧布局和双语窄宽屏共 56 组；17 本书原文件 SHA-256/旧历史保持，未处理异步错误为空。

## 发布

源码 `0db82bcb7a52a50192e732a6c0bb99845c98dcda` 与注解标签 1.1.9 已原子推送；正式 [latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.9) 发布。

`tmp/verify-release.mjs 1.1.9` 验证四个公开附件 HTTP 200、字节/SHA-256/GitHub digest 与实测构建一致，远程 main 与 peeled tag 指向源码；ZIP 仅含三安装文件，内容逐字节匹配。

| 附件 | 字节 | SHA-256 |
|---|---:|---|
| main.js | 6420566 | `8dc3bd0a8c99304f47453d73277561b9c84e33312639529d692bee919c3e3439` |
| manifest.json | 257 | `9edbc96ef735476baf885001280e5f4a655bde749db4c7bff6af09162340ddad` |
| styles.css | 38428 | `61b4a279300a27075d82bd8ae2aa6706b3a804db08d10fd5af41cf10a2ba28cb` |
| QReader-1.1.9.zip | 2937280 | `efb6058aeffe2133f90685b99110fb3b1683084339838a80037cb85893370328` |

独立测试 GUI 与协议服务器已退出，未操作用户实际阅读库。
