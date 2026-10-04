# 1.1.7 查词触发与手动删除验收

## 改动

- 移除 EPUB/PDF 单击查词与 WordLayer 的点击命中逻辑；原文单击恢复阅读/链接/人工批注职责。手机原生长按单词选区进入既有 onSelect 翻译路径，桌面原生选词也可查询，保留 CFI/更多菜单。
- 当前书活跃词卡片增加纯图标垃圾桶，当前查询保存完成后显示。删除使用 VocabularyStore 按路径串行变更、写入/回读校验、失败恢复与跨视图通知；只删词记录，保持译文和人工批注。
- 本卡片刷新不重新加词，之后新查询从 lookupCount=1 开始。删除和查询轮次改变时清理旧待曝光事件；卡片请求代次防止旧请求追加过期按钮。

## 检查与实际插件

- `npm run build`、`npm run test:translation`、`git diff --check` 通过。新增测试验证按书手动删除、其他词/书隔离、订阅同步、写入失败回滚、坏文件不覆盖、删除幂等与无历史/新查询从头计数。
- macOS Obsidian 1.13.7 独立 Vault 安装最终 1.1.7 三文件，`vocabulary-117-test.mjs`：实际 EPUB/PDF 原文单击不弹卡、不请求/加词；桌面真实原生单词选区查询一次并保存，译文卡包含音频/刷新/更多/垃圾桶纯图标。
- 实际卡片删除先注入一次写入失败：原文件与内存记录保留，按钮恢复可重试。重试后磁盘 words 为空、原文生词 Highlight 清零、按钮移除而译文保留；刷新不重新加入，关闭后再次查询计数重建。原文文本和人工批注保持。
- 中英文 320/393px 四组卡片垃圾桶名称正确、无文字、按钮可见且无横向溢出；PDF 原文短击和单词选区/删除同样通过。截图 `tmp/release-112-smoke/translation-delete-117.png`。
- `vocabulary-native-test.mjs` 改用真实原生选词，回归缓存、按书文件、视口离段结算/回看去重/重查、字体重排、默认 5 次删除、句子排除、迟到关闭与五图标菜单。
- `vocabulary-long-paragraph-test.mjs` 通过：词滚出但长段仍可见不提前结算，离段才计一次。
- `vocabulary-compat-test.mjs` 通过：覆盖层裁剪、原文/CFI 保留、遮挡暂停、发音点按/关闭暂停、12 组双语主题宽度布局、换书迟到和原 AI 解读。
- `sentence-116-test.mjs` 回归明确 AI 句子入口/双语提示词、词记录不变、错误和关闭保护。以上收集的未处理错误为空。
- macOS CDP 触摸长按未产生系统原生单词选区，不把该模拟当手机手势验证；通过桌面真实原生选词验证共用选区路径。Android/iOS 真机未验收，手机使用平台原生长按选词。没有改变有道 API/缓存/发音协议，实际接口连通证据沿用 1.1.6。

## 产物

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| main.js | 6412950 | 481617aba4154d37c865086addb4c39b481eb88552273302c0e11eda51226cee |
| manifest.json | 256 | 3a84e27a6e93f8c960897e8c5756c29b2093a5ff2931788400125b621ef31fad |
| styles.css | 36404 | ebdf241918ba8caa92f4c94cebf742ecda293545e97f8e366100eb78104f3ee8 |
| QReader-1.1.7.zip | 2934785 | 33b006930bd6b003bb735f0b303112d796fefce40cc2856cd071e162e07c245b |

ZIP 恰好三个安装文件，解压字节与独立 Vault 实测构建一致。JS 和暂存源码凭据模式命中数均为 0。

## 发布

- 源码提交 `a1dfea8a58ad649ac44297cae319108e741f970f`，main 和注解标签 1.1.7 原子推送，远程标签 peeled commit 与源码一致；后续提交只补记录。
- [正式 latest Release 1.1.7](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.7)，draft=false、prerelease=false。四个公开附件 HTTP 200，下载内容、字节数、SHA-256 与 GitHub digest 全部匹配上表。
- `node tmp/verify-release.mjs 1.1.7` 验证 ZIP/字节与远程。未发布配置、密钥、书籍或夹具。独立测试 GUI/服务器关闭。
