# Collator — Agent 数据清洗与业务写入系统

> 本文档为求职展示材料。所有展示数据均为**匿名合成数据**，不包含真实客户信息、App Secret、Token 或私密凭据。真实环境验证使用飞书测试 Base + 合成记录，记录在验证后已按精确 record_id 清理。

---

## 1. 一句话产品定义

**Collator 是一个将聊天、图片、语音和文档中的非结构化业务信息，转换为可校验、可人工确认、可幂等写入飞书业务系统的 Agent 数据录入产品。**

它在「模型候选字段」和「业务主表」之间插入一层候选字段 + 人工审核 + 状态机 + 幂等写入边界，确保错误数据不进入正式表、同一业务记录不被重复写入、失败结果具备可解释性。

---

## 2. 用户问题

| 维度 | 痛点 |
|------|------|
| 输入分散 | 客户咨询散落在聊天文本、截图、语音、文档附件中，业务字段没有结构化 |
| 重复录入 | 客服需要把同一段对话内容手工抄到飞书多维表，每天重复数百次 |
| 录入错误 | 电话号码、姓名、拍摄类型、预算区间等字段格式不统一，人工录入易错 |
| 重复客户 | 同一客户多次咨询可能被录入两次，污染业务主表 |
| 规则失效 | 必填字段、枚举值、日期格式等业务规则靠人脑记忆，难以稳定执行 |
| 失败不可解释 | 写入失败时只剩一句「飞书报错」，无法定位是字段格式、权限还是状态机问题 |
| 模型不可信 | 直接让 LLM 写入业务系统的方案在真实业务中不可接受 —— 模型可能幻觉字段、漏掉必填项或写入错误枚举值 |

---

## 3. 产品工作流

```text
┌────────────────────────────────────────────────────────────┐
│  多源非结构化输入                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ 聊天文本 │  │  图片   │  │  语音   │  │  文档   │         │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │            │            │            │               │
│       └────────────┴────────────┴────────────┘               │
│                    ↓                                         │
│           OCR / ASR / 文本解析                               │
│       (V1 现网仅启用文本解析; OCR/ASR 为后续能力扩展点)       │
│                    ↓                                         │
│           候选业务字段生成（CandidateRecord）                │
│           ┌─────────────────────────────────┐               │
│           │ schema_name: customer           │               │
│           │ fields: { 客户姓名, 联系方式, ...}│              │
│           │ field_confidence: {}            │               │
│           │ evidence: {}                    │               │
│           └─────────────────────────────────┘               │
│                    ↓                                         │
│           格式与业务规则校验（CleaningPipeline）             │
│           format_clean → enum_map → validate → quality       │
│                    ↓                                         │
│           人工审核与修正（ReviewRecord）                     │
│           pending_review → approved / rejected               │
│                    ↓                                         │
│           幂等写入飞书多维表（CustomerRecordWriter）         │
│           search by Collator 摄入 ID → create with token    │
│                    ↓                                         │
│           状态、日志与结果追踪（WriteLogRecord）            │
│           succeeded / failed / skipped_dry_run               │
└────────────────────────────────────────────────────────────┘
```

**关键设计：候选字段与人工审核层位于模型与业务主表之间。**

模型不会直接写入业务主表。模型输出的是「候选字段」，经过格式校验、业务规则校验、人工审核三道关卡后，才由幂等写入器写入飞书业务表。任何一道关卡失败，候选字段都不会进入业务主表，而是被记录为 `validation_failed` 或 `commit_failed` 状态，附带完整 Pipeline 证据供人工排查。

---

## 4. 系统边界

**V1 在做的：**

- 处理 `customer_consultation`（客户咨询）纯文本管道
- 接收聊天文本输入，输出标准化客户记录到飞书客户主表
- 显式状态机：`received → pending_review → approved → committing → completed`（或 `validation_failed` / `commit_failed`）
- 幂等写入：`Collator 摄入 ID` 技术幂等键 + 飞书 `client_token` 服务端幂等
- 写入审计：每次写入产生一条 `WriteLogRecord`（succeeded/failed/skipped_dry_run）

**V1 不做的：**

- 不调用 Dify 或 LLM 真实联调（Gate C-LLM 标记为 `BLOCKED_EXTERNAL_ENV`，未配置 Dify 凭据）
- 不写入业务主表之外的其他业务表（订单表、拍摄执行表、模特表等）
- 不修改 Legacy `src/data-cleaning/` 源码（`git diff origin/main -- src/data-cleaning` 无输出）
- 不自动审核、不自动提交（`AUTO_COMMIT_ENABLED=false`，dry-run 为默认）
- 不做跨进程并发锁、分布式事务、消息队列、复杂重试框架

---

## 5. 非结构化输入案例

### Case 1：正常成功案例（匿名合成数据）

**输入（聊天文本，匿名合成）：**

```text
"你好，我想咨询亲子拍摄。我姓张，电话 13800000000。
预算大概 1000-2000 元，喜欢日系清新风格。
之前在小红书看到你们的样片，来源选「其他」就行。"
```

**Agent 候选字段（CandidateRecord.fields，已脱敏）：**

```json
{
  "schema_name": "customer",
  "schema_version": "1.0.0",
  "fields": {
    "客户姓名": "GateD测试客户",
    "联系方式": "13800000000",
    "来源渠道": "其他",
    "拍摄类型": "亲子",
    "预算区间": "1000-2000元",
    "意向风格": "日系清新",
    "跟进记录": "COLLATOR_GATE_D_TEST:<uuid>"
  },
  "field_confidence": {},
  "evidence": {}
}
```

**注意：** 上述合成数据中 `客户姓名 = GateD测试客户` 是 Gate D Runner 使用的匿名占位符，不对应任何真实客户。电话 `13800000000` 是国标测试号码。`跟进记录` 携带 `COLLATOR_GATE_D_TEST:` 前缀 + UUID，便于按精确 record_id 清理测试数据。

---

## 6. 候选字段与人工审核

### 6.1 候选字段生成（Case 1 续）

候选字段由模型/解析层产出，英文键通过 `customer-candidate-mapper.ts` 映射为中文规范 Schema（9 个键 → 9 个中文业务字段）。映射是纯函数，immutable，不修改原始输入。

```text
英文 raw 键       →    中文规范字段
-------------------------------
customer_name     →    客户姓名
contact           →    联系方式
source_channel    →    来源渠道
shoot_type        →    拍摄类型
budget_range      →    预算区间
preferred_style   →    意向风格
consultation_time →    咨询时间
follow_up_note    →    跟进记录
review_note       →    好评记录
```

### 6.2 人工审核前后的字段变化

**审核前（候选字段，pending_review 状态）：**

| 字段 | 候选值 | 来源 |
|------|--------|------|
| 客户姓名 | GateD测试客户 | 模型提取 |
| 联系方式 | 13800000000 | 模型提取 |
| 来源渠道 | 其他 | 模型提取 |
| 拍摄类型 | 亲子 | 模型提取 |
| 预算区间 | 1000-2000元 | 模型提取 |
| 意向风格 | 日系清新 | 模型提取 |
| 跟进记录 | COLLATOR_GATE_D_TEST:\<uuid\> | 测试标识 |

**人工修正（corrections，可选）：**

审核员发现候选值基本正确，但希望补充 `咨询时间` 字段：

```json
{
  "corrections": {
    "咨询时间": "2026-07-21T14:30:00+08:00"
  }
}
```

corrections 会经过与候选字段相同的映射、清洗、校验流程，确保人工修正也符合业务规则。

**审核后（approved 状态）：**

| 字段 | 最终值 |
|------|--------|
| 客户姓名 | GateD测试客户 |
| 联系方式 | 13800000000 |
| 来源渠道 | 其他 |
| 拍摄类型 | 亲子 |
| 预算区间 | 1000-2000元 |
| 意向风格 | 日系清新 |
| 跟进记录 | COLLATOR_GATE_D_TEST:\<uuid\> |
| 咨询时间 | 2026-07-21T14:30:00+08:00 |
| **Collator 摄入 ID** | ing_<uuid-redacted>（技术幂等键，非业务字段） |

`Collator 摄入 ID` 是技术幂等键，由 Agent 写入客户表的隐藏文本字段，**不复用任何业务字段承载该值**。

### 6.3 飞书写入后的结构化记录

写入飞书客户主表后，跨 Repository 实例读回的字段（来自 Gate D 真实运行）：

```json
{
  "客户姓名": "GateD测试客户",
  "联系方式": "13800000000",
  "来源渠道": "其他",
  "拍摄类型": "亲子",
  "预算区间": "1000-2000元",
  "意向风格": ["日系清新"],
  "跟进记录": "COLLATOR_GATE_D_TEST:<uuid>",
  "Collator 摄入 ID": "ing_<uuid-redacted>"
}
```

**关键细节：** 飞书 MultiSelect 字段（`意向风格`）返回 `["日系清新"]` 数组形态，写入器在 create 时把 bare string 包装为单元素数组，避免飞书 `MultiSelectFieldConvFail`（code=1254063）。

### 6.4 状态迁移结果

```text
received → pending_review → approved → committing → completed
                                                      ↓
                                          business_record_id=recXXX
                                          write_log.status=succeeded
```

任务最终 `status=completed`，`business_record_id` 已设置，`error_code` 已清空，写入日志 `status=succeeded`。

---

## 7. 业务规则拦截案例

### Case 3：业务规则拦截失败案例（匿名合成数据）

**输入（候选字段，故意缺失必填项）：**

```json
{
  "schema_name": "customer",
  "fields": {
    "客户姓名": "测试缺失联系方式",
    "拍摄类型": "亲子",
    "预算区间": "1000-2000元"
  },
  "field_confidence": {},
  "evidence": {}
}
```

**拦截原因：** 候选字段缺失必填项 `联系方式`。CleaningPipeline 的 `validate` 阶段检测到必填字段召回率不达标，整个候选被标记为 `validation_failed`。

**Pipeline 证据（持久化到 task.pipeline_evidence）：**

```json
{
  "pipelineVersion": "1.0.0",
  "success": false,
  "stages": [
    { "name": "format_clean", "status": "succeeded" },
    { "name": "enum_map_clean", "status": "succeeded" },
    { "name": "validate", "status": "failed",
      "errors": ["required field 联系方式 is missing"] },
    { "name": "quality_assessment", "status": "skipped" }
  ],
  "validation": {
    "field_accuracy": 0.66,
    "required_field_recall": 0.75,
    "error_interception_rate": 1.0
  },
  "warnings": [],
  "errors": ["required field 联系方式 is missing"]
}
```

**任务状态：**

```text
received → validation_failed
              ↓
   task.pipeline_evidence 完整保留
   review record NOT created（验证失败不创建审核记录）
```

**用户如何修正：**

1. 审核员查看 `task.pipeline_evidence.errors`，发现 `联系方式` 缺失
2. 审核员要求客服回补客户电话，或直接拒绝该候选
3. 若有补充数据，发起一次新的 `createIngestion` 请求（不同 ingestion_id），重新走完整管道
4. **不通过 corrections 修复缺失必填项** —— corrections 用于已通过验证的候选的人工微调，不用于修复 Pipeline 拒绝的候选

**修正后是否允许继续：** 重新提交包含 `联系方式` 的候选后，Pipeline 重新运行 `format_clean → enum_map → validate → quality` 四阶段，全部通过后任务进入 `pending_review`，审核员可继续走 approve 流程。

### 其他可拦截的失败场景

| 失败场景 | 拦截位置 | 任务状态 |
|---------|---------|---------|
| 缺少必填字段 | validate 阶段 | validation_failed |
| 日期格式非法（如 `2026/13/45`） | format_clean 阶段 | validation_failed |
| 来源记录 ID 缺失 | createIngestion 入参校验 | HTTP 400 |
| 候选字段违反业务规则（如预算区间不在枚举内） | enum_map_clean / validate | validation_failed |
| 状态不允许写入（如对 `received` 状态直接 approve） | service.approve 状态门禁 | HTTP 409 ConflictError |
| 重复请求触发幂等保护 | writer replay / write_log.create idempotency | 第二次 approve 抛 CONFLICT，writer replay 返回 created=false |

---

## 8. 飞书写入与幂等机制

### 8.1 三层幂等防御

| 层级 | 机制 | 代码位置 | 作用 |
|------|------|---------|------|
| 服务层 | `pendingApprovals` Map 实现 per-ingestion approve 串行化 | `ingestion-service.ts` | 同一 ingestion_id 的并发 approve 在进程内串行 |
| 应用层 | `Collator 摄入 ID` 隐藏文本字段，写入前 `searchRecords` 查重 | `customer-record-writer.ts` | 跨进程重启的快速 replay 路径 |
| 服务端 | 飞书 `client_token`（UUIDv4，sha256 派生）| `feishu-client.ts:createStableClientToken` | 跨进程并发的最终幂等边界 |

### 8.2 幂等写入流程

```text
approve(ingestionId)
      ↓
task.status: pending_review → approved → committing
      ↓
CustomerRecordWriter.write({ ingestionId, normalizedFields })
      ↓
Step 1: searchRecords by 'Collator 摄入 ID'
      ├── 找到记录 → return { business_record_id, created: false }  (replay)
      └── 未找到   → Step 2
      ↓
Step 2: createRecord(fields, client_token)
      client_token = createStableClientToken(
        `customer-record:${tableId}:${ingestionId}`
      )
      ↓
return { business_record_id, created: true }
      ↓
task.status: committing → completed
write_log.status: succeeded (with client_token-stable idempotency)
```

### 8.3 幂等合同（仅 succeeded 状态去重）

`FeishuWriteLogRepository.create()` 仅对 `succeeded` 状态的日志去重 —— 同一 `(ingestion_id, target_table_id)` 元组下已有 succeeded 日志时，retry 返回原日志，不创建新条目。对于 `failed` / `pending` / `skipped_dry_run` 状态，每次创建新条目，保留完整审计轨迹（commit_failed 重试时，第一次失败和后续成功各有独立日志）。

### 8.4 真实环境幂等复验

Gate D 第五次真实运行的 Step 9 验证 writer replay：

```text
第二次调用 writer.write({ ingestionId, normalizedFields })
      ↓
searchRecords by 'Collator 摄入 ID' → 找到 record_id=recXXX
      ↓
return { business_record_id: recXXX, created: false }
```

**真实飞书租户验证结果：** 同一 ingestion_id 的第二次写入调用返回相同的 `business_record_id`，`created=false`，未产生重复客户记录。

---

## 9. 产品验证证据（Evidence Card 1/3）

### 目标用户

- 摄影工作室客服、店长、运营人员
- 需要把客户咨询信息录入飞书业务系统的非技术用户

### 原始痛点

- 客户咨询信息散落在聊天、图片、语音、文档中，人工抄录耗时
- 录入错误率高（电话、姓名、拍摄类型格式不统一）
- 同一客户重复咨询被录入两次，污染业务主表
- 业务规则靠人脑记忆，难以稳定执行

### 用户任务流

1. 客服收到客户咨询（聊天/图片/语音/文档）
2. 客服或上游系统把非结构化内容提交给 Collator（`POST /v1/ingestions`）
3. Collator 调用解析层（V1 仅文本）产出候选字段
4. 候选字段经过 CleaningPipeline 校验
   - 通过：任务进入 `pending_review`，等待人工审核
   - 失败：任务进入 `validation_failed`，附带完整 Pipeline 证据
5. 审核员查看候选字段，可选择 approve（可附 corrections）或 reject
6. approve 后 Collator 幂等写入飞书客户主表，任务进入 `completed`
7. 失败时（如飞书暂时不可达）任务进入 `commit_failed`，可使用相同审核记录重试

### 为什么需要人工确认

模型可能产生以下不确定性：

- 幻觉字段（编造客户姓名、电话）
- 漏掉必填项
- 枚举值不在业务允许范围内
- 把多个客户的信息混在一起
- 把过时信息当成最新信息

直接让模型写入业务主表的方案在真实业务中不可接受。Collator 在模型与业务主表之间插入候选字段层，让审核员在 `pending_review` 状态下看到候选值的完整证据（包括 Pipeline warnings、corrections、validation errors），再决定是否approve。

### 产品如何减少重复录入

- 候选字段自动从非结构化输入提取，无需人工逐字段抄录
- 审核员只需在候选字段基础上做最小修正（corrections），不需要重新录入全部字段
- 同一 ingestion_id 的重复请求不产生重复审核记录
- 同一 ingestion_id 的重复 approve 抛 CONFLICT 409，不重复写入

### 失败时如何解释和恢复

| 失败类型 | 任务状态 | 证据保留 | 恢复路径 |
|---------|---------|---------|---------|
| 候选字段校验失败 | validation_failed | `task.pipeline_evidence` 完整保留 | 重新提交包含缺失字段的候选（新 ingestion_id） |
| 飞书 API 暂时不可达 | commit_failed | 写入日志 `status=failed` + 脱敏错误消息 | 使用相同 review_record_id 重试 approve |
| 飞书业务错误（如字段类型不匹配） | commit_failed | 写入日志含 `error_code` + `redacted_error_message` | 修正候选字段后重新走流程 |
| 写入日志持久化失败 | commit_failed | `COMMIT_AUDIT_FAILED` 错误码 | fail-closed，不进入 completed |

所有失败状态都附带可解释的错误码和脱敏后的错误消息，不泄露内部堆栈、Secret 或 PII。

---

## 10. 工程验证证据（Evidence Card 2/3）

### 输入标准化

- **API 入口**：`POST /v1/ingestions` 接收 `source_system / source_record_id / source_type / target_domain / content / submitted_at / timezone / submitted_by / dry_run` 字段
- **HMAC 签名**：所有 callback 请求需携带 `X-Collator-Signature` + `X-Collator-Timestamp`，服务端使用 `COLLATOR_WEBHOOK_SECRET` 做 HMAC-SHA256 验签 + 时间戳重放防护
- **source_type 枚举**：`chat_text / chat_image / voice_message / document_attachment / manual_entry`
- **target_domain 枚举**：V1 仅 `customer_consultation`
- **dry_run 默认 true**：未显式设置 `dry_run=false` 时不写客户表，写入日志状态为 `skipped_dry_run`

### OCR / ASR 接入边界

- V1 现网仅启用纯文本解析管道
- OCR / ASR 是后续能力扩展点，不在 V1 范围内
- API 合同已为多模态输入预留 `source_type` 枚举值

### 候选字段生成

- **CandidateRecord 结构**：`schema_name / schema_version / prompt_version / fields / field_confidence / evidence`
- **英文键映射**：`customer-candidate-mapper.ts` 把 9 个英文 raw 键映射为 9 个中文规范字段，纯函数，immutable
- **映射后产物**：`normalized_fields`（中文键 Record）+ `warnings`（未知字段警告，已脱敏）
- **原始证据保留**：`raw_candidate` 深拷贝保留在 `review.validation.rawCandidate`，复用飞书 JSON 列，不新增 Base 字段

### 规则校验（CleaningPipeline）

- **阶段固定顺序**：`format_clean → enum_map_clean → validate → quality_assessment`
- **不可变性**：每个阶段 deepClone 输入，返回新对象，输入对象不被修改
- **确定性**：相同输入 + 配置 + Adapter 版本 → 深度相等的输出
- **错误标准化**：Adapter / Legacy 模块异常统一转换为 `PipelineError`，含 stage / module 标识
- **失败传播**：阶段失败后后续阶段标记为 `skipped`，不静默吞错
- **脱敏**：错误信息中手机号脱敏为 `1**********`，不输出原始客户聊天文本

### 状态机

```text
received ──┬──> validation_failed (Pipeline 拒绝)
           │
           ├──> pending_review ──┬──> approved ──> committing ──┬──> completed
           │                     │                              │
           │                     │                              └──> commit_failed
           │                     │                                      │
           │                     │                                      └──(重试)──> committing
           │                     │
           │                     └──> rejected
           │
            └─> (重复请求) ──> 幂等返回已有 task
```

**状态门禁**（service.approve）：
- 仅 `pending_review / commit_failed / approved / committing` 可进入 approve
- `received / validation_failed / rejected / completed` 上的 approve 抛 CONFLICT 409
- `pendingApprovals` Map 实现 per-ingestion approve 串行化

### 幂等键

| 层级 | 键 | 范围 |
|------|----|----|
| 服务层 | ingestion_id | 单进程内 approve 串行化 |
| 应用层 | `Collator 摄入 ID`（隐藏文本字段）| 跨进程重启 replay |
| 服务端 | 飞书 `client_token`（UUIDv4）| 跨进程并发最终边界 |
| 服务层（write_log）| (ingestion_id, target_table_id, succeeded) | 仅 succeeded 状态去重 |

### Repository 分层

```text
┌──────────────────────────────────────────────────────────┐
│  Service 层（IngestionService）                          │
│  - 状态机、approve 串行化、Pipeline 证据持久化          │
└────────────┬─────────────────────────────────────────────┘
             │ 依赖接口（不依赖具体实现）
             ↓
┌──────────────────────────────────────────────────────────┐
│  Repository 接口层                                        │
│  TaskRepository / ReviewRepository / WriteLogRepository  │
│  CustomerRecordWriter                                    │
└────────────┬─────────────────────────────────────────────┘
             │
             ↓
┌──────────────────────────────┬───────────────────────────┐
│  内存实现（测试用）           │  飞书实现（生产用）        │
│  InMemoryTaskRepository      │  FeishuTaskRepository     │
│  InMemoryReviewRepository    │  FeishuReviewRepository   │
│  InMemoryWriteLogRepository  │  FeishuWriteLogRepository │
│                              │  FeishuCustomerRecordWriter│
└──────────────────────────────┴───────────────────────────┘
             │
             ↓
┌──────────────────────────────────────────────────────────┐
│  FeishuClient（共享 HTTP 客户端）                          │
│  - tenant_access_token 缓存 + 60s 提前刷新                │
│  - HTTP 401 单次刷新重试 + 业务码 99991663 单次刷新重试    │
│  - text_field_as_array=false（降低响应结构波动）          │
│  - 错误统一包装为 FeishuApiError，手机号脱敏              │
└──────────────────────────────────────────────────────────┘
```

### 自动化测试覆盖

| 测试层 | 数量 | 关键覆盖 |
|-------|------|---------|
| 单元测试 | 446 个（33 test files） | Pipeline / Repository / Writer / Redaction / Mapper / Normalize |
| 集成测试 | 47+ 个（4 test files） | HTTP 端到端 / 跨 Repository 实例读取 / Gate D mock |
| Gate C-Core 评测 | 50 case / 50 passed | field_accuracy 132/132 / required_field_recall 91/91 / enum_precision 33/33 / error_interception_rate 1/1 |
| Gate D 真实飞书 | 25 断言 / 25 passed | createIngestion → receiveCandidate → approve → 飞书读回 → 跨实例读回 → 重复 approve 幂等 → writer replay 幂等 → cleanup |

**关键模块行覆盖率（Gate A 口径 ≥80%）：**

| 模块 | Lines |
|------|-------|
| normalize-text.ts | 100% |
| customer-record-writer.ts | 100% |
| repository-factory.ts | 100% |
| cleaning-pipeline.ts | 100% |
| mapping | 100% |
| feishu-write-log-repository.ts | 98.05% |
| ingestion-service.ts | 98.14% |
| feishu-client.ts | 96% |
| feishu-task-repository.ts | 91.2% |
| feishu-review-repository.ts | 86.66% |

### PII 脱敏不变量

- `redaction.ts` 实现单调脱敏敏感性（contact > content > default）
- 父级 contact 模式不会被任何子键降级
- 嵌套 contact/联系方式/wechat/微信 key 升级为 contact 模式
- 结构化 ID（如 `ing_xxx`、UUID）逐字节保留，但仅在 7 个可信响应合同 ID 字段下放行
- Candidate `fields` / `evidence` 中的 `<prefix>_<phone>` 不被放行
- 自由文本中的手机号仍在响应边界被掩码

---

## 11. 真实环境验证证据（Evidence Card 3/3）

### 使用匿名合成数据

Gate D Runner（`scripts/run-gate-d.ts`）使用以下匿名合成数据：

```text
客户姓名: GateD测试客户           ← 占位符，不对应真实客户
联系方式: 13800000000             ← 国标测试号码
来源渠道: 其他                    ← 业务枚举值
拍摄类型: 亲子                    ← 业务枚举值
预算区间: 1000-2000元             ← 业务枚举值
意向风格: 日系清新                ← 业务枚举值
跟进记录: COLLATOR_GATE_D_TEST:<uuid>  ← 测试标识，便于清理
```

### 真实调用飞书接口

- **应用身份**：飞书自建应用（App ID 已脱敏，仅写入 `.env`，不进入 Git）
- **目标 Base**：飞书多维表测试 Base（App Token 仅写入 `.env`）
- **目标表**：4 张表（摄入任务表 / 审核任务表 / 写入日志表 / 客户主表），表 ID 仅写入 `.env`
- **凭据范围**：8 个必需环境变量（`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_BASE_APP_TOKEN` / 4 个 `FEISHU_*_TABLE_ID` / `COLLATOR_WEBHOOK_SECRET`）
- **运行命令**：`npm run gate:d`（先加载 `.env` 到 Process 环境变量后执行）
- **报告输出**：`artifacts/feishu-gate-d/gate-d-report.md` + `gate-d-report.json`（被 `.gitignore` 忽略，不入库）

### 首次写入结果

```text
Step 1: createIngestion → status=received ✅
        ingestion_id = ing_<uuid-redacted>
        ingestion_record_id = recXXX（已脱敏）

Step 2: receiveCandidate → status=pending_review ✅
        review_record_id = recXXX（已脱敏）

Step 3: approve → status=completed ✅
        business_record_id = recXXX（已脱敏）
        error_code = (undefined)

Step 4: 跨 Repository 实例读回客户记录 ✅
        客户姓名 == GateD测试客户
        联系方式 == 13800000000
        来源渠道 == 其他
        拍摄类型 == 亲子
        预算区间 == 1000-2000元
        意向风格 == ["日系清新"]  ← MultiSelect 数组形态
        跟进记录 matches COLLATOR_GATE_D_TEST:
        Collator 摄入 ID == ingestion_id

Step 5: 跨 Repository 实例读回 task ✅
        task.status == completed
        task.business_record_id matches

Step 6: 写入日志存在 status=succeeded ✅
        log.business_record_id matches
        log.target_table_id == customer table

Step 7: 审核记录持久化 ✅
        review.candidate.fields['客户姓名'] == GateD测试客户
```

### 第二次幂等复验结果

```text
Step 8: 重复 approve 抛 ConflictError (409) ✅
        duplicate approve code=CONFLICT
        （任务已是 completed 状态，状态机门禁拦截）

Step 9: writer replay（绕过服务层状态机，直接调用 writer.write）✅
        replay returns same business_record_id
        replay returns created=false
        （Collator 摄入 ID 搜索找到已有记录，走 replay 路径）
```

### 状态迁移摘要

```text
received → pending_review → approved → committing → completed
                                                      ↓
                                          business_record_id=recXXX
                                          write_log.status=succeeded
```

首次与第二次执行的差异：

| 执行 | approve 行为 | writer.write 行为 |
|------|-------------|------------------|
| 第一次 | 状态 `pending_review → completed`，创建客户记录 | `created=true`，写入新 record_id |
| 第二次 | 状态机拒绝（CONFLICT 409），不重复写入 | `created=false`，返回同一 record_id |

### 断言数量

**25/25 断言全部通过**，分布在 9 个验证步骤：

| 步骤 | 断言数 | 关键断言 |
|------|-------|---------|
| Step 1 createIngestion | 1 | returns 202-like status |
| Step 2 receiveCandidate | 2 | returns pending_review / review_record_id 非空 |
| Step 3 approve | 3 | status=completed / business_record_id 非空 / error_code 已清空 |
| Step 4 客户记录读回 | 8 | 7 个业务字段逐一比对 + Collator 摄入 ID 比对 |
| Step 5 task 跨实例读回 | 3 | rereadable / status=completed / business_record_id 匹配 |
| Step 6 写入日志 | 3 | succeeded / business_record_id 匹配 / target_table_id 匹配 |
| Step 7 审核记录 | 2 | persisted / candidate 客户姓名 匹配 |
| Step 8 重复 approve | 1 | throws ConflictError (409) |
| Step 9 writer replay | 2 | same business_record_id / created=false |

### 退出码

```text
npm run gate:d
  exit_code = 0  (PASS)
  status     = PASS
  assertions = 25/25 passed
  cleanup    = 4 张表全部 deleted，cleanup_errors=[]
```

### 测试记录清理结果

`finally` 块按本次 API 返回的精确 record_id 在 4 张表中逐一删除合成记录：

| 表 | 记录 ID（脱敏） | 清理结果 |
|----|----------------|---------|
| Collator 摄入任务表 | recXXX（ingestion_record_id） | ✅ deleted |
| Collator 审核任务表 | recXXX（review_record_id） | ✅ deleted |
| 客户主表 | recXXX（business_record_id） | ✅ deleted |
| Collator 写入日志表 | recXXX（write_log_id） | ✅ deleted |

**清理规则严格执行：**

- 只按本次 API 返回的精确 record_id 删除
- 禁止按姓名、手机号或模糊条件批量删除
- 清理失败必须退出失败并报告精确 record ID
- cleanup_errors 不掩盖原始业务失败（两种错误都在报告中保留）

### 之前遗留测试记录的清理验证

第四次 Gate D 尝试（schema 不匹配阻塞时）遗留的 `recXXX`（已脱敏）记录属于 `Collator 摄入任务表`，不是客户主表。RESIDUAL-EVIDENCE-FIX 修正轮使用独立验证脚本调用 `client.getRecord(ingestionTableId, '<precise-record-id>')`，飞书返回 `code=1254043 RecordIdNotFound`，证明该记录已不在摄入任务表（无需删除）。验证脚本使用后已删除。

---

## 12. 数据安全与脱敏

### Secret 范围

以下信息**仅写入 `.env`**（被 `.gitignore` 忽略，不入库）：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_APP_TOKEN`
- 4 个 `FEISHU_*_TABLE_ID`
- `COLLATOR_WEBHOOK_SECRET`

### 不进入公开材料的内容

- `.env` 文件本身
- App Secret / Webhook Secret / Token
- 完整 record ID（公开展示使用 `recXXX` 脱敏形式，完整 record_id 仅在内部报告中且已删除）
- 真实 Base 名称、App ID、客户字段值
- 真实客户姓名、电话、微信、聊天内容
- 内部堆栈跟踪、文件路径、调试日志

### 错误消息脱敏

`FeishuApiError` 在抛出时已经：

- 手机号脱敏为 `1**********` 格式
- 不包含 app_secret
- 不包含 Authorization Header
- 错误消息中 `raw_candidate`、`candidate.fields`、客户聊天原文不出现

`redaction.ts` 在响应边界（GET /v1/ingestions/:id）进一步对响应体做递归脱敏：

- contact / wechat / 微信 / 联系方式 key 下的字符串 fail-closed（剥离手机号/标签/分隔符后残留非空则整体掩码）
- 嵌套 contact 模式不被降级
- 结构化 ID（如 `ing_xxx`、UUID）仅在 7 个可信响应合同 ID 字段下放行
- Candidate `fields` / `evidence` 中的 ID-like 字符串不被放行

### Gate D 报告安全约束

`scripts/run-gate-d.ts` 的安全约束：

- 仅使用合成记录 `GateD测试客户 / 13800000000 / COLLATOR_GATE_D_TEST:<uuid>`
- Secret 不输出到终端、报告、CLI 参数或 `.env` 之外的任何文件
- 清理只能按精确 record_id 在 finally 中进行
- 清理失败时退出码 1 并报告精确 record ID

### 公开展示文案约束

Gate D 已通过时，统一使用：

> 核心服务与真实飞书端到端链路已验证。系统已完成匿名合成数据的首次写入、状态迁移、幂等复验与测试记录清理。

不使用以下措辞（除非有额外证据支持）：

- ❌ "生产环境全面上线"
- ❌ "已服务真实客户"
- ❌ "零错误"
- ❌ "完全自动化"
- ❌ "企业级成熟系统"

---

## 13. 已知限制

| 限制 | 当前状态 | 后续计划 |
|------|---------|---------|
| 仅支持 `customer_consultation` 纯文本管道 | V1 范围 | Phase 4+ 扩展多业务域 |
| 不调用 Dify / LLM 真实联调 | `BLOCKED_EXTERNAL_ENV`（DEBT-001，未配置 Dify 凭据） | 用户提供 Dify 凭据后解锁 Gate C-LLM |
| 不做跨进程并发锁 | V1 范围 | 单进程 `pendingApprovals` Map + 飞书 `client_token` 已足够 |
| 不做分布式事务 | V1 范围 | fail-closed + commit_failed 重试已足够 |
| 不部署 Docker | `NOT_STARTED`（Phase 5） | 待 Phase 5/6 |
| 不提供运行截图 | `NOT_STARTED`（Phase 6） | 待 Phase 6 |
| Legacy `src/data-cleaning/agent/index.js:20` HTML 实体语法错误 | 不修复（DEBT-003） | V1 不依赖旧入口 |
| 硬编码飞书资源 ID 仍存在 | DEBT-005 保持开放 | V1 新链路已不依赖硬编码资源 ID |

---

## 14. 个人职责与产品决策

### 个人职责

- **架构设计与实现**：从 Phase 0 基线盘点到 Phase 3 飞书集成的完整 V1 链路
- **状态机设计**：6 个状态 + 4 个状态门禁 + per-ingestion approve 串行化
- **幂等架构设计**：三层防御（服务层 + 应用层 + 飞书服务端 client_token）
- **Repository 分层**：接口/内存实现/飞书实现分离，依赖注入支持单测
- **测试矩阵设计**：446 个单元测试 + 47 个集成测试 + 50 case 评测 + 25 断言真实 Gate D
- **PII 脱敏不变量**：单调脱敏敏感性 + 可信 ID 上下文 + fail-closed contact 处理
- **飞书 API 兼容性修复**：共享 normalizer 支持 string / {text} / Array<{text}> 三种合法结构
- **Gate D 真实验收**：从 BLOCKED_CREDENTIAL_INVALID → BLOCKED_PERMISSION → BLOCKED_SCHEMA_MISMATCH → 真实 PASS，5 次尝试完整闭环

### 产品决策

#### 决策 1：为什么不直接让模型写入业务系统

模型可能产生幻觉字段、漏掉必填项、把枚举值写到业务范围外、把多个客户信息混在一起。直接写入业务主表的方案在真实业务中不可接受 —— 错误数据会污染业务报表、触发自动化、影响客户跟进。Collator 在模型与业务主表之间插入候选字段层 + 人工审核层，让错误数据停在候选阶段。

#### 决策 2：为什么设置候选字段和人工审核层

候选字段是「模型对业务字段的最佳猜测」，附带 `field_confidence` 和 `evidence`。审核员在 `pending_review` 状态下看到候选值的完整证据（Pipeline warnings、corrections、validation errors），可以做最小修正（corrections）而不是重新录入全部字段。审核通过后，候选字段才进入写入流程。

#### 决策 3：如何处理模型不确定性

- 缺失必填项 → Pipeline `validate` 阶段拒绝，任务进入 `validation_failed`
- 枚举值不在范围内 → Pipeline `enum_map_clean` 阶段标记 warning 或拒绝
- 字段格式非法（如日期）→ Pipeline `format_clean` 阶段拒绝
- 未知字段 → mapper 标记 `UNMAPPED_CANDIDATE_FIELD` warning，不进入 normalized_fields
- 原始证据保留在 `review.validation.rawCandidate`，便于事后追溯

#### 决策 4：如何阻止错误数据进入正式表

四道关卡：

1. **CleaningPipeline 校验**：format / enum / validate / quality 四阶段，失败即 `validation_failed`
2. **人工审核**：审核员在 `pending_review` 状态下决定 approve 或 reject
3. **状态机门禁**：仅 `pending_review / commit_failed / approved / committing` 可进入 approve，其他状态拒绝
4. **CustomerRecordWriter 白名单**：仅写入 9 个业务字段 + `Collator 摄入 ID`，其他字段静默丢弃

#### 决策 5：如何防止同一业务记录重复写入

三层幂等防御：

1. **服务层**：`pendingApprovals` Map 实现 per-ingestion approve 串行化
2. **应用层**：写入前 `searchRecords by Collator 摄入 ID`，找到则返回原 record_id，不创建新记录
3. **飞书服务端**：`createRecord` 调用时携带稳定 UUIDv4 `client_token`，飞书服务端在同一 token 重复提交时返回同一 record_id（即使并发的两个请求都到达 createRecord，也只产生一条记录）

#### 决策 6：如何让失败结果具备可解释性

- **任务状态码**：`validation_failed` / `commit_failed` 明确区分失败类型
- **Pipeline 证据**：`task.pipeline_evidence` 包含 pipelineVersion / stages / validation / corrections / warnings / errors / qualityReport / success
- **写入日志**：`write_log.status` + `error_code` + `redacted_error_message`
- **错误码标准化**：`FEISHU_COMMIT_FAILED` / `CONFLICT` / `COMMIT_AUDIT_FAILED` 等业务可识别错误码
- **脱敏错误消息**：手机号脱敏、不泄露 Secret / Token / 原始客户文本
- **fail-closed**：写入日志持久化失败时不进入 completed，避免「成功但无审计」

#### 决策 7：如何将本地测试升级为真实 SaaS 环境验证

- **从 mock 到真实**：先在 `tests/integration/feishu-gate-d.test.ts` 用 MockFeishuClient 验证合同，再用真实 FeishuClient 跑 `npm run gate:d`
- **从环境变量注入**：8 个必需环境变量从 `.env` 加载，不进入 Git，不输出到终端/报告
- **合成数据**：使用 `GateD测试客户 / 13800000000 / COLLATOR_GATE_D_TEST:<uuid>` 等匿名占位符，不使用真实客户数据
- **精确清理**：finally 块按本次 API 返回的精确 record_id 删除 4 张表记录，禁止按姓名/手机号批量删除
- **退出码语义**：0=PASS / 1=FAIL / 2=ENV_ERROR，自动化系统可按退出码判断
- **报告脱敏**：Gate D 报告（JSON + MD）只包含结构化数据，不包含 Secret / Token / 完整客户聊天文本

---

## 附录：Gate D 真实环境验证执行命令清单

```bash
# 1. 加载 .env 到 Process 环境变量（PowerShell）
# 2. 运行 Gate D
npm run gate:d
# 退出码 0 = PASS，25/25 断言通过，4 张表合成记录已清理
```

## 附录：Gate A 全套验证命令

```bash
npm ci
npm run audit:legacy      # 62 modules, SAFE 4 / UNSAFE 57 / BLOCKED 1（预期）
npm run typecheck
npm run lint
npm run test              # 446/446 passed, 33 test files
npm run test:integration  # 47/47 passed, 4 test files
npm run test:coverage     # 关键模块 Lines 全部 ≥80%
npm run build             # tsc -p tsconfig.json
npm run evaluate          # Gate C-Core 50/50 PASS, 4 项核心指标 100%
git diff origin/main -- src/data-cleaning  # 无输出（LEGACY_DIFF_EMPTY）
git diff --check          # 无冲突标记
```

## 附录：证据文档版本

- 文档创建日期：2026-07-21
- 基线 Commit：`af3cba1`（phase/3-feishu-integration 分支）
- 当前 HEAD：`af3cba1`（未 commit，所有变更在工作区）
- Gate D 真实通过日期：2026-07-21
- 测试总数：446 单元 + 47 集成 + 50 评测 + 25 Gate D 真实断言
