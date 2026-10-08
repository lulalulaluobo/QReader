# QReader 1.2.7：安卓跟手翻页修正

日期：2026-10-08。用户测试 Android 版 1.2.6 后明确要求：手指拖到第一页与第二页之间并按住，两页必须停在中间；松手翻页应接近参考项目的即时响应。

## 为什么 1.2.6 仍无法停在半页

1. 旧代码只在 `touchend` 判断方向并调用 `next/prev`，`touchmove` 没有改变书页的位置。1.2.6 增加的是松手后的连续动画，因此按住时不会跟手。
2. 旧手势要求总时长小于 700ms；按住超过这一时间会失去翻页资格。
3. 松手后再执行固定 300ms 动画，增加完成翻页的等待。此前只验证程序调用翻页的连续位移，遗漏了实际 Touch 输入与半页停留，这次补齐验收。

## 参考项目的设计

- 参考仓库 `joeseesun/qiaomu-reader`，重新克隆目录 `references/qiaomu-reader-20261008`，基准提交 `efbc811c6decd7bb9034b084f366ec6950321320`，版本 4.5.14。
- 它的 Foliate 分页器在 `touchmove` 随手指滚动真实内容带，在松手时根据当前位置与速度确定吸附页。参考适配器未开启 `animated` 属性，Foliate 的默认吸附直接设置目标偏移，因此没有松手后固定 300ms 的动画等待。可对照 [Foliate 官方 paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js)。
- QReader 沿用 EPUB.js/CFI 与 PDF.js，在现有真实内容带上实现同类交互。未更换阅读引擎、批注格式或全书定位索引。

## 最终实现

- `page-gesture.ts` 统一单指水平拖动，使用屏幕坐标，避免跨页 iframe 自身移动导致坐标跳变；移动 8px 后判定横向意图，选词、纵向滚动、链接和双指保持各自操作。
- 手指移动即改变真实书页偏移，按住没有时间上限。超过半页或短促快速划动时提交下一页，拖回、短距离停留或取消则回到原页。
- 触摸松手直接吸附；按钮/键盘动画从 300ms 缩短为 120ms。保留 1.2.6 的首屏后生成全书索引与快速开书优化。
- 同章直接移动列内容；跨章保留旧页并准备相邻章节；PDF 同时移动实际页面。完成或取消后回收额外页面，旧 iframe 手势监听与生词层同步释放。
- 预览期间不提交中间 CFI/页码，不增加生词出现次数；正常导航、布局变动、模式切换、切书与销毁会取消当前拖动。跨 iframe 的第二指接触及仍有另一指的 `touchend` 均取消翻页。
- 本轮覆盖横向单页 LTR 路径；RTL、竖排沿用既有上游导航，尚未扩展到这些排版。

## 验证

正式构建与 `test:reader`、`test:speech`、`test:translation`、`test:notes`、`test:documents` 均通过，`git diff --check` 通过。新增 reader 检查覆盖长按、反向取消、快速划动、纵向/选区/忙碌/多指保护、跨 iframe 打断、剩余触点的结束事件、销毁与即时吸附。

独立测试 Vault，在 Obsidian 1.12.4、375px 桌面视口使用 CDP Touch 输入测试最终生产构建；用户实际阅读库未操作。屏幕内容宽 331px，拖到 60%（198.60px）后按住约 1.25 秒：内容偏移保持不变，仍显示原页位置；松手后只保留当前页面。

| 格式 | 半页停留/完成/返回/取消 | 最终松手到导航完成并绘制一帧 |
|---|---|---:|
| EPUB | 通过 | 66ms |
| MOBI | 通过 | 58ms |
| AZW3 | 通过 | 44ms |
| FB2 | 通过 | 59ms |
| CBZ | 通过 | 60ms |
| PDF | 通过 | 20ms |

这些数值是桌面 Touch 模拟的单轮结果，包含测试请求和最后绘制一帧的开销，不是 Android 真机基准，也不是与参考项目在同设备同书的性能对照。相邻章节/PDF 页面仍有准备成本，大章节、图片与手机 WebView 的实际耗时可能不同。当前未连接 Android 设备，不能据此承诺真机达到相同毫秒数。

- EPUB、CBZ、PDF 进一步通过反向拖回、跨页双指、模式切换、排队导航与销毁打断；EPUB/PDF 选区保护通过，CBZ 为图片书。
- 六格式旧 CFI/页码往返、索引前后位置一致、恢复、快速连续导航、页面数量有界、批注不变均通过；按钮动画采样显示连续中间帧。
- 关闭动画中的阅读器、相邻章加载失败后回滚与重试、旧百分比恢复、模式往返均通过；六格式朗读页边界与安全切书回归通过。
- 测试页面：`tmp/release-112-smoke/reader-touch-test.mjs`、`reader-touch-edge-test.mjs`、`reader-regression-test.mjs`、`reader-edge-test.mjs`、`following-125-formats.mjs`。半页停留截图：`tmp/release-112-smoke/reader-half-drag.png`。
- 最终生产 JS/CSS/manifest 与实际验收的独立插件目录逐字节相同；独立 Obsidian 已正常退出，退出码 0。

## 发布文件

版本：1.2.7。ZIP 仅包含 `qreader/main.js`、`qreader/manifest.json`、`qreader/styles.css`。手动更新只替换这三个文件，保留 `data.json`、原书与笔记。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| main.js | 6452295 | bf29599e3f7e2668421b4c485cabd0fe62340c960eacd87cc5800a40f8a69e49 |
| manifest.json | 254 | 1b44055f792aab836e4a02548edbef72e9e0942466c306ac9b99fe74abb57f72 |
| styles.css | 39248 | 69ed144703290f3c647a5b2ed2d9f184e6a183e87d203d4eeac8ee6e4cef6698 |
| QReader-1.2.7.zip | 2943494 | 10842cff26b5e8a3e008ef60a8488f73bfd6e374375be90160aa0bf7bd0dd6fb |

发布回执将在推送、Release 与公开下载核验完成后补入本文件。
