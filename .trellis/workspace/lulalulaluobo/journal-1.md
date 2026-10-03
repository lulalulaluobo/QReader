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
| `b402b9551235b3eb375891090d19384f9b4cec92` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
