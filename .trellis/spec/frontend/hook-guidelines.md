# 事件与生命周期

项目没有 React hooks。使用 Obsidian Component 的 registerEvent/registerDomEvent，以及插件级订阅解除函数。

- 页面仅在打开期间订阅库和设置变化，在关闭时解除。
- 异步加载持有代次标记；用户切换书籍或关闭页面后，旧结果不得更新新 DOM。
- 阅读位置在定位变化后保存，关闭/进入后台时补保存。
- 阅读缓存拥有书籍资源；引擎只拥有 rendition、画布、观察器与事件。引擎销毁不得破坏其他正在读取的源。
- `ReaderView.openBook()` 进入异步加载前分配 generation；`onClose()` 先置 `opened=false`、使 generation 失效并卸载引擎，同时等待最终位置保存。跨 `await` 恢复后必须确认仍是当前打开代次。
- EPUB mount 在每个加载阶段检查已销毁状态；engine 销毁必须从注册时保存的 spine-hook 对象 deregister，不能因为并发关闭把清理方法 `this.book` 解引用到已清空 renderer 的对象。
- 同一本书同一章节的问题生成保持单请求；所有失败可见，不能用空白渲染冒充成功。

示例：src/views/reader.ts 的 generation、unsub、unsubSettings 和 onClose。
