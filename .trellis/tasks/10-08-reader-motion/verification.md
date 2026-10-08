# 连续翻页与快速开书：研究及验收

已实现真实书页的连续横移。固定同一书籍、同一 CFI 的桌面实测，EPUB 开书中位数由 **419ms 降为 141ms**，20 章 MOBI 由 **2436ms 降为 203ms**。六种格式的翻页、重开定位和批注数据回归通过。

## 竞品研究

2026-10-08 重新克隆 [qiaomu-reader](https://github.com/joeseesun/qiaomu-reader)，保存在 [竞品目录](/Users/luluen/ai-project/QReader/references/qiaomu-reader-20261008)。克隆时默认分支 HEAD 为 `efbc811c6decd7bb9034b084f366ec6950321320`（2026-10-06）。

- [自定义分页器](https://github.com/joeseesun/qiaomu-reader/blob/efbc811c6decd7bb9034b084f366ec6950321320/src/main.js#L3223) 对整条内容带设置 `translate3d`，配合 [280ms CSS transition](https://github.com/joeseesun/qiaomu-reader/blob/efbc811c6decd7bb9034b084f366ec6950321320/src/styles.css#L879)。相邻页同时存在，所以旧页移出时新页能够逐渐进入。
- 最新版本的 EPUB/MOBI/FB2/CBZ 已走 [Foliate 适配器](https://github.com/joeseesun/qiaomu-reader/blob/efbc811c6decd7bb9034b084f366ec6950321320/src/reader-engine.js#L112)，当前 PDF 仍走自定义分页器。不能将两条渲染路径的实现混为一谈。本次依据用户描述的视觉过程实现连续横移。
- 竞品开书通过 `view.open` 与当前位置 `init` 渲染当前章节；没有在首屏前生成全文 CFI 索引。其实际 100–200ms 来自用户观察，本轮没有安装竞品运行计时。

QReader 的主要延迟来自首屏前 `await book.locations.generate(256)`。当前 EPUB.js 的 `Locations.process` 每处理一个线性章节默认等待 **100ms**；十几章便会累积一两秒，还需加上文件读取、转换和渲染。普通分页的跨章逻辑则先 `clear()` 旧视图，随后才加载新视图，无法展示两页同时移动。

## 实现

- [EPUB 分页管理器](/Users/luluen/ai-project/QReader/src/reader/epub-slide-manager.ts)：同章移动既有列；跨章先在当前内容带中加载真实相邻 iframe，完成滑动后移除旧章节。一次结束只保留一个章节视图；失败回退到旧页。RTL、纵排等路径继续使用上游导航。
- [PDF 引擎](/Users/luluen/ai-project/QReader/src/reader/pdf-engine.ts)：保留当前画布、文字层和批注，先在视口外渲染目标页，再同时移动两页，结束后释放旧页。
- [共用动画](/Users/luluen/ai-project/QReader/src/reader/page-motion.ts)：300ms ease-out，支持减少动态效果设置与 AbortSignal；跳章、恢复位置、听书定位不额外加入手动翻页动画。
- [位置索引](/Users/luluen/ai-project/QReader/src/reader/epub-locations.ts)：首屏后分章处理，主动让出输入时间，使用同一 EPUB.js 解析器生成 256 字符间隔的旧格式 CFI。独立加载文档，不卸载当前阅读章节；仅在全部成功后发布索引，关闭即取消。
- [阅读引擎](/Users/luluen/ai-project/QReader/src/reader/epub-engine.ts)：有效 CFI 直接恢复，百分比旧记录按需等待索引；阅读 CSS 在首次排版前注入，并与后续字体/主题更新共用同一个样式节点。等待实际 relocation 帧，只有目标不在视口内时才重新定位。
- [开书流程](/Users/luluen/ai-project/QReader/src/views/reader.ts)：词表读取与书籍读取、渲染并行，迟到回包由 generation 隔离。

没有迁移阅读记录，也没有替换 EPUB.js 定位体系。MOBI/AZW3/FB2 的原转换流程保留，因此大型文件的转换和资源解码仍会影响首次打开耗时。

## 同位置耗时对照

环境：macOS，独立 Obsidian 1.12.4，Electron 44.5.1；本地测试库，分页模式。每次从书架进入，释放书籍缓存；从 `openReader` 调用开始，到开书完成并等待两帧。对照正式 1.2.5 构建与本次最终构建，每组各三次，实际恢复 CFI 均与请求相同。

| 书籍 | 1.2.5 三次 / ms | 本次三次 / ms | 中位数变化 |
| --- | --- | --- | --- |
| 阅读中的逻辑，EPUB，2 章 | 406 / 419 / 454 | 154 / 138 / 141 | 419 → 141，减少约 66% |
| Alice's Adventures in Wonderland，MOBI，20 章 | 2319 / 2491 / 2436 | 219 / 203 / 191 | 2436 → 203，减少约 92% |

固定位置分别为 `epubcfi(/6/2!/4/2/1:0)` 与 `epubcfi(/6/2!/4/20/2/1:0)`。这些是桌面本地文件样本数据；375px 测试为桌面视口模拟，不代表 Android 真机耗时。

## 验证

- `npm run build`、`test:reader`、`test:speech`、`test:translation`、`test:notes`、`test:documents` 通过，`git diff --check` 通过。
- 独立 Obsidian：EPUB、MOBI、AZW3、FB2、PDF、CBZ 均通过连续位移、前后往返、快速反向队列、关闭重开定位、视图数量回收和批注记录不变检查。
- 原索引对照：四种可重排文字格式的新索引与原 `locations.generate(256)` 输出逐项一致。
- 逐帧采样：手动翻页约 21–22 帧，跨章节/物理页面同时存在旧、新页面；结束后只有当前章节/当前 PDF 页。
- 375px 视口：EPUB/PDF/CBZ，实际正文宽 331px；连续位移、往返、无横向溢出、旧页回收通过。
- 动画中关闭 CBZ（EPUB 引擎）和 PDF，导航 Promise 正常结束，iframe/canvas 释放；新章节故意加载失败保留旧页，重试可用。
- 只有百分比的旧记录恢复到含目标 CFI 的页面；分页/滚动往返后原锚点仍可见。
- 字体由原书改成无衬线再改回原书，实际字体正确恢复；阅读样式节点始终只有一个。
- 既有六格式朗读页边界与安全切书测试通过；没有新增网络请求。

验收脚本保存在忽略目录 `tmp/release-112-smoke/`：`reader-speed-test.mjs`、`reader-motion-test.mjs`、`reader-regression-test.mjs`、`reader-edge-test.mjs`、`reader-mobile-test.mjs`。可持续运行的自动检查为 [tests/reader-performance.mjs](/Users/luluen/ai-project/QReader/tests/reader-performance.mjs)。

最终本地构建为 [main.js](/Users/luluen/ai-project/QReader/main.js)；与 [styles.css](/Users/luluen/ai-project/QReader/styles.css)、[manifest.json](/Users/luluen/ai-project/QReader/manifest.json) 一起构成插件。用户随后明确授权推送与 Release，版本提升为 1.2.6；未覆盖用户实际阅读库或插件配置。

## 1.2.6 发布包

提升版本后重新构建，reader、speech、translation、notes、documents 自动检查与 diff 检查全部通过。package.json、package-lock.json（含根包）与 manifest.json 一致为 1.2.6。

发布 ZIP 精确包含 `qreader/main.js`、`qreader/manifest.json`、`qreader/styles.css`，解压字节与最终生产构建一致；不包含书籍、笔记、个人设置、凭据或测试库。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| main.js | 6446451 | 495d8ebb46ca448847f30e943f05154285e98ef7a4d2afc4828c0d4bfac62caf |
| manifest.json | 254 | 9c281c395c77ece10716d96a8f99d969f446834f8c88d61604418787d0971017 |
| styles.css | 39248 | 69ed144703290f3c647a5b2ed2d9f184e6a183e87d203d4eeac8ee6e4cef6698 |
| QReader-1.2.6.zip | 2946643 | 9bc101502b7a8f5437d2a66e72154a0be5e76eaf7432067a30d522f2bdc84bd7 |

源码提交：`f99e8bb1a598e6a0b1a73b81599fdadef059566d`。main 与注解标签 1.2.6 原子推送。

正式 [Release 1.2.6](https://github.com/lulalulaluobo/QReader/releases/tag/1.2.6) 为 latest，非草稿、非预发布。四个公开附件均 HTTP 200，下载与本地构建逐字节一致，GitHub digest 与 SHA-256 一致，公开 ZIP 解压精确三个插件文件且字节一致。核验时远程 main 与标签剥离提交均为上述源码提交；后续发布回执与功能对照仅追加文档，不改变标签或附件。
