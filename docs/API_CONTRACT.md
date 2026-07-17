# API Contract

> **版本**：v1.0  
> **适用范围**：Phase 1 客户聊天纯文本 → 客户主表链路  
> **基线**：Node.js 20+、TypeScript、Fastify、Zod、Ajv、Vitest

---

## 1. 接口清单

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/healthz` | 存活检查 | 无 |
| GET | `/readyz` | 就绪检查 | 无 |
| POST | `/v1/ingestions` | 创建摄入任务 | 无（由飞书入口前置控制） |
| GET | `/v1/ingestions/:id` | 查询任务状态 | 无 |
| POST | `/v1/internal/ingestions/:id/candidate` | Dify 结构化结果回调 | HMAC + 时间戳 |
| POST | `/v1/ingestions/:id/approve` | 人工审核通过 | 无（由飞书入口前置控制） |
| POST | `/v1/ingestions/:id/reject` | 人工审核拒绝 | 无（由飞书入口前置控制） |

---

## 2. 通用约定

### 2.1 成功响应

成功响应返回业务对象，状态码见各接口定义。

### 2.2 错误响应

所有错误使用统一结构：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "..."
  }
}
```

| HTTP 状态码 | error.code | 触发场景 |
|------------|------------|---------|
| 400 | `VALIDATION_ERROR` | 请求体不符合 Zod Schema |
| 400 | `BAD_REQUEST` | 业务规则拒绝（如 target_domain 不支持、content 为空） |
| 401 | `UNAUTHORIZED` | Candidate 回调签名缺失/无效/过期 |
| 404 | `NOT_FOUND` | 任务 ID 不存在 |
| 409 | `CONFLICT` | 状态机冲突（如已完成的摄入再次审核） |
| 500 | `INTERNAL_ERROR` | 未预期异常 |

---

## 3. 接口详情

### 3.1 POST /v1/ingestions

创建一条新的摄入任务。同一请求（按 `source_system` + `source_record_id` + `target_domain` + `content` 计算 SHA256）重复提交只生成一个任务。

**请求体**

```json
{
  "source_system": "feishu_form",
  "source_record_id": "rec_001",
  "source_type": "chat_text",
  "target_domain": "customer_consultation",
  "content": "你好，我想拍一套写真，预算3000元左右。",
  "submitted_at": "2026-07-15T10:00:00.000Z",
  "timezone": "Asia/Shanghai",
  "submitted_by": "operator_1",
  "dry_run": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source_system | string | 是 | 来源系统标识 |
| source_record_id | string | 是 | 来源系统记录 ID |
| source_type | string | 是 | 数据类型，如 `chat_text` |
| target_domain | string | 是 | V1 仅允许 `customer_consultation` |
| content | string | 是 | 原始聊天文本 |
| submitted_at | string(datetime) | 是 | 提交时间（ISO 8601） |
| timezone | string | 否 | 默认 `Asia/Shanghai` |
| submitted_by | string | 否 | 提交人 |
| dry_run | boolean | 否 | 默认 `true` |

**响应 202**

```json
{
  "ingestion_id": "ing_...",
  "status": "received",
  "idempotent_replay": false
}
```

---

### 3.2 GET /v1/ingestions/:id

查询任务详情。响应中的敏感字段（手机号、微信、原始文本）会做脱敏处理。

**响应 200**

```json
{
  "ingestion_id": "ing_...",
  "status": "pending_review",
  "source_system": "feishu_form",
  "source_record_id": "rec_001",
  "source_type": "chat_text",
  "target_domain": "customer_consultation",
  "content": "你好，我想拍一套写真，预算3000元左右。... [truncated]",
  "submitted_at": "2026-07-15T10:00:00.000Z",
  "timezone": "Asia/Shanghai",
  "dry_run": true,
  "attempt_count": 1,
  "warnings": [],
  "errors": [],
  "duplicate_candidates": [],
  "created_at": "2026-07-15T10:00:01.000Z",
  "updated_at": "2026-07-15T10:00:01.000Z"
}
```

---

### 3.3 POST /v1/internal/ingestions/:id/candidate

Dify Workflow 通过 HTTP 回调将 LLM 结构化结果回写到 Collator Core。

**认证头**

| Header | 说明 |
|--------|------|
| `x-collator-timestamp` | 秒级 Unix 时间戳 |
| `x-collator-signature` | HMAC-SHA256(`${timestamp}.${rawBody}`, `COLLATOR_WEBHOOK_SECRET`) |

签名有效期为 ±5 分钟，重放请求会被拒绝。

**请求体**

`fields` 同时接受英文键（Dify 默认输出）与中文键（人工审核场景）。服务在执行 Pipeline 前会通过 `mapCustomerCandidate()` 将英文键映射为中文规范 Schema（详见 §6）。

```json
{
  "candidate": {
    "schema_name": "customer",
    "schema_version": "1.0.0",
    "prompt_version": "1.0.0",
    "fields": {
      "budget": "3000-5000元"
    },
    "field_confidence": {
      "budget": 0.95
    },
    "evidence": {
      "budget": "预算3000元左右"
    }
  },
  "workflow_run_id": "dify-run-001"
}
```

**响应 200（Pipeline 成功）**

```json
{
  "ingestion_id": "ing_...",
  "status": "pending_review",
  "review_record_id": "<opaque-id>"
}
```

`review_record_id` 为不透明字符串：内存模式下为 UUID，飞书模式下为真实 Base `record_id`。调用方不得假设任何前缀（如 `rec_review_`）。

**响应 200（Pipeline 失败）**

```json
{
  "ingestion_id": "ing_...",
  "status": "validation_failed",
  "review_record_id": ""
}
```

Pipeline 失败时不会创建审核记录；任务 `errors` 中携带以 `stage` 为 `field` 的错误条目，调用方可通过 `GET /v1/ingestions/:id` 查看错误证据。

同一 `ingestion_id` 重复回调（含并发）只生成一条审核记录，所有调用返回同一 `review_record_id`。进程重启后再次回调同样返回已持久化的 `review_record_id`，不重新跑 Pipeline。

---

### 3.4 POST /v1/ingestions/:id/approve

人工审核通过。`corrections` 用于人工修正字段值。`corrections` 中的键必须使用中文规范 Schema（与 `normalized_fields` 一致，详见 §6.1）。

**请求体**

```json
{
  "reviewer_id": "reviewer_1",
  "review_record_id": "<opaque-id>",
  "corrections": {
    "预算区间": "5000-8000元",
    "拍摄时间": "2026-08-01"
  }
}
```

**响应 200**

```json
{
  "ingestion_id": "ing_...",
  "status": "completed",
  "review_decision": "modified",
  "normalized_fields": {
    "预算区间": "5000-8000元",
    "拍摄时间": "2026-08-01"
  }
}
```

---

### 3.5 POST /v1/ingestions/:id/reject

人工审核拒绝。被拒绝的记录不会写入客户主表。

**请求体**

```json
{
  "reviewer_id": "reviewer_1",
  "reason_code": "INSUFFICIENT_INFO",
  "reason": "缺少联系方式，无法跟进。"
}
```

**响应 200**

```json
{
  "ingestion_id": "ing_...",
  "status": "review_rejected",
  "review_decision": "rejected",
  "error_code": "INSUFFICIENT_INFO",
  "error_message": "缺少联系方式，无法跟进。"
}
```

---

## 4. 状态机

```
received
    |
    v
candidate_received   (Dify 回调后，进入 Candidate 字段映射与确定性清洗)
    |        \
    v         v
pending_review    validation_failed
    |  \            (Pipeline 失败，不创建审核记录)
    v   v
completed   review_rejected
```

- `pending_review`：审核记录已创建，等待人工审核。`review_record_id` 不透明（内存模式为 UUID；飞书模式为真实 Feishu Base `record_id`），调用方不得假设任何前缀（如 `rec_review_`）。
- `validation_failed`：Pipeline 失败，未创建审核记录，`review_record_id` 为空字符串。任务仍持久化以保留 Candidate 与错误证据。
- `completed`：审核通过，可进入客户主表写入阶段（Phase 3）。
- `review_rejected`：审核拒绝，终止流程，不写入业务主表。

---

## 5. 幂等规则

| 场景 | 行为 |
|------|------|
| 同一请求重复 20 次 | 只生成一个 `ingestion_id` |
| Candidate 回调重复 20 次（含并发） | 只生成一条 `review_record_id`，所有调用返回同一 ID |
| 已拒绝记录再次 reject | 返回当前状态，不重复写入 |
| 已完成记录再次 approve/reject | 返回 409 CONFLICT |
| 进程重启后再次回调 | 若任务已存在 Candidate，返回已持久化的 `review_record_id`（不重新跑 Pipeline） |

---

## 6. Candidate 字段映射（TASK-002）

Dify Candidate 可使用英文或中文字段键；服务在执行 Pipeline 前会通过 `mapCustomerCandidate()` 统一映射为中文规范 Schema。

### 6.1 规范字段映射

| 英文键 | 中文键 |
|--------|--------|
| `customer_name` | `客户姓名` |
| `contact` | `联系方式` |
| `source_channel` | `来源渠道` |
| `consultation_time` | `咨询时间` |
| `shooting_type` | `拍摄类型` |
| `budget` | `预算区间` |
| `style_preferences` | `意向风格` |
| `follow_up_notes` | `跟进记录` |
| `review_record` | `好评记录` |

### 6.2 映射规则

1. **中英同时存在且值不同**：中文字段值优先，任务 `warnings` 增加 `CANDIDATE_FIELD_CONFLICT`。
2. **中英同时存在且值相同**：等同单一字段，不产生警告。
3. **仅英文字段存在**：转换为对应中文键后写入 `normalized_fields`。
4. **未知字段**（不在上表）：被丢弃，任务 `warnings` 增加 `UNMAPPED_CANDIDATE_FIELD`，`field` 为原键名。
5. **映射为纯函数**：输入对象不被修改，相同输入产生深度相等的输出。

### 6.3 Pipeline 证据持久化

成功路径创建审核记录时，以下 Pipeline 字段以 JSON 形式存入审核记录的 `validation` 对象，便于人工审核时回溯：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pipelineVersion` | string | 清洗管道版本（当前 `2c.1.0`） |
| `stages` | `PipelineStageRecord[]` | 4 个阶段的执行状态 |
| `validation` | `RecordValidationResult \| null` | 规则校验结果 |
| `corrections` | `Correction[]` | 清洗过程中的修正记录 |
| `warnings` | `string[]` | Pipeline 警告 |
| `errors` | `PipelineError[]` | Pipeline 错误（成功路径应为空） |
| `qualityReport` | `QualityReport \| null` | 质量评估报告 |

任务本身的 `warnings` 仅记录映射阶段警告；Pipeline 错误会以 `{field: stage, code, message}` 形式记入任务 `errors`，使用 `stage` 作为 `field` 标识。

---

## 7. 安全边界

- 回调接口必须携带有效 HMAC 签名，否则返回 401。
- 签名使用 `COLLATOR_WEBHOOK_SECRET`，不硬编码于源码。
- 日志中对手机号、微信、原始聊天文本做脱敏。
- V1 所有业务写入必须经过飞书人工审核，`AUTO_COMMIT_ENABLED=false`。
- `review_record_id` 在飞书模式下为真实 Base `record_id`；不得将其作为业务主键暴露给外部系统。

---

## 8. Gate C-LLM 阻塞说明

Gate C-LLM（Dify Candidate 真实生成路径）目前受 Dify 凭据阻塞，无法在真实环境中端到端验证。本合同所描述的 Candidate 回调契约以 Dify Workflow 输出为准；服务端实现不依赖 Dify 可达性，可在内存模式下完整执行映射、Pipeline 与审核记录创建流程。一旦 Dify 凭据到位，仅需启用真实 Workflow 即可端到端打通，无需服务端代码变更。
