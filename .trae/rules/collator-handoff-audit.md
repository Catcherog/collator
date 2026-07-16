# Collator 跨窗口交付审计输出规则

> **生效模式**：alwaysApply
> **适用场景**：接收到跨窗口交付指令文件（如 `GPT to Trae.txt`），或按 `Collator_Dify_飞书_Trae实施协作包_v1.0` 执行分阶段实施时

---

## 1. 触发条件

满足以下任一条件即触发本规则：

- 用户提供了 `GPT to Trae.txt` 或类似跨窗口 handoff 文本文件，并要求“执行下一步操作”。
- 用户明确提到按 `Collator_Dify_飞书_Trae实施协作包_v1.0` 实施、交付或审计。
- 当前任务属于 Phase 0—Phase 6 中的任一阶段，需要在会话结束时向 GPT（上游窗口）同步状态。

---

## 2. 执行前必读

开始实施前，AI 必须已读取：

1. `.trae/Knowledge/项目总览.md`
2. `.trae/Knowledge/业务场景.md`
3. `docs/ai/PROJECT_STATE.md`（若存在）
4. `docs/DECISIONS.md`（若存在）
5. `docs/ACCEPTANCE_REPORT.md`（若存在）
6. `docs/Collator_Dify_飞书_Trae实施协作包_v1.0/collator_handoff_v1/README.md`
7. `docs/Collator_Dify_飞书_Trae实施协作包_v1.0/collator_handoff_v1/Collator_璺ㄧ獥鍙ｅ疄鏂芥墜鍐宊v1.0.md`
8. `docs/Collator_Dify_飞书_Trae实施协作包_v1.0/collator_handoff_v1/Trae_涓绘墽琛屾彁绀鸿瘝_Collator_v1.0.md`
9. `docs/Collator_Dify_飞书_Trae实施协作包_v1.0/collator_handoff_v1/Collator_楠屾敹娓呭崟_v1.0.md`

---

## 3. 实施过程约束

- 严格按当前阶段范围执行，不得提前实现后续阶段内容。
- 不得修改 `src/data-cleaning/` 下 Legacy 源码；发现 Legacy 行为错误时记录为 `BLOCKED` 或 `DEFERRED`。
- 所有业务写入默认 `DRY_RUN=true`，未获得明确生产授权不得连接生产飞书 Base。
- `.env`、App Secret、Access Token、真实客户数据不得进入 Git 和回复。

---

## 4. 每次会话结束必须输出给 GPT 的审计资料

完成当前阶段或当前会话结束时，必须按以下格式向用户（即回传给 GPT 审计）输出：

```text
阶段：Phase X / 子阶段标识
状态：DONE / IN_PROGRESS / BLOCKED
当前 Commit：<完整 hash>
当前分支：<branch-name>

本次完成：
- <具体完成项，可验证>

修改文件：
- <文件相对路径>

执行命令与结果：
- <命令> → <退出码>，<关键结果摘要>

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

本规则与 `_core.md`、`项目操作规则.md` 冲突时，以本规则为准；与 `_file_management.md`、`_temp_script.md`、`_memory.md`、`_experience.md` 冲突时，后者优先处理文件、临时脚本、记忆和经验写入，本规则负责输出格式与审计资料完整性。
