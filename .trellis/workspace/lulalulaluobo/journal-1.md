# 开发日志（第一册）

## 2026-10-03：QReader 初始化与插件集成

- 执行确定性初始化脚本，创建 PRD.md、CLAUDE.md、references/、Git 和 Trellis；保留现有 .gitignore 并补充临时文件/密钥排除。
- 工具：Trellis 0.5.19，ripgrep 15.1.0，实际 Obsidian 1.13.7 可通过 CLI 驱动。
- 指定远程 origin：https://github.com/lulalulaluobo/QReader.git；远程目前为空，默认分支 main。
- 规范模板中默认英文与项目中文记录要求冲突，已改写为中文实际规范。
- 原型视觉保留，统计入口和固定 7/30 天复习不纳入需求。
- 发现并修复设置语法、绝对路径判断、跨书籍定位残留和批注落盘先后风险。
- 核心存储、阅读引擎、回忆页面分为独立工作面集成；构建与真实插件验收将在集成完成后统一执行，尚未宣称通过。

## 2026-10-03：闭环验收与交付

- 可安装产物：根目录 main.js、manifest.json、styles.css；执行 npm run build 完成 TypeScript 检查和生产打包。
- EPUB/PDF 运行时使用浏览器依赖；JSZip 的 Node 流通过浏览器实现打包，PDF.js 的 worker、CMap、标准字体与解码资源一并内置，不依赖 CDN。
- 在独立 Vault 中运行实际 Obsidian 1.13.7。导入 EPUB、带书签 PDF 和无目录 PDF；从当前页创建章节，目录与正文可见。章节三问不是导入时全书生成。
- EPUB 锚点章节提取和跳转、CFI 批注、问题版本缓存、重新生成后保留旧回答已运行。翻页/滚动切换与重载恢复 CFI；最终关闭重开均为 epubcfi(/6/2!/4/8/1:0)、33%。
- PDF 精确选段保存、编辑、排除 AI 解释、撤销及批注.md 同步已运行。页内位置恢复补足滚动空间后，切换模式与重载前后偏移约 0.00084；最终烟雾运行保留第 4 页，分页/滚动均可显示。
- 三问逐题输入；作答时原文隐藏。答案先落盘，协议服务返回 503 后仍仅保存一次；点击重试成功取得反馈。预约可选未来日期；完成即时复习后才展示本次、上次及完整历史回答和对应反馈，不显示评分。
- 阅读页键盘 ArrowRight 在正文获得焦点后将 CFI 从章节开始移至第 2 页，进度变为 33%。深色正文实测前景 rgb(212, 212, 212)、背景 rgb(30, 30, 30)；恢复原主题后继续保持 CFI。
- 验收发现 ReaderView 的 titleEl 类字段覆盖 Obsidian 内部标题元素，导致宿主 load 中 setText 报错，onOpen 的订阅未注册。重命名为 readerTitleEl；修复后原生重新打开错误列表为空、设置订阅为 1，重新加载和主题切换正常。此问题通过真实宿主烟雾回归，无伪 Obsidian 测试。
- 四页面在 320/375/414/768/1024/1280/1440px 共 28 组检查中无页面横向溢出或控件逃出面板；遍历期间 AI 请求计数未增加。另检查移动布局、桌面书架和原生设置弹出窗口。
- 原生设置实测包含阅读库路径、Base URL、API Key、Model、测试连接、字号、行距、主题、阅读模式；测试连接成功。删除测试书籍先弹出确认，确认后调用宿主回收站，原目录移除且书库不再包含该书。
- 临时核心烟雾脚本八项通过：串行写入与前版本副本；失败回滚且后续队列可用；部分写入恢复已保存历史；外部损坏保持原样直到显式验证恢复；拒绝非法历史及源文件路径；相对阅读库边界；批注按 CFI 原文顺序；固定三问及禁止评分的反馈结构。
- npm audit --json 报告漏洞总数 0；依赖升级和浏览器打包后实际 EPUB/PDF 运行正常。
- 验证限制：AI 使用本地 OpenAI Compatible 协议服务，仅证明请求、解析、缓存与失败处理；未验证真实供应商输出质量。移动端为 Obsidian 移动布局及窄视口模拟，未验证 Android/iOS 真机或最低声明版本。
- 安装：npm ci 后执行 npm run build，将三个产物复制到 Vault/.obsidian/plugins/qreader/，在社区插件设置启用；通过原生命令或图标打开书架，再配置 AI。API Key 在本地 data.json 中未加密，应保护 Vault 同步和备份。
- 源码提交 b3d3f5c（完成 QReader V1 阅读、三问批注和主动复习插件）已推送 main 至 https://github.com/lulalulaluobo/QReader.git，未强制覆盖历史；GitHub CLI 未安装，使用原生 Git 完成推送。
- 已关闭独立 Obsidian 验收窗口，停止本地协议服务和渲染测试服务器，移除临时验收目录；保留源码和三个本地安装产物，不提交密钥、原书或临时 Vault。
- 已发布 GitHub Release `1.0.0`，release/tag/manifest 版本一致，BRAT 必需的 `main.js`、`manifest.json`、`styles.css` 均作为公开附件上传并校验 SHA-256。安装时在 BRAT 的 “Add a beta plugin for testing” 添加 `lulalulaluobo/QReader`，选择最新 release。

## 2026-10-03：1.0.1 阅读交互修复

- 书架书名改为独立文本节点并完整换行，覆盖 Obsidian 原生按钮高度和文本布局约束；长书名不裁切首字，也不再限于两行。
- 复习统一筛选正文：优先使用 EPUB OPF guide、导航语义和文档结构；缺少结构的旧书按明确章节名/辅文名及完整文件名回退。待复习和全部章节使用同一规则，旧问题版本、答案、复习和批注均保留；有明确正文语义的 Introduction 不因标题被误删。
- 阅读默认隐藏上下工具栏并设置 inert；工具栏为覆盖层，中央点击显示/隐藏时正文尺寸和位置不变。打开书籍及重新打开均回到默认沉浸状态。
- EPUB/PDF 选文先出现「划线 / 批注」菜单；点击已有标记可编辑批注、取消批注或取消画线。取消批注将同一记录转为纯划线，保留 ID、CFI/PDF 定位和创建时间，仅清除个人理解及收录解释；取消画线删除整条记录。旧 V1 无 kind 的记录仍按批注处理。
- 纯划线不生成批注 Markdown，也不计入书架批注数。JSON 与 Markdown 联合写入失败时回滚注释内容，界面保留未保存草稿；失败不阻塞后续正常保存。
- 实际验收：独立 Obsidian 1.12.4 和模拟 EPUB/PDF，完成选文菜单、直接批注、纯划线、编辑、两种取消动作及旧记录兼容；PDF Markdown 部分写入故障后，磁盘/内存注释回滚，章节历史不变，重试保存成功。复习两类列表仅出现正文章节，旧章节记录保持不变。
- 320px 书架长书名完整多行显示，无横向或纵向文本裁切；320px 已有批注菜单边界为 x=8–312，不超视口，取消旧批注后仍显示划线且章节历史不变。375px 验证工具栏中央点击、正文外侧不唤起、滚动模式和 EPUB/PDF 交互；1440px 书架无横向溢出。
- 触摸验收发现 PDF 横滑同时打开 Obsidian 侧栏；分页正文接管 touchstart 冒泡后，原生触摸模拟翻到目标页且仍停留在阅读视图。另按实际内容底部计算恢复留白，修复短 PDF 页的页内位置被截断；第 1 页保存并重新打开的页内比例均为 0.21402961557631398。
- 最终 npm run build 通过。临时核心烟雾脚本通过 JSON/Markdown 部分写入回滚、对象/记录引用保留、失败后队列续写、问题/答案/复习保留、纯划线 schema、辅文匹配边界与结构语义优先级。
- 版本统一为 1.0.1；BRAT 从 GitHub release 下载 main.js、manifest.json、styles.css。未验证 Android/iOS 真机；不提交验收 Vault、模拟原书或配置。
- 发布结果：修复提交 b90bb29 已推送 main；[GitHub Release 1.0.1](https://github.com/lulalulaluobo/QReader/releases/tag/1.0.1) 已公开且为 latest。三个附件上传状态正常、服务器 SHA-256 与本地构建逐一相同，公开下载的 manifest 版本为 1.0.1。
- 已关闭独立验收窗口，移除临时脚本、样书、Vault 和运行配置；保留根目录安装产物，生产 main.js 仍由 Git 忽略。BRAT 用户在插件设置检查更新至 1.0.1。

## 2026-10-03：1.1.0 六格式阅读与 AI 预设

- 借鉴研究记录指向 `references/qiaomu-reader` commit `cff28ba6`，许可 GPL-3.0-only；检查 `src/reader-engine.js` 多格式接口、`src/main.js` 扩展名路由、`src/status-bar.js` 和 `src/styles.css` 活动阅读视图 chrome 收尾、`src/epub-zip.js` ZIP 中文路径兼容点。未复制 GPL 插件代码；独立采用 MIT Foliate.js 1.0.1 与 fflate 0.8.2。
- 版本升级到 1.1.0，生产构建通过。`dist/QReader-1.1.0.zip` 内含三个安装文件；SHA-256：`ac1970ece3ec32292c7defbbe8e1fe8db50072b0fb40f185e826e40548d5f0a6`。
- 在隔离 macOS Obsidian 1.12.4 Vault 实际导入并阅读 EPUB、PDF、原始 FB2、FB2 ZIP（另验 `.fb2.zip` 别名）、MOBI6、KF8/AZW3 和 CBZ。各格式目录与正文正常，目录父章正文和子节分别保留；MOBI/KF8 取用 Gutenberg 真书，不以改扩展名模拟。8 个测试条目落盘的原书均与源字节逐字节一致。
- FB2/MOBI/AZW3 选正文生成并保存精确 CFI 批注，跳回后提取引文与记录文本完全相符；三种格式的 chapterId 与批注目标章节一致。再次完整重载后，原书格式与 CFI 仍在。CBZ 三张图按 1、2、10 自然排序，触摸翻页、页码与重载均工作，无三问/批注/复习文字路径。
- 损坏 XML/档案、无效标记、空 CBZ、误扩展 EPUB 与带加密位 MOBI 全部在创建阅读库目录前拒绝；基线阅读目录不变。未尝试绕过 DRM。
- 旧 EPUB 与 PDF 的读取定位和批注返回正文有效；插件重载后旧 CFI/PDF 页码及页内比例、annotation IDs、题目版本/回答/复习/反馈对象序列均完全相等。
- 纸白、暖纸、青绿、深色、跟随宿主配色，以及字体/字号/行距/边距/首行缩进/分页滚动模式均在真 EPUB 中验收，应用排版后保留 CFI 与已保存标记。笔记按章节展示、原文跳转和编辑工作；PDF 与 CBZ 固定页态不受排版误改。
- 手机模拟 320/375 宽度和桌面 1440 宽度访问正文及字号、笔记、背景面板；页面、阅读容器和面板无横向溢出。按 Escape/空格、Tab 焦点陷阱和还焦、减少动态效果可用。无障碍快照为设置滑块/下拉框/首行缩进开关提供名称，开关支持空格及 Enter。
- 验收期间发现仅隐藏面板也会因焦点导航引起 reader 根容器横向滚动；`overflow: clip` 后 reader scrollLeft 保持 0、面板全幅可见。关闭加载中的书阅读时曾触发 EPUB `hooks` 已销毁异常；持有 hook 对象进行清理、读取代次保护与关闭时先销毁 engine 后等待最终进度落盘后，重复卸载/加载回归错误列表为空。
- DeepSeek `deepseek-flash` / `https://api.deepseek.com`、Agnes `agnes-2.5-flash` / `https://apihub.agnes-ai.com/v1` 在原生设置中只呈现本服务 password API Key；互切保留独立密钥，不丢未保存的阅读库输入和既有自定义 endpoint/model/key。本地兼容端点实际运行探针、问题生成、批注解释及回答—反馈保存闭环；provider/key/model 变更和设置关闭重开时旧探针结果被丢弃或按钮复原。离线协议脚本还验证旧 flat config 迁移、三个准确 endpoints/Authorization、DeepSeek thinking 条件、HTTP/网络/恶意 URL 错误脱敏，无外网请求。
- 独立 Obsidian 1.13.7 中再次加载最终 1.1.0 构建，1440 桌面 reader 正文/面板正常且状态栏隐藏；导入解析、位置和跨格式 CFI 回归以 1.12.4 独立 Vault 为准。所有测试 Vault/源书/模拟 API 密钥与协议脚本均属 `tmp/redesign-smoke/` 临时验收数据，交付前移除。
- 验收环境仅 macOS 的 Obsidian Electron 1.12.4/1.13.7 与模拟视口/触摸；未用 Android/iOS 真机、真实 DeepSeek/Agnes API Key 或 DRM 保护书籍。AI 协议通过不代表外部账号可用或模型输出质量；PRD 准确写明限制。GitHub latest 仍为 1.0.1，本地 1.1.0 ZIP 未发布。

## 2026-10-03：推送并发布 QReader 1.1.0

- `main` 以 fast-forward 推送到 `origin`，发布标签 `1.1.0` 指向源码提交 `c601791`；未强推。
- GitHub Release 已设为 latest，上传 `main.js`、`manifest.json`、`styles.css` 与 `QReader-1.1.0.zip`；公开页面可访问：[QReader 1.1.0](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.0)。
- 发布说明保留 CBZ 无 OCR、DRM 不支持、未做 Android/iOS 真机与真实 AI Key 验收等限制。


## Session 5: 修复阅读交互并发布 1.1.1

**Date**: 2026-10-03
**Task**: 修复阅读交互并发布 1.1.1
**Branch**: `main`

### Summary

完成选文偏移修复、删除/复制/独立 AI 解读、三问直达回答和封面网格；隔离验收通过，正式 latest 发布且四个附件下载校验一致。

### Main Changes

## 变更
- 修复 EPUB 原生选区自动滚动留下的非整页偏移；隐藏阅读页后重建 rendition 并按保存 CFI 恢复，翻页、模式切换和重开位置一致。
- 笔记面板增加可跨库重绘保留的删除确认；JSON、批注.md、高亮同步。
- 选文菜单增加原文复制与独立 AI 解读底部弹窗；仅明确存入笔记才保存，关闭后忽略迟到结果。PDF 跨页复制完整，批注仍按单页定位。
- 三问使用底部面板，可点任意题开始闭卷回答；第三题先答、版本切换保留草稿及旧答案，三题统一提交，反馈重试不重复保存。
- 书架改为真实封面网格、两行书名、紧凑搜索与导入，保留原有菜单/底部导航；长中文书名封面缓存使用 SHA-256 文件名。

## 验收
- npm run build 通过；macOS Obsidian 1.12.4 独立 Vault 实测 EPUB/PDF 选文、复制、删除同步、AI 解读失败/重试/关闭及明确保存、任意题回答、版本历史、反馈重试和阅读位置恢复。
- 320/375/414/768/1024/1280/1440px 浅深色书架、弹窗与回答页无横向溢出；三问键盘焦点循环通过。
- Android/iOS 真机未复测；本地兼容协议端点不代表真实供应商模型效果。

## 发布
- main 与注解标签 1.1.1 已推送；标签源码为 b402b9551235b3eb375891090d19384f9b4cec92。
- 正式 latest Release：https://github.com/lulalulaluobo/QReader/releases/tag/1.1.1 。
- main.js、manifest.json、styles.css、QReader-1.1.1.zip 已从公开链接下载，SHA-256 均与实测构建一致；下载 manifest 为 1.1.1。
- ZIP 仅含 qreader/ 下三个安装文件，SHA-256：5ce396ed58bfeda473f5fdb3a92d15e5a6e7b06db0b465f44495b553535a6066。
- 已更新 PRD 与 Trellis 的状态、组件、生命周期和消费者级验收契约。


### Git Commits

| Hash | Message |
|------|---------|
| `b402b9551235b3eb375891090d19384f9b4cec92` | 修复选文偏移与阅读交互，升级至 1.1.1 |

### Testing

- 已通过：`npm run build`、独立 Obsidian EPUB/PDF 行为验收、七种宽度的浅深色布局与四个公开 Release 附件下载校验；具体证据见上方「验收」和「发布」。

### Status

[OK] **已完成**

### Next Steps

- 无，任务已完成。

## Session 6: 优化三问、单页导航、高亮和分类并发布 1.1.2

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 每章三问设置支持自定义提示词、空白回退用户默认模板、章节正文替换；标签/JSON 解析和错误不落盘通过。重新生成始终追加版本，保留导航草稿引用的问题。
- 四页面启用 navigation 并复用 getMostRecentLeaf，原生前进/回退实测 leaf ID/数量不变，CFI、草稿、筛选恢复；关闭旧阅读引擎和订阅。各页打开时同步宿主 chrome，转换书首次布局测量后重定位保存 CFI，修复 AZW3 重开退页。
- 选文菜单提高对比，五色划线长按选色、短按确认；松手/选色/取消不落盘，已有标记改色、EPUB/PDF 颜色重开与旧黄色通过。
- 书架手机两列四卡、未读/已读和用户学科分类，新增/分配/搜索组合/磁盘/回退通过；真实长英文书名的复习按钮支持换行。七种宽度浅深色共 56 组页面检查通过，375×667 移动 CSS 首屏四卡可见。
- macOS Obsidian 1.13.7 独立 Vault 验证 EPUB/PDF 及 FB2/MOBI6/KF8-AZW3/CBZ 阅读/重开，原书字节不变；三题提交、反馈 503 重试不重复保存、闭卷复习、键盘焦点/Escape 通过。生产构建和 diff 检查通过，无未处理运行错误。Android/iOS 真机和真实供应商输出质量未验证。
- 源码提交 `3443459ec202979c6c039e47bb4350ca7533c772`、main 与注解标签 1.1.2 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.2) 的四个附件 uploaded，公开下载与本地逐字节/SHA-256 一致。
- ZIP SHA-256：`563a8ebff282f5a072d593ee85aaa2e2d468b16f59ae6576f821c0ef65823cdd`；仅含 qreader 下三个安装文件。详情见 `.trellis/tasks/10-04-reader-112/verification.md`。

## Session 7: 修正封面书架、单行图标菜单和无边框高亮并发布 1.1.3

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 根据用户 Android 截图修正横向矮封面框：两列两行、每页四本、封面等比例且阴影只作用图片；翻页并入导航，搜索/分类重置页码、原生回退恢复页码，极窄容器保留 44px 点击区。
- 用户进一步明确所有选文功能只要图案，使用 copy/sparkles/色圈/square-pen/x；已有标记更多操作的 trash-2/eraser/circle-check 也无按钮文字。主排固定五图标，长按色板单独浮层，方向下键/Escape 提供键盘入口。
- 用户追加去掉高亮外框：EPUB stroke=none、PDF 去掉底边阴影，保持五色与 28% 透明度，旧数据无需迁移。
- 生产构建、14 组书架/14 组菜单浅深色宽度、375×667 四卡、复制/解读/批注/删除确认、指针/键盘、EPUB/PDF 颜色重开、FB2/MOBI/AZW3 无描边高亮通过。16 本样书原书 SHA-256 不变，未处理错误为空。macOS 独立 Obsidian 1.13.7 移动 CSS 模拟，不宣称 Android/iOS 真机或真实模型质量。
- 源码 `c08b1158702b0b809a89f104ae91ca47b22603f0`、main/注解标签 1.1.3 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.3) 四个公开下载附件逐字节、SHA-256 和 digest 与实测产物一致。
- ZIP SHA-256：`6b53573c16c526edcfb668afe8ec59bad07bb33f468cec5175d59add2977fd65`；详细证据见 `.trellis/tasks/10-04-reader-113/verification.md`。

## Session 8: 中英文界面、语言提示词与双语 README，发布 1.1.4

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户要求下一步提供英语前端、设置语言选择、提示词跟随中英文、更新 README 并推送补丁版本。选择 1.1.4；保留已有四卡、单行全图标、无边框高亮和单页回退。
- 添加 zh-CN/en 类型安全消息表，四页面/设置/命令/菜单/图标/通知/已知错误本地化；旧配置默认中文，不翻译原书和用户内容。空白三问模板、选文/批注解读、回答/复习反馈跟随语言；自定义模板原文保留，中英标签与 JSON 使用稳定类型/ID。
- 切换只重绘阅读控制，不移动 iframe，保留非零 CFI、答题步骤和回答/批注/设置草稿；英文长按钮允许换行，书架导航紧凑收缩，Theme 使用简短标签。
- 实际独立 Obsidian 1.13.7 验收原生设置保存/重开/回退、3 条命令与标签页刷新、112 组中英/浅深色/宽度/四页布局、英文菜单 5 宽度、三问/解释/反馈请求与无效响应、复制/批注/闭卷三题/复习反馈。16 本原文件 SHA-256 不变、旧历史不变、未处理错误为空。移动 CSS 与固定协议回复不代表真机或真实模型质量。
- 源码 `73b355a5db8cd031db64001d5c986b1adcb72bdc`、main/注解标签 1.1.4 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.4) 四个公开附件逐字节/SHA-256/digest 与本地实测构建一致，ZIP 只含三个安装文件。
- ZIP SHA-256：`2dc48cdbcfd6671ba3fbcbba2fd9d923eaefff9f6350544757f9cf2573bb265f`；详情见 `.trellis/tasks/10-04-reader-114/verification.md`。独立验收 GUI 与服务器已关闭。

## Session 9: 动态翻译、按书生词、可编辑模型模板，发布 1.1.5

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户提供动态翻译 PRD，确认段落真正进入视口、离开/翻页结算，同段不重复、重查新一轮；后续改默认 5 次，可自定义。确认有道首版采用允许当前缓存方案的文本翻译接口，不用独立词典，不保证音标。
- 只多一份按书 vocabulary.json，活跃词保存释义/计数/段落去重；句子不加词，无词史、背诵或复习。128 条/30 分钟会话缓存、并发合并、清空代次保护；损坏文件不覆盖，失败恢复旧数据，同书视图同步。
- 原文本节点不包装，CSS Highlight 与独立视口覆盖层支持渐淡蓝色高亮；显式查词轻卡、主动发音、关闭停止、迟到不写错书。长段的单词先滚出不提前结算；重查后的旧段落抑制按轮次失效。
- DeepSeek/Agnes URL/model/key 都独立可改，多个官方模板；用户修正完整 Agnes URL，真实 agnes-3.0-flash 探针 HTTP 200/ok，测试密钥未入文件或 Git。旧模型保留，新安装默认 3.0；基础/完整地址不重复拼接。
- 生产构建、可复现协议/状态测试、独立 Obsidian 的 EPUB/PDF 查询、同段去重、5 次删除、长段结算、字体重排、关闭/换书保护、发音生命周期、CFI/人工批注与双语卡片通过；旧语言/112 布局回归通过，最终未处理错误为空。有道真实账户与手机真机尚未验证。
- 源码 `d7cca8567f54a96882414da5d5c06593d510b7f3`、main/注解标签 1.1.5 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.5) 四个公开附件 HTTP 200，字节、SHA-256、GitHub digest 与实测产物一致，ZIP 只含三个安装文件。
- ZIP SHA-256：`e07b4791b3e3b0b8148a4e9a9201b4ae192a497ff6132f848889821bc25f1d80`；详细证据见 `.trellis/tasks/10-04-reader-vocabulary/verification.md`。独立验收 GUI 与服务器已关闭。

## Session 10: 参考 englishPodStudy 接入免密有道查词，发布 1.1.6

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户改为无需有道凭据，指定只读参考 englishPodStudy。采用公开 jsonapi 单词查询与 dictvoice 发音；移除 App Key/App Secret 控件和签名逻辑，旧配置归一丢弃并在保存时移除。默认可点词，单词不使用 AI。
- 真实有道单词 sustain 返回 HTTP 200、中文释义和音标；发音 HTTP 200/audio/mpeg/11949 字节。公开查询不返回句子译文；已提出可选偏好，按明确告知的推荐假设保留整句能力，使用现有 AI 配置并在图标名称/卡片/设置标示 AI 翻译。未宣称用户确认这一假设。
- 原书、reading.json、批注.md 和 vocabulary.json 不迁移。保留活跃词释义缓存、渐淡高亮、视口离段结算、默认 5 次删除、自定义阈值。旧词发音升级为公开地址，整句不新增或重置生词。
- 构建/协议/状态测试通过，最终 1.1.6 在独立 Obsidian 验证真实词典、双语无密钥设置、EPUB/PDF 点击与 CFI、曝光/重查/5 次删除、长段不提前计数、12 卡片布局、发音生命周期和迟到保护。整句明确入口/双语提示词/当前模型/错误/关闭/旧凭据移除通过；未处理错误为空。AI 译文质量与手机真机未验证。
- 源码 `b384ed0a97676ece3c81ae26aed16e5ffa91cba8`、main/注解标签 1.1.6 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.6) 四个公开附件 HTTP 200，字节、SHA-256、GitHub digest 与实测产物一致，ZIP 只含三个安装文件。
- ZIP SHA-256：`902667a005df788275c3565f9399b75326d94a64b0019bd5e6568eb6feb52616`；详情见 `.trellis/tasks/10-04-reader-direct-dictionary/verification.md`。独立验收 GUI 与服务器关闭。

## Session 11: 长按选词与卡片手动删除生词，发布 1.1.7

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户反馈英文单击误触，要求長按才查询，卡片可手动删词。移除 EPUB/PDF 点击查词与词层命中逻辑，保留手机原生长按选词/桌面原生选词查询及 CFI 更多操作。
- 卡片增加纯垃圾桶图标，按书串行删除并即时清理高亮；保持译文，本卡刷新不重新加词，以后新查询重建计数。写入失败保留旧文件/内存并可重试；新查询写完才显示按钮，删除或重查清理旧曝光/过期请求。
- 构建、协议/存储测试、独立 Obsidian 的 EPUB/PDF 短击无查询、原生单词选区、删除/失败/刷新/重查、正文/批注/CFI、曝光与默认 5 次、长段、覆盖层、双语布局及 AI 整句回归通过，未处理错误为空。macOS 触摸模拟未产生原生选区，不宣称手机长按真机通过；手机沿用系统原生选词，Android/iOS 真机未验收。
- 源码 `a1dfea8a58ad649ac44297cae319108e741f970f`、main 与注解标签 1.1.7 已推送；[正式 latest Release](https://github.com/lulalulaluobo/QReader/releases/tag/1.1.7) 四个公开附件 HTTP 200，字节、SHA-256 和 GitHub digest 与实测构建一致，ZIP 只含三个安装文件。
- ZIP SHA-256：`33b006930bd6b003bb735f0b303112d796fefce40cc2856cd071e162e07c245b`；详情见 `.trellis/tasks/10-04-reader-117/verification.md`。独立测试 GUI 与服务器关闭。

## 会话 12：三问可选笔记与 AI 参考评价，发布 1.1.8

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户确认取消复习入口，改为笔记；三问是引导性阅读，不强制闭卷或答完。任意一题有想法即可保存，保存不请求 AI；读者自愿获取参考评价，不评分、不作为标准答案，支持不同解读。
- 新 NotesView 直接回看问题、想法、AI 参考意见及批注；较早问题版本折叠，最近想法展开，阅读笔记面板也展示本章记录。兼容旧复习 View/快捷键，旧回答/评价/复习/预约原样保留，预约不再形成任务。
- 沿用每书 reading.json 和批注.md，生成三问、保存想法、附加参考评价在 JsonStore 队列中同步 Markdown，附属文件失败回滚并可重试。新评价使用 reference 类型，旧反馈字段保留兼容。
- 构建、笔记/翻译测试与最终独立 Obsidian 验收通过：部分保存无 AI、评价失败不重复、Markdown 失败/重试、迟到关闭、原生后退草稿/CFI、旧布局、56 组双语主题宽度；17 本书原文件与旧历史均保持，未处理错误为空。固定 AI 协议回复不作为外部模型质量证明，Android/iOS 真机未验收。
- 源码 `c4668441f697db2c7d69e72bb9b4bbe50de41826`、main 与注解标签 1.1.8 原子推送；正式 latest Release 四附件公开 HTTP 200，字节/SHA-256/digest/ZIP 与实测构建匹配。ZIP SHA-256：`3a30e97cb7ddf7a4bd27a9020264f790481ae71f8b2a733e3054e31a4684723a`；完整回执见 `.trellis/tasks/10-04-reader-118/verification.md`。隔离 GUI 与服务器已关闭。

## 会话 13：手机输入保持问题可见，发布 1.1.9

**日期**：2026-10-04；**分支**：main；**状态**：已完成。

- 用户截图显示打开输入法后问题被顶走。采用 mobile-responsive 技能和官方视口文档，手机进入不自动聚焦；输入时三问提示/独立滚动 textarea/三个动作保持在实际可视区域，长问题可单独滚动，历史说明暂收起，失焦恢复。
- VisualViewport、窗口及面板交集定位/缩高；事件合并动画帧，关闭清理监听、ResizeObserver、帧与临时样式。同题语言重绘保持文字/光标/输入滚动，已开始输入时切题延续焦点。
- 构建、笔记/翻译测试、独立 Obsidian 84 组双语主题/七宽度/三种视口模型通过；90 行草稿、长提示、缺 API 回退和关闭释放通过。56 组原笔记回归、17 本书原文件与旧历史保持，异步错误为空。模拟键盘不等于 Android/iOS 原生输入法，真机未验收。
- 源码 `0db82bcb7a52a50192e732a6c0bb99845c98dcda`、main 与注解标签 1.1.9 已推送；正式 latest Release 四附件公开 HTTP 200、字节/SHA-256/digest/三文件 ZIP 与实测构建一致。ZIP SHA-256：`efb6058aeffe2133f90685b99110fb3b1683084339838a80037cb85893370328`；回执见 `.trellis/tasks/10-04-reader-119/verification.md`。隔离 GUI/服务器已退出。

## 会话 14：撤销每章三问并评估按需阅读辅助，发布 1.1.10

**日期**：2026-10-05；**分支**：main；**状态**：已完成。

- 用户认为三问分散阅读注意力，要求撤销并评估更合适的辅助方式。移除打开/换章的后台生成、三问与回答 UI、重新生成、提示词设置及新回答/评价执行路径。
- 原 reading.json 问题版本/回答/AI 评价/旧复习不迁移不删除，笔记优先显示批注，历史默认折叠。旧 qreader-answer 布局恢复为只读笔记，保留原问题版本和草稿，供查看复制，不自动写入笔记。
- 建议优先完善主动选段解读，再考虑手动回顾已读上下文；不以另一套自动题目或章总结替代。用户尚未选择后续新功能，本次只有撤销与评估。文档：docs/read-assistance-assessment.md。
- 构建、历史笔记和翻译协议通过；原生独立 Obsidian 六格式打开/换章、回退、旧布局/草稿、中英文设置通过。84 组双语主题/七宽度无溢出、点击区正常；被动 AI 请求 0，主动解读请求 1，明确保存/删除批注后 17 本原书与全部历史一致，异步错误为空。
- 发布前修正 AI 设置的残留用途说明并重新构建、原生双语核验；新建未发布标签在明确旧 SHA 的 lease 保护下更新。源码 ac75406de06a0334cd82a5fa01a7dfbbc7de391d 与标签 1.1.10 推送，正式 latest Release 四附件 HTTP 200/字节/SHA-256/digest/三文件 ZIP 一致。ZIP SHA-256：ef997dd1ad454a0b8d4ba6fdaa58e9d91d9416d865b3dfc0b512a4dcbf26d49e。回执见 .trellis/tasks/10-05-reader-1110/verification.md。独立 GUI/服务器已退出；不宣称真机或真实模型质量验收。

## 会话 15：可追溯的阅读思考与跨书关联，发布 1.2.0

**日期**：2026-10-05；**分支**：main；**状态**：已完成。

- 用户确认轻量方案，目标为几个月后找得到、看得懂、接得上自己的想法。批注追加可选历史，支持整书自由想法；旧文字作为基线，不倒推历史。
- 笔记沿用原入口，增加按书籍/按思考线、跨书搜索（含旧版本）。本地 MiniSearch 筛选自己的文字；只有主动找关联才请求 AI，最多十条输入、三条建议，来源/格式严格校验，确认后保存。
- 思考线引用具体版本与确认的关系；当前判断和仍想探索由读者编辑。支持手动连接、移除/删除、回到原文、包含 Vault/版本的来源协议、独立 Markdown 快照。查词/翻页/滚动不进入思考记录，三问继续停用。
- JSON 通用存储继续串行验证、外部变更保护和回滚。清除个人内容使用新空版本，旧引用不误指向遗留划线；删除来源移除历史，线程不缓存原笔记内容。导出快照不覆盖手工编辑。
- build、thinking/notes/translation 测试通过；六格式、140组双语主题宽度/弹窗、17本原书/旧章节/批注/vocabulary.json 完整、实际 EPUB/PDF 与 open-url 定位、草稿语言切换、迟到/删除/清除通过；被动请求0，异步错误为空。手机为模拟，外部模型质量未用固定回复宣称。
- 源码 `804249d89e4810123865b9fa3f5a7db22d73d41d`、main 与注解标签1.2.0已推送，正式latest Release四附件公开HTTP200/逐字节/SHA-256/digest/三文件ZIP一致。ZIP SHA-256：`a48cb94c996ccae4655641b3138182f2a15ca85d819ca9fd06d0f5732480fcc0`。回执见 `.trellis/tasks/10-05-reader-thinking/verification.md`；隔离GUI与服务器退出。


## 会话 16：撤下思考线，汇总每书 Markdown 笔记，发布 1.2.1

**日期**：2026-10-05；**分支**：main；**状态**：已完成。

- 用户决定只保留摘抄、笔记汇总，跨书关系交给未来的本地 LLM。移除思考线视图、检索、关联建议及 MiniSearch；保留阅读/生词/主动解读。
- 每书沿用批注.md，收录纯划线、批注、已有整书想法、日期/作者/原书/定位，旧三问与记录折叠保留；笔记页展示实际文件，在当前标签页用原生编辑器自由记录。
- 使用 node-diff3 3.2.1 的三方合并，按独立笔记边界缩小范围；手工文字及同处新批注均保留。reading.json 保存基线/摘要/手工时间，串行回读与附属文件失败回滚，外部变化不覆盖，不逐页改文档。
- 旧思考 JSON 不改，普通归档保存判断、疑问、理由及来源版本，缺失来源明确显示，碰撞避让/重扫不覆盖；修正来源协议空格和原书特殊文件名编码。双语 README/文档与日期区分完成。
- build、documents/notes/translation 测试通过；原生隔离 Obsidian 验证编辑、合并、EPUB/PDF 协议、历史版本、归档/草稿、六格式和 112 组语言/主题/七宽度。17 本原书/历史/批注/vocabulary.json 完整，被动 AI 0、明确解读固定回复 1、异步错误为空。手机为视口模拟。
- 源码 `aa7622dc0c171b53b0275ee154cdfdddec973b66`、main 与注解标签 1.2.1 已推送；正式 latest Release 四附件公开 HTTP 200/字节/SHA-256/digest/三文件 ZIP 一致。ZIP SHA-256：`ec9521c84154b2ee63a4507efd9cdb71a50adeb48e2b76ee570ca3e2120b045b`。详情见 .trellis/tasks/10-05-book-documents/verification.md；隔离 GUI/服务器均退出。


## 会话 17：阅读页听书、正文跟随与简洁播放栏，发布 1.2.2

**日期**：2026-10-05；**分支**：main；**状态**：已完成。

- 用户要求在阅读页听书，朗读跟随原文，主用 Android 并必须在 Obsidian 内播放；进一步要求简洁播放界面。默认单行四项控制：播放/暂停、语速、声音设置、停止。控制栏预留独立空间，不覆盖正文；服务和声音藏在按需打开的二级设置。
- 桌面自动采用系统 SpeechSynthesis；不可用时使用 Bing 网页短句语音与 HTMLAudio，不需 API Key。参考 GTranslate 的公开协议，Edge 请求头和每次新 IG，401/403 刷新重试并校验真实 MP3；令牌仅内存保留，最多预取下一句，无持久音频缓存。
- 从当前可见位置按短句朗读，自动跨章节/页，临时标色不写入批注。EPUB 用 CFI 定位并在 resize/relocated 保留当前句子，PDF TextLayer 重绘恢复标色；旧阅读页销毁、停止、手动翻页和迟到请求均不会重启播放。保留每个 Window 单一播放器所有权。
- build 与 speech/translation/notes/documents 测试通过；原生隔离 Obsidian 实际系统播放、requestUrl 在线合成/解码、HTMLAudio 暂停续播、语速持久化、六格式及 56 组双语/主题/七宽度布局通过。17 本原书与旧个人内容完整，隔离 Obsidian 已退出。手机为桌面视口模拟，Android 尚无真机验收；首版不保证锁屏后台连续播放。
- 双语 README、规格和发布说明同步至 1.2.2。源码 `830f1c8c8b1d57729a0ec41ef007eebc1dfef7ba`、main 与注解标签 1.2.2 已原子推送；正式 latest Release 四附件公开 HTTP 200/字节/SHA-256/digest/精确三文件 ZIP 一致。ZIP SHA-256：`96f17a2a9c14c0b697ebfa441a6353d5a139ac4349acbbb1efc3f7bf80e9561d`。详情见 .trellis/tasks/10-05-reader-audio/verification.md。
