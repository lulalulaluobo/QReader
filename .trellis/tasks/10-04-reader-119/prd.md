# 1.1.9 手机输入问题可见

用户截图：输入法打开后阅读问题被顶走，无法边看问题边回复。

- 手机进入阅读想法页不自动聚焦/打开键盘，读者主动点按输入。
- 输入时问题、独立滚动输入框和上一题/下一题/保存按钮共同占用键盘上方实际可视区域；历史笔记/辅助说明临时收起，退出输入恢复，不修改草稿或笔记数据。
- 监听所属窗口 VisualViewport resize/scroll、窗口 resize 及面板大小，兼容只缩视觉视口和整个 WebView 缩小；退出释放监听/观察器/待执行帧。
- 复用现有样式/间距/按钮，不引入框架，不修改宿主 viewport meta。官方参考：[VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)、[Chrome 键盘视口说明](https://developer.chrome.com/blog/viewport-resize-behavior)；后者明确 Chrome 浏览器规则不等于 WebView，须覆盖两类。
- 双语主题/七宽度、长草稿内部滚动、VisualViewport 偏移、缺省 API 回退、切题/保存/重开/语言切换及监听清理需独立 Obsidian 验收；手机真机未测不能声称通过。
