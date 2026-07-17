# TASK-003: 审核通过后幂等写入客户表并完成 Gate D

## Status

PLANNED

## Stage

MVP / Phase 3C

## Dependencies

- TASK-002 完成并通过复审。

## Objective

人工审核通过后，将标准化客户记录幂等写入真实客户表，记录完整审计，并通过可重复、可清理的 Gate D 真实飞书验收。

## In Scope

- 实现 `CustomerRecordWriter`。
- 仅写入已确认中文字段白名单及 `Collator 摄入 ID`。
- 写入前按 `Collator 摄入 ID` 精确查询：存在则返回原记录 ID，不存在才创建。
- 将日期字段转换为飞书 API 所需的时间值。
- corrections 支持 TASK-002 的中英文键，并在提交前重新映射、清洗和校验。
- 审核状态流：`pending_review → approved → committing → completed`。
- 写入失败进入 `commit_failed`，允许使用相同审核记录重试。
- `dry_run=true` 不写客户表，写入日志状态为 `skipped_dry_run`。
- reject 更新审核记录，不写客户表。
- 飞书提交失败返回 HTTP 502 和 `FEISHU_COMMIT_FAILED`；详细信息只进入脱敏审计。
- 成功后设置 `business_record_id` 并写成功日志。
- 新增 `npm run gate:d` 真实验收 Runner。

## Gate D Synthetic Record

- 客户姓名：`GateD测试客户`
- 联系方式：`13800000000`
- 来源渠道：`其他`
- 拍摄类型：`亲子`
- 预算区间：`1000-2000元`
- 意向风格：`日系清新`
- 跟进记录：`COLLATOR_GATE_D_TEST:<uuid>`

Runner 必须验证任务跨 Repository 实例读取、审核记录、客户字段、写入日志以及重复提交幂等性。`finally` 只能按本次 API 返回的精确 record ID 清理测试数据；禁止按姓名、手机号或模糊条件批量删除。清理失败时必须退出失败并报告精确 record ID。

## Out of Scope

- 真实客户数据迁移或批量回填。
- 自动审核、自动提交。
- Dify/LLM 真实联调。
- 其他业务表写入。
- Docker 与部署。

## Expected Files

- Create: `src/server/business/customer-record-writer.ts`
- Create: `src/server/repositories/write-log-repository.ts`
- Create: `src/server/repositories/feishu-write-log-repository.ts`
- Create: `scripts/run-gate-d.ts`
- Modify: `src/server/services/ingestion-service.ts`
- Modify: `src/server/domain/errors.ts`
- Modify: `src/server/app.ts`
- Modify: `package.json`
- Modify: `.gitignore`，但必须保留当前用户修改
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/ai/PROJECT_STATE.md`
- Modify: `docs/ai/TECH_DEBT.md`
- Test: `tests/unit/business/customer-record-writer.test.ts`
- Test: `tests/unit/repositories/feishu-write-log-repository.test.ts`
- Test: `tests/integration/feishu-gate-d.test.ts`

## Acceptance Criteria

- [ ] 未审核、被拒绝及 `dry_run=true` 的任务均不写客户表。
- [ ] 人工 corrections 经过重新映射、清洗和校验。
- [ ] 网络超时、提交重试或 `commit_failed` 重试不产生重复客户。
- [ ] 成功后任务为 `completed`，包含真实 `business_record_id`。
- [ ] 失败后任务为 `commit_failed`，存在脱敏失败日志，可安全重试。
- [ ] `npm run gate:d` 使用真实 Base，验证全部链路并退出码 0。
- [ ] Gate D 测试数据按精确 record ID 清理；无真实客户记录被修改。
- [ ] Gate A 全套命令退出码均为 0。
- [ ] `git diff origin/main -- src/data-cleaning` 无输出。
- [ ] `DEBT-002` 在 Gate D 通过后标记为 `RESOLVED`。
- [ ] `DEBT-004` 在字段映射验收通过后标记为 `RESOLVED`。
- [ ] `DEBT-005` 保持开放，但注明 V1 新链路已不依赖硬编码资源 ID。
- [ ] Gate C-LLM 继续保持 `BLOCKED_EXTERNAL_ENV`。

## Implementation Constraints

- 客户表现有业务字段、自动化、权限和历史记录不得修改。
- `Collator 摄入 ID` 是技术幂等键；不得复用备注、来源链接等业务字段承载该值。
- Gate D 真实写操作必须使用合成数据，Secret 不得输出到终端或报告。
- `artifacts/feishu-gate-d/` 保存验收报告但不进入 Git。

## Verification

- `npm ci`
- `npm run audit:legacy`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run test:coverage`
- `npm run build`
- `npm run evaluate`
- `npm run gate:d`
- `git diff origin/main -- src/data-cleaning`

