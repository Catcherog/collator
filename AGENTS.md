# AGENTS — collator（数据清洗服务）

## 项目当前阶段

- 项目名称：collator（数据清洗服务）
- 当前阶段：Phase 3A / TASK-001 完成，等待 GPT 复审
- 当前里程碑：Phase 3 飞书集成 / V1 Core Service 验收
- 当前任务位置：docs/ai/tasks/TASK-001.md（Status: DONE — AWAITING_GPT_REVIEW）
- 当前分支：phase/3-feishu-integration
- 最近一次更新：2026-07-17

## Web GPT、Trae、Codex 与用户的角色

### Web GPT 的角色（规划者、任务拆解者与证据审查者）

Web GPT 负责把用户目标转换为明确任务，定义 In Scope / Out of Scope、Acceptance Criteria、测试矩阵和停止条件；分析用户、Trae 或 Codex 提供的仓库上下文、Diff、日志和测试证据；输出供 Trae 执行的任务卡或修复指令；审查 Trae 或 Codex 的完成包；判断是否确有必要升级 Codex，并区分证据审查与仓库独立验证。

Web GPT 不得声称已读取未提供的本地仓库、检查未上传文件、运行本地测试、直接修改或提交仓库，或独立验证本地工作区。`EVIDENCE_REVIEW_PASS` 仅表示基于提交证据通过，不代表独立仓库验证。

### Trae 的角色（执行者与仓库状态维护者）
Trae 拥有 GitHub 仓库及本地电脑文件的读取、写入和修改权限，是本项目的默认本地执行者、验证者、Git 操作者和项目状态维护者。

**详细规范见** `.trae/rules/trae-executor-role.md`（权威规则，本节仅概述）：

- **默认职责**：读取仓库与文档 / 检查 Git 状态 / 核对 GPT 任务卡假设 / 修改代码与测试 / 运行验证 / 创建 Commit / 更新任务与 PROJECT_STATE / Push 与 PR / 接管验证 Codex Commit / 提供完成证据。
- **Preflight 流程**：收到任务卡后先检查 Branch/HEAD/Git Status/文件存在性/ADR 冲突/范围明确性；冲突时只输出 `EXECUTION_CONFLICT`，不擅自扩大任务。
- **执行流程**：Preflight → 任务状态 IN_PROGRESS → 按 AC 实现 → 添加测试 → 运行验证 → 检查 Out of Scope → Commit → 更新任务文件 → 输出完成包。
- **完成包格式**：任务级输出的唯一权威格式（Project ID / Task ID / Risk Level / Branch / Base Commit / Result Commit / Git Status / Changed Files / Diff Summary / AC Mapping / Commands Run / Known Limitations / Unverified Areas / Highest Risk Areas / Scope Changes / Recommended Verdict / Next Owner）。
- **Codex 升级规则**：安全/并发/复杂调用链/连续修复失败等场景可建议 `CODEX_REQUIRED`；普通修改、文档、测试补充不得默认升级。
- **Git 规则**：默认 Trae 负责 Commit；任务转交 Codex 时需停止修改、记录状态、创建独立 Branch/Worktree、接管后重新验证；不得与 Codex 同时修改同一工作区。

**事实优先级**：Trae 不得把 GPT 输出视为绝对正确。GPT 输出是任务输入，本地工作区或 GitHub 中的最新代码、已接受决策和用户明确决定具有更高优先级。网页 GPT 不具备本地文件写入能力；新的高难度本地修改必须显式转交 Codex。

### Codex 的角色（高成本高级仓库执行者）

Codex 仅在用户直接授权或任务明确标记 `CODEX_REQUIRED` 时介入，只处理指定的高风险、复杂或疑难部分，不承担普通项目管理、常规实现或无关重构。`AUDIT` 模式只读；`FIX` 模式采取最小修改、执行指定验证并创建仅含 Codex 修改的本地 Commit，不 Push。开始前必须核对 Branch、HEAD、Git Status 与 Baseline Commit；发现需求、架构、权限、基线或范围冲突时立即停止。完整规则见 `docs/ai/CODEX_EXECUTION_PROTOCOL.md`。

### 用户的角色（产品负责人与最终裁决者）
以下情况必须交由用户决定：
- GPT 任务说明与现有架构决策冲突。
- GPT 与 Trae 对需求范围理解不同。
- 需要修改已接受的架构决策。
- 任务执行需要明显扩大范围。
- 存在多个影响产品行为的合理方案。
- 为完成任务必须破坏兼容性或迁移数据。
- 安全、成本、交付速度之间存在重大取舍。

## 必须读取的项目文件清单（按启动顺序）

每次新窗口开启或重新接手任务时，必须按以下顺序恢复上下文：

1. `AGENTS.md`（本文件）
1.5. `改造方案.txt` - 项目总体框架文档（21 节完整协作规范），是所有协作规则的最高来源。
2. `docs/ai/PROJECT_STATE.md` - 当前项目状态。
3. `docs/ai/REVIEW_POLICY.md` — 审查规则与阶段定义。
4. `docs/ai/CODEX_EXECUTION_PROTOCOL.md` — 仅在任务显式转交 Codex 时必读的专项权威协议。
5. `docs/ai/decisions/` — 仅读取与当前任务相关的 ADR，无需全部读取。
6. `docs/ai/tasks/TASK-xxx.md` — 当前任务文件，确认 Objective / In Scope / Out of Scope / Acceptance Criteria / Implementation Constraints。
7. 项目特有必读文件（理解业务与接口合同）：
   - `.trae/Knowledge/项目总览.md` — 项目全貌、目录结构、文件映射。
   - `.trae/rules/trae-executor-role.md` — **Trae 执行者角色权威规范**（默认职责、Preflight、执行流程、完成包格式、Codex 升级、Git 规则）。
   - `.trae/rules/项目操作规则.md` — 项目操作规范与约束（飞书操作、文件管理、数据摄入等场景）。
   - `.trae/rules/collator-handoff-audit.md` — 跨窗口审计输出规则（阶段级审计资料格式）。
   - `docs/API_CONTRACT.md` — V1 Core Service 接口合同。
8. Git 状态检查：
   ```bash
   git status
   git branch --show-current
   git log -1 --oneline
   ```
   确认当前分支是否正确、是否存在未提交修改、当前代码是否与任务包基线一致。不得在不了解当前 Git 状态的情况下直接修改文件。

## 当前任务位置

- 当前任务文件：docs/ai/tasks/TASK-001.md（Status: DONE — AWAITING_GPT_REVIEW）
- 当前分支：phase/3-feishu-integration
- 当前 PR：无（待 GPT 复审通过后由用户决定是否创建 PR）

## 项目事实来源声明

### 唯一长期事实来源：本地工作区与 GitHub 仓库
以下内容在进入本地工作区或 GitHub 后，即视为正式项目状态；本地工作区有未 push 的修改时以本地工作区为准：
- 产品当前阶段、已确认需求、当前任务、验收标准。
- 架构决策、实现情况、测试结果、技术债。
- 审查结论、分支和 PR 状态。

### 非长期事实来源
- GPT 历史对话、Trae 历史对话、模型记忆。
- 用户粘贴但尚未落库的内容、未提交的临时说明、未经验证的模型判断。

### 冲突优先级（从高到低）
1. 用户最新明确决定。
2. 已接受的任务规格。
3. 已接受的架构决策（ADR）。
4. 本地工作区或 GitHub 当前代码和配置（本地有未 push 修改时以本地为准）。
5. 模型建议。

## 基本执行规则

> 完整执行流程（Preflight → 任务状态更新 → 按 AC 实现 → 测试 → 验证 → Out of Scope 检查 → Commit → 任务文件更新 → 输出完成包）见 `.trae/rules/trae-executor-role.md` 第 2-3 节。本节仅定义实现原则。

1. **最小满足原则**：优先选择能够满足验收标准的最小实现。不因「代码可以更优雅」「未来可能需要」「可以顺便重构」等理由自行扩大任务。
2. **范围控制**：每次修改前应明确回答——该修改对应哪条验收标准？不修改会导致什么具体失败？是否属于当前任务范围？是否会影响无关模块？无法回答时暂停修改。
3. **不隐式改变产品行为**：以下改变必须明确记录，必要时请求用户决定——API 请求或响应格式改变、数据库结构改变、用户流程改变、默认配置改变、权限规则改变、错误处理语义改变、数据兼容性改变、部署要求改变、外部依赖增加、运行成本明显增加。
4. **不覆盖用户未提交内容**：发现工作区存在不属于当前任务的未提交修改时，不得直接覆盖、不得擅自丢弃、不得执行破坏性 reset、不得把无关修改混入当前 commit。应先识别修改来源并隔离当前任务。

## 决策升级路径

以下情况必须升级由用户裁决（见改造方案第 2.3 节）：

1. **GPT 任务说明与现有架构决策冲突**：记录 Execution Conflict，停止执行，提交用户决定。
2. **GPT 与 Trae 对需求范围理解不同**：记录差异点，附仓库证据，提交用户裁决。
3. **需要修改已接受的架构决策**：创建 ADR 变更提案，提交用户审批。
4. **任务执行需要明显扩大范围**：完成可独立交付部分，记录新增需求，建议拆分 TASK。
5. **存在多个影响产品行为的合理方案**：列出方案对比，提交用户选择。
6. **为完成任务必须破坏兼容性或迁移数据**：说明影响和迁移方案，提交用户审批。
7. **安全、成本、交付速度之间存在重大取舍**：列出取舍分析，提交用户决定。

升级时不自行选择方案，不继续扩大修改范围。

## 文档优先级

当多条文档规则同时适用时，按以下优先级链执行：

1. `改造方案.txt`（项目总体框架文档，21 节完整协作规范，最高优先级）
2. `AGENTS.md`（本文件，入口文件，定义三方角色概览与项目事实来源）
3. `.trae/rules/trae-executor-role.md`（Trae 执行者角色权威规范，是 AGENTS.md "Trae 的角色" 与 "基本执行规则" 的细化；冲突时以此为准）
4. `.trae/rules/collator-handoff-audit.md`（跨窗口审计输出规则，任务级完成包基础上的阶段级补充）
5. `.trae/rules/项目操作规则.md`（场景化操作规则：飞书操作、文件管理、数据摄入等）
6. `.trae/rules/_core.md`（核心规则：文件结构、AI 工作流、三层体系、Skill 选择）
7. `.trae/rules/_file_management.md` / `_temp_script.md` / `_memory.md` / `_experience.md`（通用执行规则）
8. `docs/ai/*.md`（项目状态、审查规则、协作指南、技术债等专项文档）

冲突时以高优先级文档为准。`docs/ai/` 下的文档（如 `TRAE_COLLABORATION_GUIDE.md`）是对 `.trae/rules/` 规则的详细说明，规则冲突时以 `.trae/rules/` 为准。例外：平台能力与四方角色边界以本 `AGENTS.md` 为准；显式 Codex 任务的 AUDIT/FIX、范围、提交和回交规则以 `docs/ai/CODEX_EXECUTION_PROTOCOL.md` 为专项权威源。

## 标准化提示词模板

新开窗口时，复制对应提示词即可恢复上下文。模板为固定文本，无需替换占位符，AI 自行读取本地文件恢复上下文：
- GPT 新窗口启动 -> `docs/ai/GPT_STARTUP_PROMPT.md`
- Trae 新窗口启动 -> `docs/ai/TRAE_STARTUP_PROMPT.md`

### 每次任务完成后的状态摘要输出（强制）

每次任务完成（或会话结束）时，必须更新 `docs/ai/PROJECT_STATE.md` 后，额外输出以下格式的状态摘要，供用户下次新开窗口时直接复制使用：

```text
--- 下次启动摘要（复制到新窗口）---
项目：collator（数据清洗服务）
当前阶段：<Phase X / 子阶段>
当前分支：<branch-name>
最近 Commit：<short hash> <message>

已完成：
- <本次完成项>

阻塞项：
- <当前阻塞，或"无">

下一步：
- <下一窗口第一项动作>

启动提示词：
- GPT → docs/ai/GPT_STARTUP_PROMPT.md
- Trae → docs/ai/TRAE_STARTUP_PROMPT.md
--- 摘要结束 ---
```

## 项目特定补充

本项目采用 Phase 推进流程（Phase 0/1/2A/2B/2C/2F/3/5/6）和 Gate A-G 验收体系。每个 Phase 完成后必须运行 Gate A 全套验证命令（npm ci / audit:legacy / typecheck / lint / test / test:integration / test:coverage / build），并保持 Legacy 源码零修改约束（`git diff origin/main -- src/data-cleaning` 无输出）。Gate A-G 与改造方案 P0/P1/P2 并存：Gate 未通过对应 P0 阻塞。详细的 Gate 定义、阻塞规则与停止条件见 `docs/ai/REVIEW_POLICY.md`；Phase 推进流程与验证命令见 `docs/ai/TRAE_COLLABORATION_GUIDE.md`。
