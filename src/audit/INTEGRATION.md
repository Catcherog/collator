# Workstream D — 审计日志持久化：Workstream E 接入指南

本文件说明 **Workstream E** 如何把 `AuditLogRepository` 接入 `app.ts` 与两个服务
（`IngestionService`、`ScreenshotService`）。Workstream D 只交付了「审计仓库合同 +
文件适配器 + 测试」，**没有**修改 `app.ts` / `config.ts` / 服务构造函数（Critical Path
Ownership 约束）。接入由 Workstream E 在 Composition Root 完成。

---

## 1. 交付物清单（Workstream D 已完成，勿重复实现）

| 文件 | 角色 |
|------|------|
| `src/server/config/audit-config.ts` | `AuditConfig` 接口 + `loadAuditConfig(env)` |
| `src/audit/audit-log-repository.ts` | `AuditEventType` / `AuditLogRecord` / `AuditLogRepository` 合同 + `createAuditEvent()` 工厂 |
| `src/audit/redaction.ts` | `redactDetails()` PII 最小化（AC-D04），在 `record()` 持久化边界调用 |
| `src/server/repositories/audit/file-audit-repository.ts` | 文件 JSONL 适配器（默认后端，AC-D01/D03/D07/D08） |
| `src/server/repositories/audit/in-memory-audit-repository.ts` | 内存适配器（测试用） |
| `tests/unit/audit/redaction.test.ts` 等 | 37 个测试，覆盖 AC-D01~D08 |

**Amendment 5（重要）**：本审计仓库与 `write-log-repository.ts` **相互独立、不可混淆**。
write-log 仅覆盖「写入事件」（succeeded/failed/skipped_dry_run），是「尝试日志」；
audit-log 覆盖整条垂直闭环的状态迁移，是「迁移日志」。**不可通过重命名 write-log 来
声称审计持久化已完成。**

---

## 2. 持久化策略与凭据依赖

- 默认 `AUDIT_STORE=file`：JSON Lines 文件，**无需任何外部凭据**，进程重启后可读
  （AC-D01），整文件复制即备份（AC-D09）。
- `AUDIT_STORE=feishu`：预留位，**当前未实现**。未来需独立审计表 + FEISHU_* 凭据。
  SQLite 需新增依赖，故未采用。文件存储是无需凭据即可通过 AC-D01 的务实选择。
- 默认路径 `./data/audit.log.jsonl`。`data/` 与 `uploads/` 同属运行期产物，操作员应
  自行将 `data/` 纳入 `.gitignore`，或通过 `AUDIT_FILE_PATH` 指向受管理的持久卷。

---

## 3. app.ts 接入步骤（Workstream E 执行）

### 3.1 加载审计配置并构造仓库

在 `buildApp()` 顶部（与 `loadConfig()` 并列）：

```ts
import { loadAuditConfig } from './config/audit-config.js';
import { createFileAuditRepository } from './repositories/audit/file-audit-repository.js';
import type { AuditLogRepository, AuditLogger } from '../audit/audit-log-repository.js';
import type { AuditLogger as FileAuditLogger } from './repositories/audit/file-audit-repository.js';

// 把 pino 适配为审计仓库的最小 logger 接口（仅 warn）。
const auditLogger: FileAuditLogger = {
  warn: (msg, extra) => app.log.child({ module: 'audit' }).warn(extra ?? {}, msg),
};
const auditConfig = loadAuditConfig(process.env);
const auditLogRepository: AuditLogRepository = createFileAuditRepository(auditConfig, auditLogger);
```

> 注意：pino 的 `warn(obj, msg)` 与本仓库的 `warn(msg, extra)` 形参顺序不同，需用
> 上面的适配器转换，切勿直接把 pino 实例当作 `AuditLogger` 传入。

### 3.2 注入到服务

- `IngestionService`：在现有 5 个构造参数后追加**可选第 6 参**
  `auditLogRepository?: AuditLogRepository`（向后兼容，`scripts/run-gate-d.ts` 的
  `new IngestionService(..., new SopPreWriteClient())` 无需改动即可继续编译）。
- `ScreenshotService`：在 `ScreenshotServiceOptions` 中新增
  `auditLogRepository?: AuditLogRepository`（与现有 `writeLogRepository` 并列）。

`buildApp` 同时把 `auditLogRepository` 传给两个服务：

```ts
const service = new IngestionService(
  repository, reviewRepository, customerRecordWriter,
  writeLogRepository, preWriteClient, auditLogRepository,
);
// ...
screenshotServiceOptions.auditLogRepository = auditLogRepository;
```

测试模式（注入 repository 时）默认可省略 `auditLogRepository`（服务以可选方式处理其
缺失）；需要验证审计行为的测试可注入 `InMemoryAuditLogRepository`。

### 3.3 失效模式约定（AC-D03）

- `AUDIT_FAIL_CLOSED=true`（默认）：`record()` 失败时抛 `AuditWriteError`。
  服务应让其**向上冒泡**（fail-closed），避免在无审计轨迹下静默推进业务。
  唯一例外是「写入已成功之后的 `write_succeeded` 审计」——此时业务写入已落库，
  审计失败应 fail-closed 暴露审计缺口（HTTP 层返回 502/500），由运维补救审计文件。
- `AUDIT_FAIL_CLOSED=false`（degrade）：`record()` 失败时记录警告并返回未持久化的
  （已脱敏）记录，业务继续。仅操作员显式接受审计降级时启用。

---

## 4. 事件 → 服务方法 映射（在何处记录哪种 event_type）

`record()` 在 `(ingestion_id, event_type)` 上幂等（AC-D02），重复记录同一迁移不产生
重复行。因此每个迁移点只需无条件调用 `record(createAuditEvent({...}))`，仓库自动去重。

### 4.1 IngestionService

| event_type | 记录位置（方法 / 代码点） | result_status | 关键 details（已自动脱敏） |
|------------|--------------------------|---------------|---------------------------|
| `ingestion_received` | `createIngestion` → `doCreateIngestion`，`repository.save(task)` **之后**（仅新记录） | `received` | `{ source_system, target_domain, dry_run }` |
| `idempotency_replay` | `createIngestion` → 命中 `existing`（idempotent_replay=true）分支 | 原 task.status | `{ replayed_at }` |
| `candidate_generated` | `receiveCandidate` 成功建复核后；或 `adoptCandidateV1` 持久化候选后 | `pending_review` / `candidate_received` | `{ candidate_id, review_record_id? }` |
| `idempotency_replay` | `receiveCandidate` 命中 `task.candidate` 已存在；或 `adoptCandidateV1` 命中已采用 | 原 status | `{ candidate_id }` |
| `governance_rejected` | `reject` → `repository.save` 后 | `review_rejected` | `{ reviewer_id, reason_code }` |
| `write_started` | `approve` → `handleCommitFlow`，状态置 `committing` 后 | `committing` | `{ target_table_id }` |
| `write_succeeded` | `handleCommitFlow` 成功 / `handleDryRunApprove`（dry_run，details 标 `dry_run:true`） | `succeeded` / `skipped_dry_run` | `{ business_record_id?, target_table_id, dry_run }` |
| `write_failed` | `handleCommitFlow` 写入异常分支 | `failed` | `{ error_code }`（短机器码，非原始错误） |

> `write_started` 应在调用 `customerRecordWriter.write()` **之前**记录，`write_succeeded`
> / `write_failed` 在写入日志 `writeLogRepository.create()` 之后记录。write-log 与
> audit-log 各自独立写入，互不替代。

### 4.2 ScreenshotService

| event_type | 记录位置（方法 / 代码点） | result_status | 关键 details |
|------------|--------------------------|---------------|--------------|
| `ingestion_received` | `createScreenshot` 创建 IngestionTask 后（非幂等重放） | `received` | `{ source_system, image_content_hash }`（仅哈希，不含图片） |
| `idempotency_replay` | `createScreenshot` 命中 `findByIdempotencyKey` existing | 原状态 | `{ image_content_hash }` |
| `ocr_started` | `runOcrAndBuildCandidate` 状态置 `ocr_processing` 后 | `ocr_processing` | `{ engine }` |
| `ocr_completed` | OCR 返回后，状态置 `ocr_completed` 后 | `ocr_completed` | `{ ocr_task_id, confidence }` |
| `ocr_failed` | `createScreenshot` 的 OCR catch 分支 | `failed` | `{ error_code }` |
| `candidate_generated` | 构建 Candidate V1 后，状态置 `candidate_drafted` 后 | `candidate_drafted` | `{ candidate_id, quality_status }` |
| `governance_passed` | `confirmWrite`，governance.decision=PASS 后 | `PASS` | `{ rule_version }` |
| `governance_reviewed` | `confirmWrite` decision=NEEDS_REVIEW 后；或 `escalateReview` | `NEEDS_REVIEW` | `{ review_task_id, reason_code? }` |
| `governance_rejected` | `confirmWrite` decision=BLOCKED 后 | `BLOCKED` | `{ rule_version }` |
| `write_started` | `confirmWrite` 调用 `batchWriter.writeBatch` 前 | `committing` | `{ target_tables }` |
| `write_succeeded` | `confirmWrite` 写入成功后 | `succeeded` | `{ transaction_snapshot_id? }` |
| `write_failed` | `confirmWrite` 写入失败分支 | `failed` | `{ error_code }` |

> details 中**绝不**放入：完整 base64 图片、原始飞书 token、app_secret、客户完整聊天
> 内容。`redactDetails()` 会在落盘前剥除 secret/token/password/image/base64 并掩码手机
> 号，但调用方仍应保持 details PII 最小化（只放哈希、ID、状态码、计数）。

---

## 5. 备份与恢复（AC-D09）

文件后端的备份即「复制文件」：

```bash
# 停机或在线（append-only，在线拷贝安全；可接受读到截止某行的一致快照）
cp ./data/audit.log.jsonl ./data/audit.log.jsonl.$(date +%Y%m%d).bak
```

恢复：将备份文件放回 `AUDIT_FILE_PATH`，`FileAuditRepository` 重新实例化即可读回全部
历史（AC-D01 跨实例持久化已由测试覆盖）。损坏的单行不会影响其余行——读取时非法 JSON
行被跳过，不影响其他记录的可读性。

---

## 6. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `AUDIT_STORE` | `file` | `file`（已实现）/ `feishu`（预留） |
| `AUDIT_FILE_PATH` | `./data/audit.log.jsonl` | JSONL 文件路径 |
| `AUDIT_MAX_RETRIES` | `2` | 写入失败重试次数（不含首次） |
| `AUDIT_FAIL_CLOSED` | `true` | `true`=fail-closed 抛错；`false`=降级继续 |

`AUDIT_FAIL_CLOSED` 显式解析 `"false"`/`"0"`/`"no"`/`"off"` 为 false（避免
`z.coerce.boolean()` 把 `"false"` 误判为真的陷阱）。

---

## 7. 验收对照

| AC | 状态 | 证据 |
|----|------|------|
| AC-D01 重启持久化 | ✅ | `file-audit-repository.test.ts` “restart persistence” |
| AC-D02 迁移至多一条 | ✅ | 同上 “transition idempotency” + in-memory 合同测试 |
| AC-D03 fail-closed/degrade | ✅ | 同上 “failure modes” |
| AC-D04 落盘脱敏 | ✅ | `redaction.test.ts` + “redaction at rest” |
| AC-D05/D06 有序序列 | ✅ | “ordered sequence” |
| AC-D07 并发不损坏 | ✅ | “100 concurrent records” |
| AC-D08 缺失目录自动创建 | ✅ | “auto-initialization” |
| AC-D09 备份/恢复 | ✅ | §5（append-only 文件，复制即备份） |
| AC-D10 typecheck 通过 | ✅ | `npm run typecheck` 干净 |
