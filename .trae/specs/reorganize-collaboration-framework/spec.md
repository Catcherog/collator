# 协作机制重规划与文件结构整理 Spec

## Why

项目已有完整的 Trae 与 GPT 协作规范（`改造方案.txt`，21 节），但存在以下问题：
1. **文档体系分散**：`docs/` 根目录与 `docs/ai/` 存在两套文档，`docs/PROJECT_STATE.md` 已迁移但旧文件残留；`.docx`、`.zip` 等非代码文件散落在 `docs/` 根目录。
2. **临时脚本堆积**：`src/scripts/temp/` 下有 40+ 个临时脚本，无清理机制。
3. **规则文件重叠**：`.trae/rules/` 下有 `collator-handoff-audit.md`、`项目操作规则.md`、`_core.md` 等多个规则文件，与 `改造方案.txt` 和 `AGENTS.md` 内容部分重叠，优先级不清晰。
4. **缺少标准化提示词模板**：新窗口与 GPT 或 Trae 交互时缺少统一的上下文恢复提示词，导致任务衔接效率低。
5. **项目进度推进缺乏统一视图**：当前 Phase 2C 完成，但后续 Phase 2F/3/5/6 的推进计划分散在多个文档中。

## What Changes

### 1. 项目进度确认与推进计划
- 确认 `改造方案.txt` 为最新版本的项目总体框架文档（v1.0，21 节完整规范）
- 对比 `改造方案.txt` 与 `AGENTS.md`、`docs/ai/` 下各文档，消除不一致
- 基于 Phase 2C 完成状态，制定 Phase 2F → Phase 3 → Phase 5 → Phase 6 的统一推进路线图
- 在 `docs/ai/PROJECT_STATE.md` 中补充后续 Phase 的里程碑与依赖关系

### 2. 项目文件结构整理
- **清理 `docs/` 根目录**：将 `.docx` 文件移至 `docs/business-docs/`，将 `.zip` 归档到 `docs/archive/`，删除已迁移的 `docs/PROJECT_STATE.md` 重定向文件
- **清理临时脚本**：审查 `src/scripts/temp/` 下所有脚本，删除过期脚本，保留有用的迁移至 `src/scripts/`
- **统一文档体系**：所有 AI 协作文档统一到 `docs/ai/` 下，消除 `docs/` 与 `docs/ai/` 的重复
- **归类 `.trae/documents/`**：将规划文档按类型归入 `docs/ai/plans/` 或对应 Phase 目录

### 3. 协作规则制定与优化
- **确立文档优先级**：明确 `改造方案.txt` > `AGENTS.md` > `docs/ai/*.md` > `.trae/rules/*.md` 的优先级链
- **消除规则重叠**：梳理 `.trae/rules/` 下规则文件，将 `collator-handoff-audit.md` 和 `项目操作规则.md` 中与 `改造方案.txt` 重复的内容精简，保留项目特有规则
- **设计标准化提示词模板**：创建 `docs/ai/PROMPT_TEMPLATES.md`，包含：
  - GPT 新窗口启动提示词（读取 GitHub 上下文 + 输出任务包）
  - Trae 新窗口启动提示词（读取 AGENTS.md + 恢复上下文）
  - 任务交接提示词（GPT→Trae 任务包传递）
  - 审查请求提示词（Trae→GPT PR 审查）
  - 状态同步提示词（跨窗口状态对齐）
- **明确信息同步频率**：定义每种协作场景的信息同步时机和内容

### 4. 权限与操作规范
- **明确权限边界**：在 `AGENTS.md` 中强化 GPT（只读 GitHub）与 Trae（读写 GitHub + 本地文件）的权限声明
- **文件操作规范**：在 `docs/ai/FILE_OPS_POLICY.md` 中定义修改前备份、版本控制、变更记录要求
- **安全操作准则**：在 `docs/ai/SECURITY_POLICY.md` 中定义防止误操作的检查清单

## Impact

- **Affected specs**: 无现有 spec 直接受影响（本 spec 为协作框架层面的变更）
- **Affected code**: 
  - `AGENTS.md` - 更新入口文件
  - `docs/ai/PROJECT_STATE.md` - 补充推进路线图
  - `docs/ai/TRAE_COLLABORATION_GUIDE.md` - 对齐改造方案
  - `.trae/rules/项目操作规则.md` - 精简去重
  - `.trae/rules/collator-handoff-audit.md` - 精简去重
  - 新增 `docs/ai/PROMPT_TEMPLATES.md`、`docs/ai/FILE_OPS_POLICY.md`、`docs/ai/SECURITY_POLICY.md`
  - 文件移动/删除涉及 `docs/` 根目录、`src/scripts/temp/`、`.trae/documents/`

## ADDED Requirements

### Requirement: 标准化提示词模板
系统 SHALL 提供标准化的提示词模板，确保任何时间点新开窗口与 GPT 或 Trae 交互时都能实现任务的无缝衔接。

#### Scenario: GPT 新窗口启动
- **WHEN** 用户在 GPT 中新开窗口并粘贴 GPT 启动提示词
- **THEN** GPT 能根据提示词读取 GitHub 仓库上下文，理解项目当前阶段，并输出标准化任务包或审查结论

#### Scenario: Trae 新窗口启动
- **WHEN** 用户在 Trae 中新开窗口并粘贴 Trae 启动提示词
- **THEN** Trae 能根据提示词读取 AGENTS.md 及其引用文件，恢复完整项目上下文，确认 Git 状态

#### Scenario: 跨窗口任务交接
- **WHEN** GPT 输出任务包后用户切换到 Trae 窗口
- **THEN** 用户使用任务交接提示词，Trae 能正确解析任务包并开始仓库一致性检查

### Requirement: 统一推进路线图
系统 SHALL 在 `docs/ai/PROJECT_STATE.md` 中维护从当前阶段到项目完成的统一推进路线图。

#### Scenario: 查看项目推进计划
- **WHEN** GPT 或 Trae 读取 PROJECT_STATE.md
- **THEN** 能清晰看到当前阶段、已完成阶段、后续各 Phase 的里程碑、依赖关系和阻塞项

### Requirement: 文件操作安全规范
系统 SHALL 提供文件操作安全规范，防止误操作导致的数据丢失或代码损坏。

#### Scenario: 修改前备份
- **WHEN** Trae 需要修改关键配置文件或核心代码
- **THEN** 按规范执行 Git stash 或创建备份分支，确保可回滚

#### Scenario: 变更记录
- **WHEN** Trae 完成文件修改
- **THEN** 在对应任务文件和 PROJECT_STATE.md 中记录变更内容、原因和影响范围

## MODIFIED Requirements

### Requirement: AGENTS.md 入口文件
AGENTS.md 作为项目入口文件，SHALL 明确引用 `改造方案.txt` 作为协作规范的上游来源，并保持与之一致。同时 SHALL 明确文档优先级链：`改造方案.txt` > `AGENTS.md` > `docs/ai/*.md` > `.trae/rules/*.md`。

### Requirement: 项目操作规则
`.trae/rules/项目操作规则.md` SHALL 精简为仅包含项目特有规则（飞书操作、文件映射、Skill 选择），去除与 `改造方案.txt` 重复的通用协作规则。

### Requirement: 跨窗口交付审计规则
`.trae/rules/collator-handoff-audit.md` SHALL 精简为仅包含 Phase 验收审计的输出格式约束，去除与 `改造方案.txt` 重复的角色定义和事实来源声明。

## REMOVED Requirements

### Requirement: docs/ 根目录散落文档
**Reason**: `docs/` 根目录混放 `.docx`、`.zip`、`.md` 文件，不符合文件管理规范
**Migration**: `.docx` 移至 `docs/business-docs/`，`.zip` 移至 `docs/archive/`，已迁移的 `.md` 重定向文件删除

### Requirement: 过期临时脚本
**Reason**: `src/scripts/temp/` 下大量临时脚本已完成用途，堆积影响项目整洁
**Migration**: 审查后删除过期脚本，有用脚本迁移至 `src/scripts/` 并移除 TEMP 标记
