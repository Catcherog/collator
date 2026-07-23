# Workstream C — 真实飞书 Writer 集成说明（供 Workstream E 使用）

> 本文件描述 Workstream E 如何把「双层放行门」接入真实飞书 Create Record
> 写入路径，以及操作者在本地做真实 E2E 所需的环境变量（仅列名称，不含值）。
>
> 章程版本：v1.1 · Amendment 6 · 双入口治理（PRE_WRITE / POST_WRITE）。

---

## 1. 双层放行门（Amendment 6）

真实飞书 Create Record API 调用必须同时满足 **全部 6 个条件**，任一缺失即
**fail-closed**（不得调用 Create Record）：

| # | 条件 | 来源 |
|---|------|------|
| 1 | `TASK_REPOSITORY=feishu` | layer 1 / `config.ts` |
| 2 | `DRY_RUN=false` | layer 1 / `config.ts` |
| 3 | `ENABLE_REAL_FEISHU_WRITE=true` | layer 2 / `feishu-write-config.ts` |
| 4 | `FEISHU_WRITE_ENV=test`（本批不启用 production） | layer 2 |
| 5 | 目标 Base/Table 命中测试白名单 | layer 2 |
| 6 | SOP Governance Result = `PASS` | 治理层（PRE_WRITE） |

实现位置：

- 门配置与判定函数：[feishu-write-config.ts](../../config/feishu-write-config.ts)
  - `loadFeishuWriteConfig(env)`：聚合 6 条件所需输入
  - `isRealWriteAllowed(config, governanceDecision, targetBaseToken, targetTableId)`：
    返回 `{ allowed, reason }`，**唯一** fail-closed 判定点
- 门控写入器（现成集成点）：[guarded-batch-writer.ts](../../business/guarded-batch-writer.ts)
  - `GuardedBatchWriter`：在委托内部 `TransactionalBatchWriter` 之前，对每个目标表
    评估门禁；任一不允许 → 返回 `status: 'blocked'`，**绝不** 调用 createRecord
- 精确清理助手：[record-cleanup.ts](../../business/record-cleanup.ts)
  - `cleanupByRecordIds(client, targets)`：仅按精确 record_id 删除（AC-C10 / AC-E22），
    绝不按名称匹配

---

## 2. Workstream E 接线方式

Workstream E 负责把门禁接入实际写入路径。推荐接线：

### 2.1 在 `app.ts` 装配处（E 可读，不可由 C 改）

当前 `app.ts`（lines 131-155）在 `taskRepository==='feishu'` 且 project/model 表
ID 存在时已装配 `TransactionalBatchWriter`。Workstream E 应将其包裹为
`GuardedBatchWriter`：

```ts
import { loadFeishuWriteConfig } from './config/feishu-write-config.js';
import { GuardedBatchWriter } from './business/guarded-batch-writer.js';

// 在装配 TransactionalBatchWriter 之后：
const gateConfig = loadFeishuWriteConfig(); // 读 process.env
screenshotServiceOptions.batchWriter = new GuardedBatchWriter(
  gateConfig,
  new TransactionalBatchWriter(customerWriter, projectWriter, modelWriter, writeLogRepository)
);
```

### 2.2 调用方传入治理决定

`ScreenshotService.confirmWrite` 在调用 `batchWriter.writeBatch` 前已先调用
SOP PRE_WRITE（`governanceClient.callPreWriteFull`），且仅当 `decision === 'PASS'`
才继续写入（BLOCKED / NEEDS_REVIEW 提前返回，不写入业务表 —— AC-C02 / AC-C03 已在
服务层满足）。Workstream E 需把治理决定与目标 Base token 传入 `writeBatch`：

```ts
await this.options.batchWriter.writeBatch({
  ingestionId: task.ingestion_id,
  normalizedFields: state.candidate_v1.normalized_fields,
  targetTables: req.target_tables,
  dryRun: req.dry_run ?? task.dry_run,
  // 新增（GuardedWriteBatchInput）：
  governanceDecision: { decision: state.governance_result_v1.decision },
  targetBaseToken: config.feishuBaseAppToken, // 目标 Base token，用于白名单 base 校验
  customerTableId: config.feishuCustomerTableId,
  projectTableId: config.feishuProjectTableId,
  modelTableId: config.feishuModelTableId,
});
```

> 门禁是 PRE_WRITE 之后的**第二道**防线：即使服务层逻辑被绕过，`GuardedBatchWriter`
> 仍会在 createRecord 之前再次校验 6 条件，保证 fail-closed。

### 2.3 清理 / 回滚

- 事务内部分失败：`TransactionalBatchWriter` 已按精确 record_id 反向回滚
  （Model → Project → Customer），状态为 `rolled_back` 或 `partial`（AC-C09）。
- 跨批次补偿 / E 的清理：调用 `cleanupByRecordIds(client, targets)`，`targets` 为
  `{ recordId, tableId }` 数组。**严禁** 用 `searchRecords` 按名称找记录再删。

---

## 3. 本地真实 E2E 所需环境变量（仅名称）

操作者在本地对**测试白名单**内的 Base/Table 做真实 E2E 时需设置（名称如下，**勿提交
真实值**）：

### Layer 1（既有，`config.ts`）
- `TASK_REPOSITORY` = `feishu`
- `DRY_RUN` = `false`
- `COLLATOR_WEBHOOK_SECRET`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_APP_TOKEN`（目标 Base）
- `FEISHU_INGESTION_TABLE_ID`
- `FEISHU_REVIEW_TABLE_ID`
- `FEISHU_WRITE_LOG_TABLE_ID`
- `FEISHU_CUSTOMER_TABLE_ID`
- `FEISHU_PROJECT_TABLE_ID`
- `FEISHU_MODEL_TABLE_ID`
- `SOP_HTTP_URL`（SOP 治理服务地址，默认 `http://localhost:3001`）

### Layer 2（新增，`feishu-write-config.ts`）
- `ENABLE_REAL_FEISHU_WRITE` = `true`
- `FEISHU_WRITE_ENV` = `test`（**本批不设 `production`**）
- `FEISHU_TEST_BASE_APP_TOKEN`（测试白名单 Base token，须与 `FEISHU_BASE_APP_TOKEN` 一致）
- `FEISHU_TEST_TABLE_IDS`（逗号分隔的测试白名单表 ID，须包含真实写入目标表）

> 安全：上述变量不得进入 git。`feishu-write-config.ts` 的门禁 `reason` 为静态诊断
> 串，绝不回显这些值（AC-C12）。

---

## 4. 测试白名单机制

`FEISHU_TEST_TABLE_IDS` 是逗号分隔的表 ID 列表，`FEISHU_TEST_BASE_APP_TOKEN` 是可选
的 Base token。门禁条件 5 判定：

1. 目标 `targetTableId` 必须在 `FEISHU_TEST_TABLE_IDS` 列表中；否则 blocked。
2. 若设置了 `FEISHU_TEST_BASE_APP_TOKEN`，则目标 `targetBaseToken` 必须等于它；
   否则 blocked（防止用相同表 ID 打到非测试 Base）。
3. 白名单为空 → 全部 blocked（fail-closed）。

本批**仅**允许 `FEISHU_WRITE_ENV=test`。`production` 不被门禁放行（条件 4）。

---

## 5. 已验证 / 未验证

- **已验证（mock-based，CI 全绿）**：
  - 6 条件门禁逻辑（参数化，每条缺失 → blocked）
  - 门禁不允许时 `createRecord` 不被调用（FeishuClient spy）
  - 幂等重放不产生重复业务记录 / 重复写入日志
  - 部分失败时状态非 committed，已成功 record_id 仍被写入日志跟踪
  - 清理仅按精确 record_id 删除，无名称匹配
  - Token 缓存 + 401 重试（`feishu-client.ts` 既有）
  - 富文本三种形状归一化（`normalize-text.ts` 既有）
  - 关联字段使用 record_id 数组（AC-C07，`project-record-writer.ts`）
- **未验证（blocked on external credentials）**：
  - 真实飞书 Create Record 端到端（标记
    `IMPLEMENTATION_COMPLETE_BLOCKED_EXTERNAL_CREDENTIALS`，见
    `tests/unit/feishu/real-feishu-write-blocked.test.ts`）。需操作者用真实凭据在
    测试白名单 Base 上本地执行。
