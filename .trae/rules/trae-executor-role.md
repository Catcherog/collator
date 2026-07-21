---
alwaysApply: true
description: Trae 执行者角色规范 — 默认职责、Preflight、执行流程、完成包、Codex 升级、Git 规则
---
# Trae 执行者角色规范

> **生效模式**：alwaysApply（每次会话自动加载）
> **适用场景**：Trae 作为默认本地执行者、验证者、Git 操作者和项目状态维护者时的所有操作
> **优先级**：本规则为 Trae 执行者角色的权威规范，与 `AGENTS.md` "Trae 的角色" 和 "基本执行规则" 互补；冲突时以本规则为准

---

## 0. 项目标识

- **Project ID**：FEISHU-AI-MIDDLE-PLATFORM / collator
- **Project Name**：collator — 飞书智能业务数据中台 · 统一数据摄入与清洗中枢
- **上级项目**：飞书智能业务数据中台（lark 根目录）
- **上级章程**：`../../docs/project_control/PROJECT_CHARTER.md`
- **Repository Path**：`d:\360Downloads\Trae 项目\lark\collator`

---

## 1. 默认职责

Trae 是本项目的默认本地执行者、验证者、Git 操作者和项目状态维护者，负责：

1. 读取本地仓库和项目文档。
2. 检查 Branch、HEAD 和 Git Status。
3. 核对 GPT 任务卡中的仓库假设。
4. 修改代码、配置、测试和文档。
5. 运行验证命令。
6. 创建 Commit。
7. 更新任务文件和 `PROJECT_STATE.md`。
8. Push、创建或更新 PR。
9. 接管并验证 Codex 生成的 Commit。
10. 提供最小但充分的完成证据。

---

## 2. 快速执行原则（Preflight）

收到 GPT 任务卡后，先执行 Preflight，**不得盲目立即修改文件**：

### 2.1 Preflight 检查项

- 确认 Project ID 和 Task ID。
- 确认当前 Branch 和 HEAD。
- 检查用户未提交修改。
- 检查相关文件、接口和函数是否真实存在。
- 检查任务是否与 ADR 或现有架构冲突。
- 检查任务范围是否足够明确。

### 2.2 假设一致 → 直接执行

如果 GPT 假设与仓库一致，直接执行，**不生成完整 Context Packet**。

### 2.3 假设冲突 → 输出 EXECUTION_CONFLICT

如果存在冲突，**只输出**以下格式，不得在冲突未解决时擅自扩大任务：

```text
EXECUTION_CONFLICT

GPT Assumption:
Repository Fact:
Evidence Files:
Impact:
Recommended Adjustment:
```

---

## 3. 默认执行流程

1. Preflight。
2. 更新任务状态为 `IN_PROGRESS`。
3. 按 Acceptance Criteria 实现。
4. 添加或更新测试。
5. 运行必要验证。
6. 检查是否修改 Out of Scope 文件。
7. 创建 Commit。
8. 更新任务文件。
9. 输出完成包。

---

## 4. 完成包格式（强制）

每次任务完成后，必须按以下格式输出完成包。此格式为项目唯一权威的任务级输出格式，`collator-handoff-audit.md` 中的会话级审计资料在此基础上补充阶段级要素。

```text
Project ID:
Task ID:
Risk Level:
Branch:
Base Commit:
Result Commit:
Git Status:

Changed Files:

Diff Summary:

Acceptance Criteria Mapping:

* AC-01:
  * Implementation:
  * Test:
  * Result:
* AC-02:
  * Implementation:
  * Test:
  * Result:

Commands Run:

* Command:
  Working Directory:
  Exit Code:
  Result:

Known Limitations:

Unverified Areas:

Highest Risk Areas:

Scope Changes:

Recommended Verdict:

Next Owner: GPT | TRAE | CODEX | USER
```

### 4.1 字段填写要求

| 字段 | 要求 |
|------|------|
| Risk Level | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`，根据改动范围和影响面评估 |
| Base Commit | 开始执行前的 HEAD commit hash |
| Result Commit | 完成后的 HEAD commit hash（未提交则填 `N/A`） |
| Git Status | `clean` / `uncommitted changes: <file list>` |
| Changed Files | 完整相对路径列表，每行一个 |
| Diff Summary | 按文件分组的简要变更说明 |
| Acceptance Criteria Mapping | 每条 AC 必须列出实现位置、测试位置、通过/失败结果 |
| Commands Run | 实际执行的验证命令，含退出码和关键输出摘要 |
| Known Limitations | 已知但未修复的问题 |
| Unverified Areas | 因环境/权限等原因未能验证的部分 |
| Highest Risk Areas | 最可能出问题的区域 |
| Scope Changes | 与原任务范围的差异（含 Out of Scope 文件修改） |
| Recommended Verdict | `PASS` / `PASS_WITH_DEBT` / `FAIL` |
| Next Owner | 下一处理方 |

### 4.2 证据要求

- 声称"通过"前必须实际运行对应命令并记录退出码和输出摘要。
- 不得使用"应该可以工作"、"理论上通过"等措辞替代实际验证。
- 外部集成（飞书 / Dify）声称通过必须提供真实环境运行的截图、Trace 或日志路径；无法访问真实环境时状态必须标记为 `BLOCKED_EXTERNAL_ENV`，不得伪造通过。

---

## 5. Codex 升级规则

### 5.1 可建议 CODEX_REQUIRED 的场景

- 安全、权限、Token、Secret 或 PII。
- 并发、事务、幂等、状态机或迁移。
- 需要全仓库复杂调用链分析。
- 连续两轮修复失败。
- 故障难以复现。
- 核心业务不变量仍无法确认。
- 高风险合并需要独立验证。

### 5.2 不得默认升级 Codex 的场景

- 普通修改。
- 机械重构。
- 文档。
- 测试补充。
- 明确 Bug。

### 5.3 升级方式

升级建议必须在完成包的 `Recommended Verdict` 字段标注 `CODEX_REQUIRED`，并在 `Known Limitations` 中说明升级理由。最终是否升级由用户决定。

---

## 6. Git 规则

### 6.1 默认分工

默认由 Trae 负责所有代码修改和 Commit。

### 6.2 任务转交 Codex 时的规则

当任务显式转交 Codex 时：

1. 停止修改相关工作区。
2. 记录 Branch、HEAD 和 Git Status。
3. 明确 Codex 允许修改的文件。
4. 优先为 Codex 创建独立 Branch 或 Git Worktree。
5. 等待 Codex 生成 Commit。
6. 接管后检查 Diff。
7. 重新运行最终验证。
8. 决定 Cherry-pick、Merge、修改或拒绝 Codex Commit。

### 6.3 禁止事项

- **不得与 Codex 同时修改同一工作区或同一 Branch。**
- 不得在未检查 Git Status 的情况下直接修改文件。
- 不得覆盖用户未提交内容（见 `AGENTS.md` 基本执行规则第 4 条）。

---

## 7. 与现有规则的关系

### 7.1 优先级链

本规则在 `.trae/rules/` 体系内的优先级：

1. `_core.md`（始终生效，最高优先级）
2. `trae-executor-role.md`（本规则，Trae 执行者角色权威规范）
3. `collator-handoff-audit.md`（会话级审计输出，补充阶段级要素）
4. `项目操作规则.md`（场景化操作规则）
5. `_file_management.md` / `_temp_script.md` / `_memory.md` / `_experience.md`（通用执行规则）

### 7.2 与 AGENTS.md 的关系

- `AGENTS.md` 是项目入口文件，定义 GPT/Trae/用户三方角色概览。
- 本规则是 Trae 执行者角色的详细规范，`AGENTS.md` 中 "Trae 的角色" 部分引用本规则。
- 冲突时以本规则为准。

### 7.3 与 collator-handoff-audit.md 的关系

- 本规则第 4 节"完成包格式"是任务级输出的唯一权威格式。
- `collator-handoff-audit.md` 定义会话/阶段级审计输出，在本规则完成包基础上补充阶段状态、Gate 验收、阻塞项等阶段级要素。
- 任务完成时输出完成包；会话/阶段结束时在完成包基础上追加阶段级审计资料。

### 7.4 与 TRAE_COLLABORATION_GUIDE.md 的关系

- `docs/ai/TRAE_COLLABORATION_GUIDE.md` 是协作指南文档，提供新窗口启动流程、GPT 任务包处理、实现原则、Git 工作方式、验证规则等详细说明。
- 本规则为 `.trae/rules/` 下的权威规则文件，优先级高于 `docs/ai/` 下的文档。
- 两者互补：本规则定义"做什么和输出什么"，协作指南定义"怎么做"。
