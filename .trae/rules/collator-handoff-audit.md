# Collator 跨窗口交付审计输出规则

> **生效模式**：alwaysApply
> **适用场景**：分阶段实施过程中，需要在会话结束时向 GPT（上游窗口）同步状态时

---

## 1. 触发条件

满足以下任一条件即触发本规则：

- 用户要求在会话结束时向 GPT（上游窗口）同步状态。
- 用户明确提到"给 GPT 审计"、"跨窗口实施"、"Phase X"、"阶段报告"、"验收报告"。
- 当前任务属于 Phase 0-Phase 6 中的任一阶段，需要输出审计资料。

---

## 2. 执行前必读

开始实施前，AI 必须已读取：

1. `.trae/Knowledge/项目总览.md`
2. `.trae/Knowledge/业务场景.md`
3. `docs/ai/PROJECT_STATE.md`（若存在）
4. `docs/DECISIONS.md`（若存在）
5. `docs/ACCEPTANCE_REPORT.md`（若存在）

---

## 3. 实施过程约束

- 严格按当前阶段范围执行，不得提前实现后续阶段内容。
- 不得修改 `src/data-cleaning/` 下 Legacy 源码；发现 Legacy 行为错误时记录为 `BLOCKED` 或 `DEFERRED`。
- 所有业务写入默认 `DRY_RUN=true`，未获得明确生产授权不得连接生产飞书 Base。
- `.env`、App Secret、Access Token、真实客户数据不得进入 Git 和回复。

---

## 4. 每次会话结束必须输出给 GPT 的审计资料

完成当前阶段或当前会话结束时，必须按以下两层结构输出审计资料：

### 4.1 第一层：任务级完成包（引用 trae-executor-role.md 第 4 节）

按 `.trae/rules/trae-executor-role.md` 第 4 节定义的完成包格式输出，包含：
`Project ID / Task ID / Risk Level / Branch / Base Commit / Result Commit / Git Status / Changed Files / Diff Summary / Acceptance Criteria Mapping / Commands Run / Known Limitations / Unverified Areas / Highest Risk Areas / Scope Changes / Recommended Verdict / Next Owner`。

### 4.2 第二层：阶段级审计补充

在完成包基础上，追加以下阶段级要素：

```text
阶段：Phase X / 子阶段标识
状态：DONE / IN_PROGRESS / BLOCKED

本次完成：
- <具体完成项，可验证>

验收项（按 Collator_验收清单_v1.0）：
- [x] <已通过项及证据>
- [ ] <未完成项>

阻塞项：
- <外部凭据 / 环境 / 表结构 / Dify 不可访问等>

风险：
- <技术或进度风险>

下一步：
- <下一窗口第一项动作>
```

### 4.3 输出顺序

1. 先输出任务级完成包（trae-executor-role.md 第 4 节格式）。
2. 再输出阶段级审计补充（本节 4.2 格式）。
3. 两层均为强制输出，不得省略任意一层。

---

## 5. 必须同步更新的状态文档

每次阶段执行后，必须更新以下文档（如不存在则创建）：

- `docs/ai/PROJECT_STATE.md`
  - 当前阶段、状态、最近 Commit、分支
  - 已完成 / 正在进行
  - 各 Gate 验收状态与证据
  - 阻塞项、风险、下一步唯一动作
  - 最近一次执行的命令与结果

- `docs/ACCEPTANCE_REPORT.md`
  - 工程命令执行记录（日期、命令、退出码、通过/失败数、关键输出）
  - 数据质量指标与门槛对比
  - 外部集成场景结果与证据路径
  - 未通过项
  - 最终结论

- `docs/DECISIONS.md`
  - 仅当本阶段产生新的架构决策或变更提案时追加

---

## 6. 证据要求

> 验证规则（只报告实际执行的验证、无法执行验证时的处理、推荐验证顺序）见 `改造方案.txt` 第9节及 `docs/ai/TRAE_COLLABORATION_GUIDE.md`。本项目额外要求如下。

- Gate A 全套验证命令：`npm ci` / `npm run audit:legacy` / `npm run typecheck` / `npm run lint` / `npm run test` / `npm run test:integration` / `npm run test:coverage` / `npm run build`。
- 声称"通过"前必须实际运行对应命令并记录退出码和输出摘要。
- 外部集成（飞书 / Dify）声称通过必须提供真实环境运行的截图、Trace 或日志路径；无法访问真实环境时状态必须标记为 `BLOCKED_EXTERNAL_ENV`，不得伪造通过。

---

## 7. 与现有规则的优先级

### 7.1 优先级链

1. `_core.md`（始终生效，最高优先级）
2. `trae-executor-role.md`（Trae 执行者角色权威规范，定义任务级完成包格式）
3. `collator-handoff-audit.md`（本规则，定义阶段级审计输出格式）
4. `项目操作规则.md`（场景化操作规则）
5. `_file_management.md` / `_temp_script.md` / `_memory.md` / `_experience.md`（通用执行规则）

### 7.2 关系说明

- 本规则的完成包格式（第 4 节）引用 `trae-executor-role.md` 第 4 节，不重复定义。
- 本规则补充的阶段级要素（阶段状态、Gate 验收、阻塞项等）与任务级完成包互补，不冲突。
- 与 `_file_management.md`、`_temp_script.md`、`_memory.md`、`_experience.md` 冲突时，后者优先处理文件、临时脚本、记忆和经验写入，本规则负责输出格式与审计资料完整性。
