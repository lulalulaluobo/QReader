# 类型边界

启用 TypeScript strict。跨层契约定义在 src/types.ts；阅读引擎契约在 src/reader/engine.ts。外部 JSON、用户路径和 AI 响应从 unknown 开始，在入口校验。

禁止 any、as any、内联对象断言访问及以 ReturnType 代替具名协议。已知依赖使用静态 import；类型使用顶层 import type。仅库类型遗漏时允许注明原因的具名断言，例如原生设置控制器。

静态字符串表用 Record；运行时插入/删除的缓存和订阅用 Map/Set。不为单行表达式建立无意义包装函数。

示例：isHealthyBook(entry) 后才访问 entry.reading；validateLibraryPath 在剥离末尾斜杠前拒绝系统绝对路径及反斜杠。
