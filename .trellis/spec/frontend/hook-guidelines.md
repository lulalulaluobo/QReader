# 事件与生命周期

项目没有 React hooks。使用 Obsidian Component 的 registerEvent/registerDomEvent，以及插件级订阅解除函数。

- 页面仅在打开期间订阅库和设置变化，在关闭时解除。
- 单页导航须启用 ItemView.navigation，并复用 getMostRecentLeaf；切换视图必须销毁旧阅读引擎、释放缓存及订阅。不能因 getLeaf(false) 的名称就认定其一定复用当前页；必须实测 leaf ID 和总数、原生前进/回退与 CFI/草稿恢复。
- 各页 onOpen 立即同步阅读 chrome；EPUB 首次布局测量完成后，对成功读取的恢复 CFI 再次 display/reportLocation，在恢复阶段不报告中间默认位置。转换格式首次排版可能移动目标，须以真实 MOBI/KF8 重开验收。
- 异步加载持有代次标记；用户切换书籍或关闭页面后，旧结果不得更新新 DOM。
- 阅读位置在定位变化后保存，关闭/进入后台时补保存。
- 阅读缓存拥有书籍资源；引擎只拥有 rendition、画布、观察器与事件。引擎销毁不得破坏其他正在读取的源。
- `ReaderView.openBook()` 进入异步加载前分配 generation；`onClose()` 先置 `opened=false`、使 generation 失效并卸载引擎，同时等待最终位置保存。跨 `await` 恢复后必须确认仍是当前打开代次。
- EPUB mount 在每个加载阶段检查已销毁状态；engine 销毁必须从注册时保存的 spine-hook 对象 deregister，不能因为并发关闭把清理方法 `this.book` 解引用到已清空 renderer 的对象。
- 同一本书同一章节的问题生成保持单请求；所有失败可见，不能用空白渲染冒充成功。
- 原生 EPUB 选区不得留下非整页横向滚动；选区存在时恢复分页容器的稳定整页偏移，清空选区、重排、模式切换及销毁必须解除选区锁。
- 隐藏 leaf 的宽高为零时标记 `suspended`，不得调用 EPUB.js resize 或读取不可见 DOM 的 CFI；恢复可见后重建 rendition 并用已保存 CFI 定位，再报告位置，不能覆盖为章节开头。
- 独立弹窗的异步结果同时检查 `generation`、`panelSession` 和 DOM 连接状态；关闭、换书或换面板后，不允许迟到结果重新打开弹窗或隐式保存笔记。
- 生词层只读原文本节点，不包裹正文，不改变 CFI；按活跃词集合重建 Range，计数/颜色变化复用原 Range，只观察包含活跃词的段落。优先 CSS Custom Highlight，缺失时采用裁剪到阅读视口的独立背景覆盖层。
- 视图关闭/换书先同步 flush 已可见段落事件，再立刻使代次失效；等待已排队的生词写入。布局重建只销毁观察器而不 flush，人为翻页才 flush；重新显示通过可见性检查开启新曝光，同段轮次去重由持久记录保护。
- 原文单击只处理阅读、链接或人工批注，不查词。手机原生长按选中单词才自动进入翻译卡，桌面选中单词也可查询；卡片更多可回到原选区标记菜单，句子须显式点 AI 翻译图标。发音只点按播放，关闭面板暂停。
- 翻译卡当前查询写入完成后才显示删除词按钮；删除沿用该书串行写入，通知立即移除高亮。关闭/换书不回弹，旧刷新结果不追加按钮，删除后该卡刷新不自动再加词。词集合或查询轮次改变时清理旧曝光。

示例：src/views/reader.ts 的 generation、unsub、unsubSettings 和 onClose。
