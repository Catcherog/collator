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

## 变更提案

无。
