# 页面组件

## 现有模式

src/views/reader.ts 的 ReaderView 继承 ItemView，在 onOpen 建立 DOM，在 onClose 释放订阅与引擎。src/util.ts 的 el 负责创建元素，用户或 AI 文本使用 textContent/setText，不插入不可信 HTML。

## 视觉约束

白色/宿主主题背景、宽松留白、弱分隔、灰紫色主按钮；划线固定浅黄。书架使用纵向书目列表，继续阅读单独置顶。沿用宿主字体、原生图标、Menu 与 Modal。底部入口只有书架、复习、设置，不增加统计。

## 交互与无障碍

图标按钮必须有可访问名称，表单必须有标签或 aria-label。点击区至少 44px；键盘焦点清晰，窄面板不横向溢出。状态完整：空、加载、失败、重试、禁用。没有数据时不显示假封面或假进度。
