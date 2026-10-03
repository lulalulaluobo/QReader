# 项目需求总览 (PRD)

> 本文档只维护项目级目标、边界和里程碑。详细任务、决策、进度与工程规范统一由 Trellis 管理。

## 1. 项目背景与目标
QReader 是 Obsidian 内的问题驱动阅读插件：先提问，再阅读，再回答，再回想。
以主动回忆替代单纯划线；阅读资料、个人理解和历史答案归用户的 Vault 所有。


## 2. 核心用户与使用场景
使用桌面与移动端 Obsidian 阅读 EPUB、PDF、FB2、MOBI、AZW3 与 CBZ 的知识型读者。先提问再阅读、写下理解并按需复习；CBZ 只提供图片阅读，不假造文字。
阅读资料、个人理解和历史答案归用户的 Vault 所有。


## 3. 功能范围
- 书架：真实封面卡片网格与两行书名，紧凑搜索、六格式导入、继续阅读及书籍管理；保留原有菜单和底部导航。
- 阅读：默认仅显示正文，轻点屏幕中央显示/隐藏上下工具栏；左右翻页/上下滚动、目录、章节导航、主题与字号、位置恢复、本章三问。
- 选文：显示「划线 / 批注 / 复制 / AI 解读」菜单；复制原始选区文字，独立 AI 解读使用底部弹窗，仅明确「存入笔记」后持久化。
- 批注：精确原文位置、浅黄划线、我的理解、按需 AI 解释、编辑及 Markdown 导出；笔记面板删除需确认并同步 JSON、Markdown 和高亮；「取消批注」保留同一划线及定位，「取消画线」删除整条标记。
- 回答：本章三问使用底部面板，点任意题直接进入该题与对应版本的闭卷回答；允许先答第三题，三题全部完成后统一提交并给极简反馈，保留旧题目与答案历史。
- 复习：待复习与全部章节只列正文，过滤封面、扉页、目录、序及其他前后辅文，但不删除这些章节的旧问题、回答、复习与批注；作答前不显示原文、旧答案或反馈，完成后比较完整历史答案。
- AI 仅三场景：章节三问、所选文本解释、三问回答反馈；自定义 OpenAI 兼容接口，另有 DeepSeek/Agnes 只填各自 API Key 的预设。


## 4. 非目标与业务边界
不提供通用 AI 聊天、分数、理解等级、排行榜、统计仪表板或固定间隔复习方案。
原型仅约束四页层级、留白、灰紫按钮与移动端视觉；不实现图中的统计入口、固定 7/30 天复习。


## 5. 技术约束与质量标准
- TypeScript、Obsidian API、epub.js、PDF.js；可安装产物为 main.js、manifest.json、styles.css。
- 每本书目录保存原文件、reading.json 和批注.md；封面为插件内部缓存，不生成 cover.jpg。
- reading.json 是版本化事实源；串行写入、写后校验、保留恢复副本；损坏时停止写入并显式恢复。
- 重新生成三问不得破坏已作答问题版本；反馈须绑定具体提交。
- EPUB 与重排的 FB2/MOBI/AZW3 均保存 CFI 定位；PDF 保存页码及页内位置，CBZ 保存图片页位置。重开或切换排版需恢复原位置与批注。
- 引用按章节及原文顺序输出；不按批注创建时间伪装阅读顺序。
- 纯划线仅保存于 reading.json，不计入批注数量或导出批注.md；旧记录缺少标记类型时仍视为批注，保留原 ID、定位与历史。
- 所有界面适配窄 Obsidian 面板与移动端，复用宿主字体、主题及无障碍导航。
- AI 发往用户配置的兼容接口：首次进入章节后台生成三问，按操作解释选段或反馈回答；仅发送相关章节/选段/答案。密钥保存在插件 data.json 中，未加密，不进入 Git。


## 6. 里程碑
1. 初始化入口、Git 与中文 Trellis 规范。
2. 完成阅读引擎、可靠存储和四页面交互。
3. 构建并通过实际 Obsidian 六格式阅读、阅读记录与回忆闭环验收。
4. 提交中文 Git 记录，推送 main，并发布 GitHub Release 1.1.1 与 BRAT 安装文件。

## 7. 交付与验收
- 从源码执行 `npm ci`、`npm run build`；解压 `dist/QReader-1.1.1.zip` 的 `qreader/` 目录到 Vault 的 `.obsidian/plugins/`，得到 `.obsidian/plugins/qreader/{main.js,manifest.json,styles.css}` 后启用插件。源码分支忽略生成的 `main.js`。
- 1.1.0 将阅读扩展为 EPUB、PDF、FB2、MOBI、AZW3、CBZ。未加密 MOBI/AZW3、独立 FB2 与 ZIP FB2 在内存组装为 EPUB 视图，阅读库仍保存原始文件字节和实际格式；CBZ 自然页序只提供图片阅读与页码位置。
- 独立 Obsidian 1.12.4 Vault 实测六类原书导入/读取/重开，额外覆盖 `.fb2.zip` 导入别名；FB2/MOBI/AZW3 精确 CFI 批注可跳回原文。既有 EPUB/PDF 的 CFI、页内比例、划线、批注、题目版本、回答、复习与反馈保存重启后保持不变。
- 1.1.1 在 macOS Obsidian 1.12.4 独立 Vault 验证原生选文滚动扰动恢复、复制、笔记删除同步、AI 解读失败重试与关闭迟到结果、任意题直达、问题版本切换和反馈重试。隐藏阅读页返回、退出重开及阅读模式切换保持 CFI。
- 320/375/414/768/1024/1280/1440px 的浅深色书架、三问/AI 底部弹窗和回答页零横向溢出；三问焦点循环可用。视口模拟均为 macOS Obsidian，不代表 Android/iOS 真机。
- AI 预设使用官方核实的 `deepseek-flash` / `https://api.deepseek.com` 和 `agnes-2.5-flash` / `https://apihub.agnes-ai.com/v1`；本地 OpenAI-compatible 协议服务通过实际 UI 探针、三问、批注解释与回答反馈流程。无供应商密钥；未验证外部联网或模型效果。密钥仅保存在插件 `data.json`，未加密。
- 克隆调研参考 `joeseesun/qiaomu-reader` commit `cff28ba6`（GPL-3.0-only），未复制其插件代码：`src/reader-engine.js` 说明 Foliate.js 的 EPUB/MOBI/AZW3/FB2（独立/压缩）/CBZ 与独立 PDF 路径；`src/main.js` 展示扩展名路由；`src/status-bar.js` 与 `src/styles.css` 展示跟随活动阅读视图、卸载清理的宿主导航控制；`src/epub-zip.js` 记录无 UTF-8 ZIP 标志时的中文路径兼容问题。QReader 自行采用 EPUB.js/PDF.js 双引擎和 MIT 格式适配；依赖 Foliate.js 1.0.1、fflate 0.8.2，保留上游许可证声明。
- 验收用的独立 Obsidian 为 1.12.4 与 1.13.7；OS 为 macOS。Android/iOS 真机、加密/DRM 书籍、真实供应商密钥均未测试，不宣称受支持。
- GitHub Release 1.1.0 已发布并设为 latest，包含 BRAT 所需 `main.js`、`manifest.json`、`styles.css` 与手动安装包 `QReader-1.1.0.zip`。
- 1.1.1 已完成构建、隔离验收与 ZIP 打包，远程发布待完成；长中文书名的封面缓存已改为 SHA-256 文件名，避免文件名过长。
- 历史 GitHub Release 1.0.1 仍可通过 [GitHub 仓库](https://github.com/lulalulaluobo/QReader/releases/tag/1.0.1) 安装；生成的生产 `main.js` 不纳入源码分支。
