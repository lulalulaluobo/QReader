# QReader 1.1.3 验收与发布记录

## 环境与隔离

- macOS Obsidian 1.13.7；仅复用 tmp/release-112-smoke 的独立应用配置、Vault、兼容协议服务与样书，不写用户正在使用的库或配置。
- 手机尺寸为真实 Obsidian 窄窗口加移动 CSS/原生指针事件模拟，没有 Android/iOS 真机。AI 解读使用本地 OpenAI-compatible 端点，没有验证真实供应商模型效果。
- 生产 npm run build（TypeScript 与 esbuild）通过；git diff --check 通过。运行 error/unhandledrejection 收集为空。

## 用户可见行为

- 16 本样书每页只绘制四卡，两列两行；底部上一页/下一页、最后一页禁用、越界页码夹取正常。搜索/分类重置第一页，进入阅读再原生回退恢复第二页。
- 单本搜索隐藏翻页；封面图片比例与原图一致、底板透明，没有横向矮灰框；实际 393×864 模拟封面高约 144px。继续阅读、原书封面、书籍菜单、已读与学科分类保留。
- 320/375/393/414/768/1024/1440px、浅深色共 14 组书架检查：四卡完整显示、图片比例准确、无横向溢出；另验 375×667 的四卡完整显示。极窄容器翻页位于导航第二行，避免缩小 44px 点击区。
- 选文主排始终五个 44px 图标，无可见文字；复制 copy、AI sparkles、色圈、批注 square-pen、关闭 x/已有标记 more-horizontal。14 组宽度/主题检查均为单行、位于正文根节点内、无横向溢出。
- 真实复制结果与原始选文一致；图标解读能打开兼容服务结果，批注保存/编辑有效。已有标记的单行二级菜单用 trash-2/eraser/x；含批注删除第一次保留记录、再次确认才删除，取消确认不变；取消批注保留纯划线。
- 原生指针长按 550ms（阈值 450ms）松手不保存；五色选择不保存；下一次短按保存。已有标记改色不重复创建；方向下键展开、Escape 关闭色板并返回焦点；关闭菜单不保存候选颜色。
- EPUB/PDF 颜色重开及实际色块保持一致。EPUB SVG stroke=none、stroke-width=0、fill-opacity=0.28；PDF 无 border/底边 box-shadow，保留 28% 半透明色块。浅色/米色/豆绿/深色正文的图标菜单仍有主题背景、边框和阴影。
- FB2/MOBI/AZW3 在实际正文选择文字、保存与重开高亮，无描边且透明度 0.28。AZW3 第一节是封面，补充检查明确导航 CHAPTER I 正文，避免把封面误作无文字引擎故障。
- 转换格式高亮操作前后，16 本独立样书原文件 SHA-256 完全一致。未修改阅读记录结构、题目/回答/复习逻辑。

## 复现文件（本地忽略，不纳入插件）

- tmp/release-112-smoke/layout-113-test.mjs：四卡、比例、翻页/筛选/历史与宽度。
- tmp/release-112-smoke/toolbar-113-test.mjs：图标、复制/解读/批注、指针/键盘、二级菜单与删除。
- tmp/release-112-smoke/persistence-113-test.mjs：EPUB/PDF 重开、无描边、删除两次确认、四种阅读背景。
- tmp/release-112-smoke/converted-113-test.mjs：转换文字格式高亮及原书哈希。
- 截图：bookshelf-113-light.png、bookshelf-113-dark.png、toolbar-113.png、toolbar-113-palette.png、highlight-113-borderless.png。

## 安装产物

package.json、package-lock.json 两处与 manifest.json 均为 1.1.3。ZIP 仅含 qreader/ 下三个安装文件，与单独文件逐字节一致。

| 文件 | SHA-256 |
| --- | --- |
| main.js | `54c3b67a8aa1a15285bc11dc47d983762ecc62943c696043919ecf962bc93e7c` |
| manifest.json | `6c64ddf2c90e9d8027819adfd252612b29272c473b583cd0d19b2579cffdebaf` |
| styles.css | `6f92ba14361a247efafe9300608ccbe44ec9d9f8c48bd4d6aed4fdc4c00b700c` |
| QReader-1.1.3.zip | `6b53573c16c526edcfb668afe8ec59bad07bb33f468cec5175d59add2977fd65` |

## 发布

待推送 main/1.1.3 并发布正式 latest Release，随后验证公开下载与上述实测产物逐字节一致。
