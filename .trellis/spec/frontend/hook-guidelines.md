# 事件与生命周期

项目没有 React hooks。使用 Obsidian Component 的 registerEvent/registerDomEvent，以及插件级订阅解除函数。

- 页面仅在打开期间订阅库和设置变化，在关闭时解除。
- 异步加载持有代次标记；用户切换书籍或关闭页面后，旧结果不得更新新 DOM。
- 阅读位置在定位变化后保存，关闭/进入后台时补保存。
- 阅读缓存拥有书籍资源；引擎只拥有 rendition、画布、观察器与事件。引擎销毁不得破坏其他正在读取的源。
- 同一本书同一章节的问题生成保持单请求；所有失败可见，不能用空白渲染冒充成功。

示例：src/views/reader.ts 的 generation、unsub、unsubSettings 和 onClose。
