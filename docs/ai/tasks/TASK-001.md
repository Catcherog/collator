# TASK-001: 建立飞书运行表与 FeishuTaskRepository

## Status

PLANNED

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

- [ ] 三张运行表及客户表技术字段创建成功，真实表 ID 仅写入本地 `.env`。
- [ ] `IngestionTask` 保存后可由新的 Repository 实例完整读取，字段深度等价。
- [ ] 支持按 `ingestion_id` 和 `idempotency_key` 查询。
- [ ] 单实例内 20 次并发重复请求只产生一个摄入任务。
- [ ] `TASK_REPOSITORY=memory` 保持当前测试行为。
- [ ] `TASK_REPOSITORY=feishu` 使用真实 Base；缺少配置时明确失败。
- [ ] Secret、access token、原始 API 响应和未脱敏敏感数据不进入日志。
- [ ] 生产代码不调用 lark-cli，不新增飞书 SDK 依赖。
- [ ] `git diff origin/main -- src/data-cleaning` 无输出。

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

