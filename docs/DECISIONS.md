# DECISIONS

## 已冻结决策

> 来源：《Collator × Dify × 飞书中台跨窗口实施手册 v1.0》

- ADR-001：Trae 仅作开发环境。生产运行不依赖 Trae 对话、Rules 或 Knowledge。
- ADR-002：V1 不使用 LangChain/LangGraph/ReAct Agent。
- ADR-003：TypeScript + Fastify + Node.js 20+；保留现有 Node.js 清洗/校验/Schema 资产，增量改造而非整体重写。
- ADR-004：Dify 只负责语义提取与外层工作流，不直接写飞书业务主表，不维护状态机/幂等/回滚。
- ADR-005：V1 全人工审核，`AUTO_COMMIT_ENABLED=false`。
- ADR-006：飞书作为任务状态和业务事实中心；生产用 `FeishuTaskRepository`，测试用 `InMemoryTaskRepository`。
- ADR-007：生产数据隐私边界；Dify Cloud 只用合成/脱敏数据；.env/Token/Secret 不入 Git。
- ADR-008：V1 只支持 `customer_consultation` 纯文本链路，只写客户主表。
- ADR-009：Callback 使用 HMAC + 时间戳验签，拒绝超时与重放。
- ADR-010：手机号等敏感信息日志脱敏，原始聊天不进入普通应用日志。

## 变更提案模板

### ADR-XXX：标题

- 状态：PROPOSED / ACCEPTED / REJECTED
- 日期：
- 提出人：
- 当前方案：
- 建议方案：
- 原因：
- 影响文件：
- 影响验收项：
- 风险：
- 迁移方案：
- 回滚方案：

## 变更提案流程

### 何时提出变更提案

当出现以下情况时，由 Trae 创建变更提案（基于 GPT 任务包或用户指示）：

1. 需要修改已接受的架构决策（ADR-001 ~ ADR-010）。
2. 实现过程中发现更好的技术方案，且方案变更影响跨 Phase 行为。
3. 外部环境变化导致原决策前提不再成立（如 Dify API 变更、飞书 API 废弃）。
4. 用户明确要求变更架构决策。

### 变更提案处理流程

```
Trae 发现需要变更
  ↓
按变更提案模板填写 ADR-XXX
  ↓
状态标记为 PROPOSED
  ↓
提交用户审批
  ↓
用户批准 -> 状态改为 ACCEPTED，更新相关代码和文档
用户拒绝 -> 状态改为 REJECTED，保持原决策
  ↓
更新 docs/ai/decisions/ 下的 ADR 文件
  ↓
更新 docs/ai/PROJECT_STATE.md 中的相关引用
```

### 变更提案与任务的关系

- 变更提案是决策层面的，不直接修改代码。
- 变更提案被接受后，通过正常 TASK 流程执行实现。
- 一个变更提案可能对应多个 TASK。
- TASK 中实现变更时，在任务文件的 Implementation Constraints 中引用被变更的 ADR。

## 变更提案

无。
