# 目录结构

- src/main.ts：插件注册、命令、设置及页面导航。
- src/settings.ts、settings-tab.ts：配置模型、路径校验与原生设置。
- src/types.ts：reading.json 和跨模块运行时契约。
- src/core/：文件适配、串行存储、阅读库、书籍缓存及批注 Markdown。
- src/ai/：OpenAI Compatible 请求及三种专用任务。
- src/reader/：共用引擎接口、EPUB/PDF 渲染和离线资源。
- src/views/：书架、阅读、回答、复习四个 ItemView。
- styles.css：唯一视觉实现，所有插件选择器使用 qr- 前缀。
- .trellis/：任务、规范及开发日志；不另建独立记忆文档。

构建产物 main.js 不进源码仓库；发布包包含 main.js、manifest.json、styles.css。验收脚本及截图置于 tmp/。
