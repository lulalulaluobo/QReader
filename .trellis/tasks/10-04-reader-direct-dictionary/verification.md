# 1.1.6 免密有道验收

## 实现与参考

- 只读参考 englishPodStudy 的 apps/api/src/server.js 607–647 行、apps/web/src/data/reviewStore.ts 652–658 行；不修改参考项目，不引入其课程、词库或复习功能。
- GET `https://dict.youdao.com/jsonapi?q=sustain` 返回词典 ec/simple，实际 web_trans 字段为 `web-translation`。QReader 单词请求不带凭据、不调用 AI；设置归一丢弃旧 Youdao App Key/App Secret。
- 整句查询没有译文；不继续试探旧翻译或签名路径。已询问并等待可选偏好，先按明确告知的推荐假设使用现有 AI 配置，入口、卡片和设置标示 AI 翻译，中文目标固定。不宣称用户明确确认该假设。
- 原书、reading.json、批注.md 和 vocabulary.json 结构不迁移，默认 5 次曝光删除与既有阈值保持。旧活跃词读保存释义，发音改为公开 dictvoice。

## 自动与真实插件验收

- `npm run build`、`npm run test:translation` 和 `git diff --check` 通过。
- 协议测试覆盖直接 GET 无 Authorization/签名、ec 嵌套释义与 web fallback、可选音标、空/损坏/HTML 响应与 HTTP/网络错误、单词边界、并发合并、30 分钟到期、128 条容量和清空迟到保护。
- 状态测试覆盖默认 5 次、旧凭据归一丢弃、每书隔离、同段去重、新轮重查、文件串行/回读/失败回滚、坏文件不覆盖；现有 AI 模板/URL 和新双语整句提示词均通过。
- 最终安装构建在 macOS Obsidian 1.13.7 独立 Vault（tmp/release-112-smoke/vault）重新加载，版本 1.1.6；实际原文点击 sustain，GET HTTP 200，显示中文释义、`/səˈsteɪn/`、发音图标并保存当前书单词。发音 HTTP 200、audio/mpeg、11949 字节；没有有道密钥。
- `direct-youdao-116-test.mjs` 验证上述真实查询与中英文设置无密钥字段。截图 `tmp/release-112-smoke/direct-youdao-116.png`。
- `vocabulary-native-test.mjs` 验证实际 iframe 点击、保存/缓存、真实视口离段结算、回看去重、重查恢复、重排无多计、默认 5 次删除、整句不入词表、关闭迟到不回弹与五个纯图标。
- `vocabulary-settings-pdf-test.mjs` 验证原生设置 URL/模型/模板保留、阈值有效输入/持久化、免密设置，实际 PDF 点词/按段去重与无音标处理、EPUB 单词选区返回原 CFI 与人工高亮。
- `vocabulary-long-paragraph-test.mjs` 验证长段内词滚出不提前计数，整个段落离开计一次。
- `vocabulary-compat-test.mjs` 验证 CSS Highlight 缺失覆盖层裁剪、正文/CFI 不变、遮挡不计、发音点按/关闭暂停、12 组中英文/主题/宽度布局、换书迟到抑制、原 AI 解读入口。
- `sentence-116-test.mjs` 验证实际纯图标入口、两种提示词语言和当前模型、整句不新增/重置生词计数、未配置 AI/HTTP 429 可见错误、关闭迟到抑制；旧凭据下一次保存从插件配置删除。
- 最终重新加载后再运行免密查词与整句流程，确认新的 AI 设置发送说明包含整句翻译；所有收集的未处理错误为空。
- 生词和 AI 协议用可控响应覆盖边界；真实有道词典和发音单独实际请求。没有测试 AI 整句内容质量，不把桌面移动 CSS 模拟当 Android/iOS 真机证据。公开接口可变化，不承诺永久可用。

## 安装产物

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| main.js | 6413024 | 3cdd13d6ce1fa50af2207bd69c202c6c6a67a8fd98170d85e2f0e1be03ab4a83 |
| manifest.json | 256 | 84b2d1bc3f2f12013c482e41690dfecc7d016d38c54fad668689d22c91c2d120 |
| styles.css | 36404 | ebdf241918ba8caa92f4c94cebf742ecda293545e97f8e366100eb78104f3ee8 |
| QReader-1.1.6.zip | 2934782 | 902667a005df788275c3565f9399b75326d94a64b0019bd5e6568eb6feb52616 |

ZIP 恰好包含 qreader/main.js、qreader/manifest.json、qreader/styles.css，解压字节与最终独立 Vault 验收构建一致。生产 JS 密钥模式命中数 0。远程发布核验结果待补记。
