# 1.2.2 验收记录

## 功能与实现

- 阅读页耳机入口，当前位置逐句朗读、正文临时标色、自动翻页/滚动及跨源单位续读。根据用户反馈简化为四项单行控制栏：播放/暂停、语速、声音设置、停止；默认不打开面板或遮罩，停止后收起。
- 桌面系统语音，Android WebView 缺少 Web Speech 时自动采用 Bing HTTP MP3 + HTMLAudio，不离开 Obsidian；中英文声音、0.5–2 倍语速与设置持久化。
- 参考 GTranslate（MIT，克隆至忽略目录 references/GTranslate）研究 SSML 请求协议，未引入运行时依赖。真实测试要求新随机 IG、Edge UA，页面会话短期保留；不用个人密钥。
- 在线模式只发送当前短句和至多下一短句，音频不落盘；播放错误有提示，停止/手动导航/退出清理高亮与音频，选文暂停。
- EPUB.js 的 Section.load 声明与实际返回类型不符，已修正为读取 section.document。原文 text nodes 不包装，不改变 CFI 或持久化批注。

## 已通过

- npm run build（TypeScript + 生产构建）、npm run test:speech、npm run test:translation、npm run test:notes、npm run test:documents、git diff --check。
- Speech 测试：中文句号无空格断句、英文与 UTF-16 安全边界、SSML 转义、中文/英文声音、短期会话复用、新 IG、401 失效重试、非 MP3 拒绝；默认自动选择、播放前零请求、暂停续听、跨页、同窗口播放器接管、停止后迟到响应/未完成提取、音频 URL 释放。
- 实际隔离 Obsidian 1.13.7：系统语音 onstart 与实际播放，Bing requestUrl 返回 MP3 并经 AudioContext 成功解码（10,368 字节、2.592 秒、48 kHz、单声道），HTMLAudio 实际播放/暂停/续听。
- EPUB/MOBI/AZW3/FB2/PDF 文字提取与源定位均通过，CBZ 无文字明确返回空；PDF 跟随到下一实际页面，EPUB 桌面及稳定 375px 视口的高亮原文位于阅读范围内。
- 听书面板中英文 × light/sepia/sage/dark × 320/375/414/768/1024/1280/1440，共 56 组；等待 EPUB resize 稳定，无横向溢出、主题正确、触控控件至少 44px。设置从实际控件保存，插件重载后服务/语速恢复。
- 原有书籍元数据、章节与历史记录、批注/整书想法对照一致；17 本原书及 vocabulary.json 字节 SHA-256 不变。阅读与听书在同一 leaf；导航停止、关闭/重开无播放器残留。
- 原生验收脚本及截图：忽略目录 tmp/release-112-smoke/audio-122-test.mjs、audio-122-compact.mjs、tts-122-compact-mobile.png。早期面板验收用于核心音频与源提取，最终紧凑布局另行覆盖中英文/四主题/七宽度的控制栏及二级声音设置；默认控制栏 4 个控件、高度不超过 64px、无需遮罩，不与正文重叠，点选语速即时生效并重开保留。
- 播放控制栏出现/收起导致视口高度变化时，EPUB resize 显式保留正在朗读的句子 CFI，relocated 重绘临时标色；PDF TextLayer 重绘也恢复当前句子。实际手机宽度与原生 PDF 验证高亮在视口内且重排后不丢。隔离 Obsidian 已退出。

Android 无真机验收。手机测试为桌面视口模拟，未把 HTTP/音频测试描述为 Android 原生结果。原文跟随以短句为单位，首版不保证锁屏后台连续播放；Bing 网页接口需要联网且可能变化或暂不可用。

## 发布包

ZIP 精确包含 qreader/main.js、qreader/manifest.json、qreader/styles.css，无用户数据、密钥、书籍或音频缓存。

| 附件 | 字节数 | SHA-256 |
|---|---:|---|
| main.js | 6433377 | 499708f5e953dbe4a59237d2f27b861c277e9fa9128be76aa4d6ec8d10631cb4 |
| manifest.json | 254 | 54a7de6e1072094e340924013109419bbc6b0fcd0af5f1b1cc2749dc158e298b |
| styles.css | 39112 | 8ec12a6efc12663fd019b2e871840429e8952f40ff1ac9f5e22bf9526effa99b |
| QReader-1.2.2.zip | 2943131 | 96f17a2a9c14c0b697ebfa441a6353d5a139ac4349acbbb1efc3f7bf80e9561d |

## 远程发布回执

源码提交 `830f1c8c8b1d57729a0ec41ef007eebc1dfef7ba`，main 与注解标签 1.2.2 已原子推送；公开远程 main 和剥离后的标签均对应此提交。

[正式 Release 1.2.2](https://github.com/lulalulaluobo/QReader/releases/tag/1.2.2) 已发布并设为 latest，非草稿、非预发布。四个公开附件均 HTTP 200，下载后的字节数、SHA-256 与本地及 GitHub digest 一致；ZIP 精确三文件，逐项字节一致。后续发布日志提交只修改 Trellis 文档，不更换源码标签与附件。
