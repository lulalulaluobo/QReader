# 1.1.5 动态翻译与生词验收

## 范围与隔离

实际 macOS Obsidian 1.13.7，使用 `tmp/release-112-smoke` 的独立 app/profile/Vault，未操作用户真实插件配置或阅读库。移动端使用宿主窗口宽度和 `is-mobile` CSS 模拟。

用户修正 Agnes 完整 URL 后，一次最小真实连接探针返回 HTTP 200、请求/响应模型 agnes-3.0-flash、文本 ok。密钥仅临时 stdin 使用，不写文件、提交或发布。有道未提供真实账号，签名/传输/释义/发音使用模拟响应和音频生命周期测试，不能声称有道真实调用或发音音质已验收。

## 自动与原生检查

- `npm run test:translation`：中文/Unicode 长短文本 v3 SHA-256 签名、密钥不在请求 body；单词/句子/数字边界、合法发音来源、无音标响应、错误脱敏；并发查词合并、大小写缓存、密钥隔离、清空后迟到请求不回填。
- 同一测试覆盖默认 5、首次词查询创建文件、自动加入开关、查询段落排除、同段/重开去重、重查计数清零与旧轮事件失效、第五次删除为 words=[]、跨书隔离、同路径并发读改写、跨实例订阅、损坏文件不覆盖、部分写入失败恢复旧文件。
- AI 单元覆盖旧配置保留 Agnes 2.5 / 新配置 3.0，多预设独立 URL/model/key；基础/完整/尾斜杠路径不重复追加，官方 DeepSeek 两模型 thinking disabled、代理不附。
- `vocabulary-native-test.mjs`：真实 iframe 英文词点击，轻卡/缓存/恢复高亮，视口进入不立即结算、段落离开结算、同段回看不重复；字体重排不多计，5 次删除；句子不加入，关闭卡片后迟到结果不保存；主菜单单行 5 个纯图标，未处理异常为空。
- `vocabulary-settings-pdf-test.mjs`：原生设置切换提供商，手输 URL/model/key、Agnes 3 个模板、模型选择不覆盖 URL/key、完整地址探针、设置重载保留；有道密码控件、3/4/5/自定义有效整数；真实 PDF 点击/无音标卡片、相同文字块多行只计一次、后续页面曝光；英文单词选区触发翻译，通过卡片更多回到选区并保留原 CFI、正常人工标记保存/删除。
- `vocabulary-compat-test.mjs`：关闭原生 CSS Highlight 后回退层仍在视口内，不改正文 textContent 或选区 CFI；面板遮挡暂停统计；发音只点击播放、关闭暂停；2 语言 × 2 主题 × 3 宽度 = 12 卡片布局无横向溢出，图标有 ARIA；换书迟到结果不写新书、不弹回；更多中的 AI 解读仍工作。
- `vocabulary-long-paragraph-test.mjs`：含生词长段落超过视口，单词滚出而段落仍可见时不计；整个段落离开后计一次。重查开启新轮后，先前查询段落的暂态抑制按 lookupCount 失效，旧段落再次有效曝光。
- `layout-114-test.mjs` 回归：112 组中英/主题/宽度/四视图布局；375×667 首屏四书完整，5 种宽度的选文菜单保持单行 5 图标、44px 命中区域和英文 ARIA，无溢出/未处理异常。
- `language-state-114-test.mjs` 回归：旧语言配置回退、原生下拉保存、未保存设置/回答草稿、复习界面；中英切换 iframe/document/engine 不换、load=0、CFI 不变，原书/批注/问题历史不变，未处理异常为空。
- TypeScript/esbuild 生产构建与 `git diff --check` 通过。截图和原生脚本位于忽略目录，协议/状态测试保存在 `tests/translation.mjs`，可通过 npm 命令复现。

## 发布

源码提交 `d7cca8567f54a96882414da5d5c06593d510b7f3` 与 main/注解标签 1.1.5 已推送，远程标签解析到该源码提交。[1.1.5 正式 Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.5) 为 latest，draft=false、prerelease=false，四个附件均 uploaded。

四个公开附件无鉴权下载均 HTTP 200，字节/SHA-256 与本地实测构建和 GitHub digest 相同。本地四个版本字段均为 1.1.5，ZIP 仅含 qreader/main.js、manifest.json、styles.css，解压逐字节相同。独立 Obsidian 已正常退出，模拟协议服务已停止，最终未处理异常为空。

| 附件 | 字节 | SHA-256 |
|---|---:|---|
| main.js | 6412951 | `64a25608907723b81f29b4a5620c5e661d64a67c21633293badd57be2418504a` |
| manifest.json | 256 | `8bfd88c007a9fdae3704e5409b0f26ac3af838fd075a25f01e1d25fd1588d942` |
| styles.css | 36404 | `ebdf241918ba8caa92f4c94cebf742ecda293545e97f8e366100eb78104f3ee8` |
| QReader-1.1.5.zip | 2934660 | `e07b4791b3e3b0b8148a4e9a9201b4ae192a497ff6132f848889821bc25f1d80` |
