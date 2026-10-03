# 项目开发流程

Trellis 是项目任务、规范、决策与长期经验的唯一载体。入口为 PRD.md、CLAUDE.md。

## 阶段状态

[workflow-state:no_task]
先读取 PRD.md 与相关规范。明确需求、修改范围和验收场景；复杂功能建立任务，简单修改直接处理。
[/workflow-state:no_task]

[workflow-state:planning]
将中文需求与验收标准写入任务 prd.md；为 implement.jsonl/check.jsonl 添加真实存在的规范路径。只询问工具和代码无法解答的产品取舍。完成规划后启动任务。
[/workflow-state:planning]

[workflow-state:planning-inline]
主会话读取相关规范，记录接口与验收标准，完成规划后启动任务。
[/workflow-state:planning-inline]

[workflow-state:in_progress]
先读现有实现，复用既有模式。跨层接口统一由集成负责人维护；只拆分独立、足够大的工作面。并行修改阶段不重复运行构建。完成集成后统一构建，并在真实 Obsidian 中运行受影响流程。记录证据与限制，更新规范及任务状态。提交信息使用中文；仅在用户要求时推送，禁止强制覆盖远程历史。
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
主会话按已确认范围修改；完成后统一构建和真实插件烟雾验收，更新中文任务与规范，再按用户授权提交及推送。
[/workflow-state:in_progress-inline]

[workflow-state:completed]
保存实际验收证据，归档任务并更新工作日志。不得把构建成功写成全部运行场景已验证。
[/workflow-state:completed]

## 常用命令

```sh
python3 .trellis/scripts/get_context.py
python3 .trellis/scripts/task.py create "中文任务标题" --slug qreader-v1
python3 .trellis/scripts/task.py start <任务目录>
python3 .trellis/scripts/task.py validate <任务目录>
python3 .trellis/scripts/task.py finish
python3 .trellis/scripts/task.py archive <任务目录>
npm run build
```

任务会话身份由运行环境提供；无会话身份时显式设置 TRELLIS_CONTEXT_ID，不能宣称启动成功。

## 持久化与验收

源码不得使用临时适配器伪造 Obsidian 行为。损坏记录暂停写入，恢复必须显式选择。API 密钥和阅读资料不提交。运行截图与临时验收资料置于被忽略的 tmp/；用户文件不得为测试而修改。正式修复完成后更新 README 与相关规范。
