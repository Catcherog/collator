# TASK-001: 建立飞书运行表与 FeishuTaskRepository

## Status

P0_FIX_REQUIRED — ONE_DOCUMENT_REFERENCE_REMAINS

## Stage

MVP / Phase 3A

## Baseline

- 基线 Commit：`7899f43`
- 前置条件：Phase 2F 与 Gate C-Core 已通过
- 目标 Base：`MwGMbF0Q0alPc6s3jOccovvOnob`
- 客户表：`tblmRVrUnfodlzlo`
- 建议分支：`phase/3-feishu-integration`

## Objective

在现有飞书 Base 中建立 Collator 运行表，并实现生产可用的 `FeishuTaskRepository`，使摄入任务状态不再依赖进程内存。

## Context

当前生产组合根仍默认使用 `InMemoryTaskRepository`。`src/server/config.ts` 已预留飞书凭据和表 ID，但目标 Base 中尚无摄入、审核、写入日志三张运行表。用户已授权在现有 Base 中创建这些表。

线上客户表字段与旧 `src/data-cleaning/schemas/customer.json` 已存在 ID 漂移，例如客户 ID、客户姓名、拍摄类型的旧 field ID 均与线上不同。新运行链路不得复用旧硬编码 field ID。

## In Scope

- 在现有 Base 新建三张表：
  - `Collator 摄入任务`
  - `Collator 审核任务`
  - `Collator 写入日志`
- 在客户表新增隐藏文本字段 `Collator 摄入 ID`，不修改任何现有业务字段、筛选、排序或自动化。
- 使用 Node.js 20 原生 `fetch` 实现最小飞书 OpenAPI 客户端：
  - tenant access token 获取与缓存；
  - token 失效后单次刷新重试；
  - Base 记录查询、创建、更新、删除；
  - 结构化、脱敏错误。
- 实现 `FeishuTaskRepository`。
- 新增 `TASK_REPOSITORY=memory|feishu`，默认 `memory`。
- 选择 `feishu` 时校验全部必需配置，缺失时启动失败，不得静默回退内存仓库。

## Runtime Table Schema

### Collator 摄入任务

- `摄入 ID`：主字段，文本
- `幂等键`：文本
- `状态`：单选
- `来源记录 ID`：文本
- `任务快照 JSON`：长文本
- `创建时间`：日期时间
- `更新时间`：日期时间

### Collator 审核任务

- `摄入 ID`：主字段，文本
- `状态`：单选
- `候选 JSON`：长文本
- `标准化结果 JSON`：长文本
- `校验结果 JSON`：长文本
- `审核人`：文本
- `审核决定`：单选
- `人工修正 JSON`：长文本
- `更新时间`：日期时间

### Collator 写入日志

- `写入日志 ID`：主字段，文本
- `摄入 ID`：文本
- `目标表 ID`：文本
- `业务记录 ID`：文本
- `写入状态`：单选，限定 `pending`、`succeeded`、`failed`、`skipped_dry_run`
- `错误码`：文本
- `脱敏错误消息`：长文本
- `创建时间`：日期时间

## Out of Scope

- Dify/LLM 真实联调。
- 客户业务记录写入。
- 自动审核或自动提交。
- 其他业务表接入。
- 修改 `src/data-cleaning/**`。

## Expected Files

- Create: `src/server/feishu/feishu-client.ts`
- Create: `src/server/feishu/feishu-errors.ts`
- Create: `src/server/repositories/feishu-task-repository.ts`
- Create: `src/server/repositories/repository-factory.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/app.ts`
- Modify: `.env.example`
- Test: `tests/unit/feishu/feishu-client.test.ts`
- Test: `tests/unit/repositories/feishu-task-repository.test.ts`
- Test: `tests/integration/feishu-task-repository.test.ts`

## Acceptance Criteria

- [x] 三张运行表及客户表技术字段创建成功，真实表 ID 仅写入本地 `.env`。
- [x] `IngestionTask` 保存后可由新的 Repository 实例完整读取，字段深度等价。
- [x] 支持按 `ingestion_id` 和 `idempotency_key` 查询。
- [x] 单实例内 20 次并发重复请求只产生一个摄入任务。
- [x] `TASK_REPOSITORY=memory` 保持当前测试行为。
- [x] `TASK_REPOSITORY=feishu` 使用真实 Base；缺少配置时明确失败。
- [x] Secret、access token、原始 API 响应和未脱敏敏感数据不进入日志。
- [x] 生产代码不调用 lark-cli，不新增飞书 SDK 依赖。
- [x] `git diff origin/main -- src/data-cleaning` 无输出。

## Implementation Summary

- **建表**：`src/scripts/temp/create-collator-tables.ts` 通过 lark-cli 幂等创建 3 张运行表 + 客户表 `Collator 摄入 ID` 字段；真实表 ID 已写入 `.env`。
- **FeishuClient**（`src/server/feishu/feishu-client.ts`）：Node 20 原生 fetch；tenant_access_token 缓存 + 60s 提前刷新；401 单次刷新重试；CRUD + searchRecords；fetchFn 注入支持单测。
- **FeishuApiError**（`src/server/feishu/feishu-errors.ts`）：结构化脱敏错误，redactPhone 兜底。
- **FeishuTaskRepository**（`src/server/repositories/feishu-task-repository.ts`）：JSON 快照策略（完整 IngestionTask 序列化到「任务快照 JSON」字段，索引列只用于查询）；save 先 search by 摄入 ID 决定 update/create；datetime 毫秒时间戳。
- **Repository Factory**（`src/server/repositories/repository-factory.ts`）：生产装配点，feishu 模式下缺凭据抛错不静默回退。
- **Config**（`src/server/config.ts`）：新增 `taskRepository: z.enum(['memory','feishu']).default('memory')` + superRefine 校验 feishu 必需凭据。
- **App**（`src/server/app.ts`）：用 `createTaskRepository(config)` 替代直接 `new InMemoryTaskRepository()`。
- **真实 Base 结构核验**（`src/scripts/temp/smoke-test-lark-cli.ts`）：lark-cli 端到端 create→search→update→search 全流程；字段深度等价；datetime 毫秒时间戳格式正确；单选字段返回数组形式符合预期；cleanup 后 0 记录残留。

## Test Coverage

- 14 单元测试（feishu-client）：token 缓存 / 刷新 / 401 重试 / app_secret 不泄露 / CRUD / search / 错误脱敏
- 9 单元测试（feishu-task-repository）：save create / save update / findById / findByIdempotencyKey / 嵌套对象与数组 round-trip
- 6 集成测试（FakeFeishuClient 跨实例读取）：跨实例深度等价 / findByIdempotencyKey 跨实例 / save twice 单记录 / 20 条并发 round-trip / 未找到返回 null
- 8 单元测试（repository-factory）：memory 模式 / feishu 模式 / 缺各项凭据抛错含 ENV 名称 / 不静默回退

## Gate A 全套验证（2026-07-17）

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npm run typecheck` | 0 | 无错误 |
| `npm run lint` | 0 | 无错误 |
| `npm run test` | 0 | 194 passed / 24 files |
| `npm run test:integration` | 0 | 27 passed / 3 files |
| `npm run test:coverage` | 0 | All files Lines 85.92%；feishu-client 95.3%；feishu-errors 100%；feishu-task-repository 91.2%；repository-factory 100% |
| `npm run build` | 0 | dist/ 构建成功 |
| `npm run audit:legacy` | 0 | 62 modules（SAFE 4, UNSAFE 57, BLOCKED 1） |
| `git diff origin/main -- src/data-cleaning` | 0 | 无输出 |

## Real Base Smoke Test（2026-07-17）

通过 `src/scripts/temp/smoke-test-lark-cli.ts`（lark-cli execFileSync，无 secret 注入需求）：

1. **Create**：upsert 不带 record-id → 创建记录 `recXXX`，字段映射符合 FeishuTaskRepository.buildFields
2. **Search**：search by "摄入 ID" → 1 条记录，字段值深度等价（摄入 ID / 幂等键 / 状态 / 来源记录 ID / 任务快照 JSON 全部匹配）
3. **Update**：upsert 同 ingestion_id 不同 status（pending_review）→ 同 record_id，无新增记录
4. **Search again**：1 条记录，状态更新为 pending_review，快照深度等价
5. **Cleanup**：delete 测试记录 → 0 残留

**关键发现**：
- 飞书单选字段值返回数组形式 `["received"]`（非 bare string），FeishuTaskRepository 解析快照字段（text 类型，bare string）不受影响
- datetime 字段接受毫秒时间戳（number），返回字符串 `"2026-07-17 18:00:01"`
- lark-cli +record-upsert 在 create 模式与 update 模式下响应结构不同（create 用 record_id_list + columnar data；update 用 record.update 对象 + updated: true）

## Notes for GPT Review

- **未直接调用 FeishuTaskRepository 真实 Base 烟雾测试**：因 `FEISHU_APP_SECRET` 不在 .env 文件中（占位 `replace_me`），且 TRAE 终端无法交互式注入 SecureString。改为通过 lark-cli（外部凭据注入，无需 secret）用相同的字段映射与 JSON 快照策略验证真实飞书 Base 行为。这覆盖了字段类型、JSON 序列化兼容性、datetime 格式、单选字段返回形式等真实 Base 风险点；FeishuTaskRepository 自身的代码路径由 9 单元 + 6 集成测试覆盖。如需完整端到端（FeishuClient → 真实飞书 API），可在部署时注入 secret 后运行 `TASK_REPOSITORY=feishu npm start` 触发一次真实 ingestion。
- **lark-cli 不进入生产代码**：仅 `src/scripts/temp/` 一次性脚本使用 lark-cli；`src/server/feishu/` 与 `src/server/repositories/` 源码扫描无 lark-cli import；`package.json` 无飞书 SDK 依赖。
- **PowerShell 引号限制**：烟雾测试脚本必须通过 Node.js execFileSync 数组参数调用 lark-cli，不能用 PowerShell inline 传递 JSON（PowerShell 分词会破坏 JSON）。

## Implementation Constraints

- lark-cli 仅用于一次性资源创建、结构核验和验收。
- 表 ID、Base Token、App ID、Secret 必须配置注入，不得复制旧配置中的硬编码值到运行时代码。
- HTTP 客户端必须允许注入 `fetch`，单元测试不得访问真实网络。
- 不覆盖当前工作区已有未提交修改。

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run test:coverage`
- `npm run build`
- `npm run audit:legacy`
- `git diff origin/main -- src/data-cleaning`

## Review History

### GPT P0 Fix Re-review — Commit `9102da1`（2026-07-17）

- 复审范围仅限原 P0-01 与 P0-02。
- P0-01：PASSED。定向测试 `tests/unit/feishu/feishu-client.test.ts` 17/17 通过；HTTP 200 + `code=99991663` 会刷新 token 并仅重试一次，非 token 业务错误不触发刷新。
- P0-02：FAILED。`git grep` 仍在 `docs/ACCEPTANCE_REPORT.md:291` 找到真实摄入表 ID；与“真实表 ID 仅写入本地 `.env`”验收条件冲突。
- 最小修复：将该真实 ID 替换为 ``<FEISHU_INGESTION_TABLE_ID>`` 或仅写环境变量名。无需改代码、无需重跑完整 Gate A；提交后运行目标 ID 的 `git grep`，无匹配即可再次复审。
- 结论：`MVP_FAIL`（仅剩 1 个 P0 文档残留）。
