# 可复用阅读验收与性能基线

本轮用户选择暂不连接手机。流程已实现，不能把桌面窄屏、CDP Touch 或桌面声音结果称为 Android/iOS 真机结果。

## 固定输入与记录

使用独立测试 Vault、独立 Obsidian 配置与插件目录。复制样本到该目录，不覆盖用户原书、data.json、生词或笔记。记录手机型号、OS、Obsidian 与 QReader 版本、屏幕尺寸、书籍格式、文件大小、SHA-256、章节数、冷/热缓存、联网状态与运行次数。

样本至少包括短中文 EPUB、20 章文字 MOBI、长 EPUB/AZW3/FB2、图片较多 CBZ，以及有文字层/扫描型长 PDF。性能对照用同书、同 CFI/页码、同设备、同系统负载。每组至少 20 次；逐次保留原始数据，再报告 P50/P95。低样本只能作为单轮观察，不能称为 P95 基线。

## 可见行为

1. 第一页拖到第二页的 50% 并按住 1.5 秒：两页原地停留；短距离停留松手返回，越半页/快速划动完成。跨章、反向、双指与切书重复；选词和纵向滚动不误翻页。
2. 全文搜索中文、英文大小写、正则特殊字符、跨文字节点；定位第一/后一处，退出后返回原文字；搜索期间换书或取消，无迟到结果。扫描 PDF/CBZ 明确无可搜索文字。
3. PDF 50%/100%/300%、适合宽度/整页：画布、文字层、选区、批注重合。放大后双向平移，不误触翻页；缩放恢复仍在原段落，长 PDF 只渲染邻近页。
4. 字体导入、缺字、双页/单页、字号与屏幕旋转：CFI、选文起读、批注与返回原文稳定。小屏自动单页，设置六分类切页/重开/语言切换保存输入。
5. 听书过程中手动浏览、下一朗读页恢复跟随；断网/切书/停止不串音。主动上下文解释取消或删除词后不写回；原句保留不受动态淡化影响，导出不覆盖旧笔记。
6. 旧明文密钥迁移、回读失败、切换供应商、重开与旧 Obsidian 无接口回退；不得把密钥写入测试日志。转换缓存原文件变化/缓存损坏/实现版本变化/清除后重新生成，CFI 与批注不漂移。

## 时间、帧和内存

QReader 设置 → 缓存 → 性能记录 → 开始记录；完成一个明确流程后“停止并导出”。Vault 根目录得到 `QReader-性能-*.json`，只含环境、开书总耗时/书源准备耗时、原始样本及汇总、RAF 帧间隔，不含书名、正文和密钥。开书结束采样在实际挂载后两帧；无后台索引等待。记录开启会有少量采样开销，所有对照组保持同样设置。

每组进入书架并退出上本书再开书，确保释放内存中的 Book/PDF 源。冷缓存组清除阅读缓存后开始；热缓存组先完整打开并等待索引生成，再退出重开。清缓存只影响插件自有派生目录；不删原书与记录。分别记录第一次转换、热转换缓存、位置索引缓存，不能把已打开阅读器的原地刷新算作开书。

Android 在独立 Vault 中启动 Obsidian，明确选择 adb serial。运行：

```bash
adb devices -l
bash scripts/android-reader-metrics.sh <serial> start tmp/android-reader-<run>
# 手机完成一个聚焦流程，并导出 QReader 性能报告。
bash scripts/android-reader-metrics.sh <serial> finish tmp/android-reader-<run>
```

保留 `gfxinfo.txt`、`framestats.txt`、两份 meminfo、设备与版本及 QReader JSON。分析原始帧数、janky frames、frame percentiles、TOTAL PSS 与画布/图形内存；单次内存增长不等于泄漏。RAF 间隔不是合成器掉帧数，两者分别报告。深查卡顿使用 Perfetto 调度/帧轨迹；发行 Obsidian 非 debuggable/profileable 时不强行声称获得 Simpleperf CPU 样本。

iOS 使用同一隔离 Vault 和 QReader 本地 JSON；需要进一步帧/内存证据时用 Xcode Instruments 的真实设备轨迹。未采集的系统指标记录为不可用，不填写推测值。

桌面开发验收运行 `npm run build`、`npm run test:reader`、`npm run test:tools` 及 speech/translation/notes/documents。独立原生 Obsidian 回归六格式和七宽度，最终打包的 JS/CSS/manifest 与被测试插件逐字节一致。发布后核验公开附件 HTTP、大小、SHA-256 与 ZIP 内容。

Node.js 22+ 可复用原生验收：独立 Obsidian 以 `--user-data-dir=<独立配置目录> --remote-debugging-port=43113` 启动，启用 QReader、导入六格式样本并将窗口置于前台，然后运行：

```bash
npm run qa:reader -- --isolated-vault /absolute/path/to/test-vault --output tmp/reader-ui-report.json
```

脚本只连接本机端点，先核验实际 Vault 路径与前台可见性；测试首个健康样本的文字搜索、取消、返回、宽屏双页、PDF 缩放与平移。无文字书标记为无可搜索文字。测试后恢复设置、清除视口模拟；浏览产生的阅读进度和生词出现仍只作用于隔离目录。此脚本不是手机真机测试，手机半页停留和系统帧/内存仍按上述步骤单独采集。

设置专用回归使用相同隔离端点：`npm run qa:settings -- --isolated-vault /absolute/path/to/test-vault --output tmp/settings-ui-report.json`。中英 × 浅深 × 七宽度 × 宿主横向/纵向，共 56 组，检查卡片内容末尾的空白、控件高度、单页可见性、版本、草稿与键盘。移动/主题类应用于实际设置 ownerDocument，运行后恢复，不保存测试输入；另通过实际 GUI 原生设置入口检查桌面分页。不能只依赖主窗口视口模拟或零横向溢出推断手机布局正常。

方法参考 [Obsidian SecretStorage 官方指南](https://docs.obsidian.md/plugins/guides/secret-storage) 与 [android-performance 技能](/Users/luluen/.codex/plugins/cache/openai-curated-remote/test-android-apps/0.1.2/skills/android-performance/SKILL.md)。
