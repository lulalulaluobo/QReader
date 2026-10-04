# 免密有道查词

- 用户要求参考 `/Users/luluen/ai-project/englishPodStudy` 接入有道，不需要填写 API Key；该要求取代 1.1.5 的有道文本翻译凭据方案。
- 只读参考其 server.js 的 `https://dict.youdao.com/jsonapi?q=...` 和 reviewStore.ts 的 `https://dict.youdao.com/dictvoice?audio=...&type=2`，不改参考项目、不引入其本地词库/课程/复习系统。
- 接口实际 HTTP 200 返回 sustain 中文释义、英美音标；发音返回 HTTP 200 audio/mpeg。真实 web_trans fallback 字段是 `web-translation`，兼容旧下划线形式。
- 公开查词接口对整句只返回 meta，没有译文；试验旧 fanyi translate 路径也不是 JSON。不继续猜接口或绕过认证。询问用户整句路径，给予回复时间后先按推荐假设保留既有整句能力：明确标示的 AI 翻译使用现有配置，单词仍为有道。已向用户说明这一假设；不宣称得到用户确认。
- 移除有道凭据设置与签名逻辑，旧 translation 配置归一只保留自动加入、高亮和阈值。单词查询默认启用，释义/音标/主动发音保持轻卡。
- 沿用每书 vocabulary.json、128 条/30 分钟会话缓存、并发合并、迟到保护、视口计数和默认 5 次删除；不迁移原书/阅读/批注/生词。
- 验收直接 GET 无凭据、真实有道响应/发音、设置无密钥、EPUB/PDF 查词、缓存/计数/重查/删除和异步关闭；更新双语 README，以 1.1.6 补丁发布。

## 待完成
- [x] 单词接口、设置与升级兼容。
- [x] 整句采用已说明的推荐假设并明确呈现。
- [x] 构建、协议测试与独立 Obsidian 验收。
- [ ] README、远程 Git、正式 Release 和公开附件核验。
