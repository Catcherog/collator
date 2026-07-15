# Collator × Dify × 飞书中台跨窗口实施手册

> 版本：v1.0  
> 日期：2026-07-15  
> 项目角色：GPT 负责架构、范围和验收；Trae 负责代码实施、测试和交付；用户负责提供必要的外部环境与最终生产授权。  
> 本文是跨窗口协作的唯一主手册。新窗口开始时，应同时提供本文、`PROJECT_STATE.md` 和 Trae 主执行提示词。

---

## 0. 使用方式

### 0.1 每个新窗口必须先读取

1. 本手册。
2. `docs/PROJECT_STATE.md`：当前阶段、最近 Commit、测试状态和阻塞项。
3. `docs/DECISIONS.md`：已经锁定的架构决策。
4. `docs/ACCEPTANCE_REPORT.md`：已通过和未通过的验收项。
5. Trae 主执行提示词。

不得依赖上一窗口的对话记忆。代码、状态文件和验收证据才是事实来源。

### 0.2 每次执行结束必须更新

- 当前阶段和完成百分比。
- 本次修改文件。
- Git Commit Hash。
- 实际执行的命令及结果。
- 未完成项、阻塞项和风险。
- 下一窗口的第一项动作。

### 0.3 完成声明规则

只有满足对应阶段的验收门槛，才能将阶段标记为 `DONE`。以下内容不能作为完成证据：

- “代码看起来正确”。
- “理论上可运行”。
- 未执行的测试命令。
- 手写但未在 Dify 导入验证的 DSL。
- 使用 Mock 后声称真实飞书联动已通过。
- 使用解释性架构图代替运行截图。

---

# 1. 项目目标

## 1.1 产品定位

Collator 的产品形态是“数据摄入与质量控制 Agent”，其职责是把聊天、图片、语音和文档中的非结构化信息转成经过清洗、校验、审核和审计的飞书业务数据。

第一版只完成一条可稳定验收的链路：

```text
飞书提交客户聊天文本
→ Collator 创建摄入任务
→ Dify 结构化提取
→ Collator Core 清洗和五重校验
→ 飞书人工审核
→ 确认后写入客户主表
→ 记录写入日志
```

## 1.2 V1 成功标准

V1 不是“支持所有输入”，而是完成一个可重复运行、可审核、不会重复写入的数据入口。

V1 必须证明：

1. 运行不再依赖打开 Trae。
2. Dify 只负责模型编排和结构化提取。
3. Collator Core 负责确定性清洗、校验、幂等和飞书写入。
4. 飞书承担提交入口、人工审核、任务状态、业务主库和日志中心。
5. LLM 不能直接写业务主表。
6. 同一条请求重复提交不会生成重复业务记录。
7. 人工拒绝的数据绝不会进入业务主表。
8. 所有写入可追踪到原始输入、模型版本、Prompt 版本、Schema 版本和审核人。

---

# 2. 已锁定的架构决策

以下决策在 v1.0 中冻结。Trae 不得自行替换；如需变更，必须在 `DECISIONS.md` 提交变更理由、影响范围和迁移方案。

## ADR-001：Trae 仅是开发环境

- Trae 用于阅读代码、修改代码、运行测试和生成交付物。
- 生产运行链路不能依赖 Trae 对话、Trae Rules、Trae Knowledge 自动加载或人工点击 Trae。
- `.trae/Knowledge` 中仍有价值的规则必须迁移到版本化代码、Schema 或文档中。

## ADR-002：V1 不使用 LangChain Agent 或 LangGraph

- Collator Core 不做 ReAct Agent。
- V1 不引入 LangChain、LangGraph 或其他自主工具选择循环。
- Dify 是唯一外层编排器。
- Core 是确定性服务：清洗、Schema 校验、查重、幂等、审核状态和写入。
- 后续只有出现长任务断点恢复、多天人工暂停或复杂子图时，才单独评估 LangGraph。

## ADR-003：保留现有 Node.js 资产，不整体重写 Python

现有 Collator 的主要模块由 Node.js / JavaScript 实现，包括清洗器、规则、Schema、规则学习器和飞书写入逻辑。V1 采用增量改造：

- 语言：TypeScript。
- 运行时：Node.js 20 或更高。
- API：Fastify。
- API 请求/响应边界校验：Zod。
- 业务 JSON Schema 校验：Ajv。
- 测试：Vitest + Fastify `inject()`。
- 日志：Fastify/Pino 结构化日志。
- HTTP 调用：Node 原生 `fetch` 或 Undici。
- 构建：TypeScript 编译。
- 部署：Docker 单服务。

原则：正在使用的 JS 模块先通过适配器接入；修改到的模块逐步迁移 TypeScript，不为了“统一语言”一次性重写全部功能。

## ADR-004：Dify 负责语义提取，不负责业务数据一致性

Dify 内允许：

- 输入变量管理。
- LLM 调用。
- Structured Output。
- 轻量变量转换。
- IF/ELSE。
- 调用 Collator HTTP API。
- 工作流 Trace。

Dify 内禁止：

- 维护 7 张飞书业务表的完整写入规则。
- 直接调用飞书业务主表写入接口。
- 实现状态机、幂等、回滚和重复合并。
- 把核心规则长期放在 Code Node 中。
- 让 Agent 自主选择写入哪张业务表。

## ADR-005：V1 所有业务写入必须人工审核

- 默认 `AUTO_COMMIT_ENABLED=false`。
- 即使 Core 判断数据安全，V1 仍进入飞书审核表。
- 达到第 11 章规定的数据质量门槛后，V1.1 才允许对低风险字段开启自动提交。

## ADR-006：飞书是 V1 的任务状态和业务事实中心

V1 不新增独立 PostgreSQL。采用仓储接口隔离实现：

- 生产：`FeishuTaskRepository`。
- 单元测试：`InMemoryTaskRepository`。
- 本地离线调试：可选 `FileTaskRepository`，但不得作为生产默认。

Core 保持近似无状态，任务状态、审核结果和写入日志存放在飞书多维表。

## ADR-007：开发和生产数据边界

- Dify Cloud 只允许使用合成或完成脱敏的数据。
- 原始客户聊天、手机号、附件和身份信息进入生产流程时，必须使用自托管 Dify，或在调用云端 Dify 前完成不可逆脱敏。
- `.env`、Token、App Secret 不得提交 Git。
- 现有代码中的 Base Token、Table ID、Folder Token 等资源标识全部移入环境配置或私有映射文件，不进入公开源码和官网。

---

# 3. 目标系统架构

```text
┌──────────────────────────────────────────────┐
│ 飞书数据摄入任务表                           │
│ 表单提交：聊天文本、来源、目标业务域、附件    │
└──────────────────────┬───────────────────────┘
                       │ 飞书自动化 Webhook
                       ▼
┌──────────────────────────────────────────────┐
│ Collator Core Service / Gateway              │
│ POST /v1/ingestions                          │
│ - 验签                                       │
│ - 生成 ingestion_id                          │
│ - 计算 idempotency_key                       │
│ - 创建任务记录                               │
│ - 异步调用 Dify                              │
└──────────────────────┬───────────────────────┘
                       │ Dify Workflow API
                       ▼
┌──────────────────────────────────────────────┐
│ Dify Workflow: Collator-V1-Text-Ingestion    │
│ - 接收原始文本                               │
│ - LLM Structured Output                      │
│ - 输出字段、证据片段和字段置信度              │
│ - 回调 Collator Core                         │
└──────────────────────┬───────────────────────┘
                       │ POST candidate callback
                       ▼
┌──────────────────────────────────────────────┐
│ Collator Deterministic Quality Core          │
│ Null → Format → Enum → Default               │
│ 必填 → 格式 → 枚举 → 状态机 → 逻辑一致性     │
│ 查重、关联候选、风险评分                      │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│ 飞书数据审核表                               │
│ 原始内容 / 提取字段 / 证据 / 警告 / 重复候选 │
│ 操作：采纳、修改后采纳、拒绝                  │
└───────────────┬──────────────────┬───────────┘
                │                  │
             approve            reject
                │                  │
                ▼                  ▼
┌─────────────────────────┐  ┌─────────────────┐
│ Feishu Writer           │  │ 任务标记 rejected│
│ 幂等 Upsert 客户主表    │  │ 不产生业务写入   │
└───────────────┬─────────┘  └─────────────────┘
                ▼
┌──────────────────────────────────────────────┐
│ 飞书客户主表 + 数据写入日志表                │
└──────────────────────────────────────────────┘
```

---

# 4. V1 范围与明确不做项

## 4.1 V1 必做

- 客户聊天纯文本输入。
- 单一目标业务域：`customer_consultation`。
- Dify 结构化字段提取。
- 当前四步清洗逻辑接入。
- 当前五重约束校验接入。
- 飞书任务表、审核表、写入日志表。
- 客户主表的幂等创建或更新。
- 人工采纳、修改后采纳、拒绝。
- 结构化运行日志。
- 50 条固定评测集。
- Docker 启动。
- Dify 工作流说明和实际导出文件；若缺少 Dify 环境，必须标记为外部阻塞，不得伪造“导入通过”。

## 4.2 V1 明确不做

- OCR、ASR、CLIP 正式生产链路。
- PDF、Word、Excel 批量摄入。
- 七张业务表全自动路由。
- LangChain / LangGraph Agent。
- 自建审核前端。
- 自动创建项目、资源、素材或内容记录。
- 无人工审核的业务写入。
- 自动学习后直接修改生产同义词库。
- 多实例分布式任务队列。

## 4.3 后续阶段

- V1.1：达到质量阈值后，对低风险客户字段启用自动提交。
- V2：图片 OCR、文档解析和附件处理。
- V3：语音 ASR、批量数据和复杂跨表关联。
- V4：规则学习建议、人工批准后发布新规则。
- V5：满足长任务恢复需求后再评估 LangGraph。

---

# 5. 推荐目录结构

保持现有 `src/data-cleaning/`，不要为了架构美观破坏已有实现。

```text
collator/
├── src/
│   ├── data-cleaning/             # 现有核心模块，逐步 TS 化
│   │   ├── core/
│   │   ├── rules/
│   │   ├── schemas/
│   │   ├── config/
│   │   ├── multimodal/
│   │   └── utils/
│   ├── server/
│   │   ├── app.ts
│   │   ├── config.ts
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── ingestions.ts
│   │   │   ├── review.ts
│   │   │   └── internal-callback.ts
│   │   ├── services/
│   │   │   ├── ingestion-service.ts
│   │   │   ├── validation-service.ts
│   │   │   ├── review-service.ts
│   │   │   └── commit-service.ts
│   │   ├── repositories/
│   │   │   ├── task-repository.ts
│   │   │   ├── feishu-task-repository.ts
│   │   │   └── in-memory-task-repository.ts
│   │   ├── adapters/
│   │   │   ├── dify-client.ts
│   │   │   ├── feishu-client.ts
│   │   │   └── feishu-writer.ts
│   │   ├── domain/
│   │   │   ├── ingestion.ts
│   │   │   ├── candidate.ts
│   │   │   ├── review.ts
│   │   │   └── errors.ts
│   │   └── security/
│   │       ├── signature.ts
│   │       └── redaction.ts
├── dify/
│   ├── README.md
│   ├── workflow-node-spec.md
│   └── collator-v1-text-ingestion.yml  # 只能由真实 Dify 导出后提交
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   └── fixtures/
│       └── customer-consultation-50.jsonl
├── docs/
│   ├── PROJECT_STATE.md
│   ├── DECISIONS.md
│   ├── ACCEPTANCE_REPORT.md
│   ├── API_CONTRACT.md
│   ├── FEISHU_SETUP.md
│   └── OPERATIONS.md
├── scripts/
│   ├── seed-test-data.ts
│   ├── run-evaluation.ts
│   └── verify-no-secrets.ts
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

# 6. 数据模型与状态机

## 6.1 Ingestion 状态

```text
received
→ dispatching
→ extracting
→ candidate_received
→ validating
→ pending_review
→ approved
→ committing
→ completed
```

失败状态：

```text
dispatch_failed
extract_failed
validation_failed
review_rejected
commit_failed
```

补偿状态：

```text
rollback_required
rolled_back
```

不得跳过必要状态。例如 `candidate_received` 不能直接进入 `completed`。

## 6.2 CandidateRecord

Dify 只输出原始语义字段，不输出飞书 Field ID。

```json
{
  "schema_name": "customer_consultation",
  "schema_version": "1.0.0",
  "prompt_version": "dify-customer-v1",
  "fields": {
    "customer_name": "王小姐",
    "phone": null,
    "source_channel_raw": "小红书看到的",
    "shoot_type_raw": "个人写真",
    "preferred_styles_raw": ["复古感觉"],
    "budget_raw": "三千左右",
    "preferred_dates_raw": ["下周三", "下周四"],
    "notes": "希望整体偏复古"
  },
  "field_confidence": {
    "customer_name": 0.96,
    "source_channel_raw": 0.98,
    "budget_raw": 0.73
  },
  "evidence": {
    "customer_name": "我姓王",
    "source_channel_raw": "小红书看到的",
    "budget_raw": "预算三千左右"
  }
}
```

## 6.3 Core 输出

```json
{
  "status": "pending_review",
  "normalized_fields": {
    "customer_name": "王小姐",
    "source_channel": "小红书",
    "shoot_type": "个人写真",
    "preferred_styles": ["复古胶片"],
    "budget_min": 2500,
    "budget_max": 3500,
    "preferred_dates": []
  },
  "errors": [],
  "warnings": [
    {
      "field": "preferred_dates",
      "code": "RELATIVE_DATE_REQUIRES_REFERENCE",
      "message": "相对日期需要基于提交时间和时区确认"
    }
  ],
  "duplicate_candidates": [],
  "write_allowed": false
}
```

`write_allowed` 在 V1 始终为 `false`，必须经过审核。

---

# 7. API 合同

## 7.1 创建摄入任务

`POST /v1/ingestions`

请求：

```json
{
  "source_system": "feishu",
  "source_record_id": "rec_xxx",
  "source_type": "chat_text",
  "target_domain": "customer_consultation",
  "content": "你好，我姓王，小红书看到的……",
  "submitted_at": "2026-07-15T10:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "submitted_by": "ou_xxx",
  "dry_run": true
}
```

响应：HTTP `202`

```json
{
  "ingestion_id": "ing_01J...",
  "status": "received",
  "idempotent_replay": false
}
```

## 7.2 Dify 回传 Candidate

`POST /v1/internal/ingestions/{ingestion_id}/candidate`

必须携带：

- `X-Collator-Timestamp`
- `X-Collator-Signature`

响应：

```json
{
  "ingestion_id": "ing_01J...",
  "status": "pending_review",
  "review_record_id": "rec_review_xxx"
}
```

相同回调重复发送必须返回同一结果，不得重复创建审核记录。

## 7.3 查询状态

`GET /v1/ingestions/{ingestion_id}`

## 7.4 审核通过

`POST /v1/ingestions/{ingestion_id}/approve`

```json
{
  "reviewer_id": "ou_xxx",
  "review_record_id": "rec_review_xxx",
  "corrections": {
    "preferred_dates": ["2026-07-22"]
  }
}
```

## 7.5 审核拒绝

`POST /v1/ingestions/{ingestion_id}/reject`

```json
{
  "reviewer_id": "ou_xxx",
  "reason_code": "NOT_BUSINESS_DATA",
  "reason": "内容不是有效客户咨询"
}
```

## 7.6 健康检查

- `GET /healthz`：进程正常即可通过。
- `GET /readyz`：配置完整，能访问飞书和 Dify 时通过；测试环境允许使用 Fake Adapter。

---

# 8. 幂等、查重与写入规则

## 8.1 Idempotency Key

```text
sha256(
  source_system
  + source_record_id
  + target_domain
  + normalized_content_hash
)
```

规则：

- 同一个 `idempotency_key` 已完成：返回原结果。
- 正在处理：返回当前任务，不重新调用 Dify。
- 失败后重试：复用同一 ingestion，增加 attempt_count。
- 原始内容变化：生成新 key 和新 ingestion。

## 8.2 客户查重

优先级：

1. 标准化手机号完全相同。
2. 已存在的外部平台用户 ID 完全相同。
3. 姓名 + 来源渠道 + 最近有效咨询时间为候选，仅供人工确认。

禁止：仅凭姓名自动合并客户。

## 8.3 写入方式

- V1 只写客户主表。
- 若手机号匹配唯一客户：生成更新计划，等待审核。
- 若无唯一标识：生成新增计划，等待审核。
- 审核通过后 Writer 再执行。
- Writer 必须再次检查任务状态和幂等键。
- 写入成功后保存业务 `record_id`。

## 8.4 回滚

V1 单表写入不执行物理删除回滚。出现提交后异常时：

- 写入日志标记 `rollback_required`。
- 在客户记录设置来源 ingestion_id。
- 人工确认后撤销或修正。

V2 出现跨表写入后，再引入补偿事务。

---

# 9. 飞书多维表设计

## 9.1 数据摄入任务表

同时承担表单入口和任务状态。

必需字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| ingestion_id | 文本，唯一 | Core 生成 |
| idempotency_key | 文本，唯一 | 防重复 |
| 原始文本 | 多行文本 | V1 输入 |
| 来源系统 | 单选 | feishu/wechat/manual |
| 来源记录 ID | 文本 | 飞书原始记录 |
| 目标业务域 | 单选 | V1 固定 customer_consultation |
| 处理状态 | 单选 | 状态机 |
| 提交人 | 人员 | 审计 |
| 提交时间 | 时间 | 解析相对日期 |
| Dify workflow run ID | 文本 | Trace |
| attempt_count | 数字 | 重试次数 |
| 错误码 | 文本 | 失败诊断 |
| 错误信息 | 多行文本 | 脱敏后记录 |
| 业务 record_id | 文本 | 最终客户记录 |

## 9.2 数据审核表

| 字段 | 类型 | 说明 |
|---|---|---|
| ingestion_id | 文本 | 关联任务 |
| 原始内容摘要 | 多行文本 | 脱敏显示 |
| Candidate JSON | 多行文本 | 原始提取结果 |
| Normalized JSON | 多行文本 | 清洗后结果 |
| 字段证据 | 多行文本 | 原文引用 |
| 字段置信度 | 多行文本 | 每字段分数 |
| 错误 | 多行文本 | 阻止提交 |
| 警告 | 多行文本 | 审核确认 |
| 重复客户候选 | 关联/文本 | 不自动合并 |
| 审核状态 | 单选 | 待审核/通过/修改后通过/拒绝 |
| 审核人 | 人员 | 必填 |
| 审核时间 | 时间 | 必填 |
| 修改字段 JSON | 多行文本 | 人工修正 |

## 9.3 数据写入日志表

| 字段 | 类型 |
|---|---|
| log_id | 文本，唯一 |
| ingestion_id | 文本 |
| action | 单选：create/update/reject/error |
| target_table | 文本 |
| target_record_id | 文本 |
| before_snapshot | 多行文本 |
| after_snapshot | 多行文本 |
| schema_version | 文本 |
| prompt_version | 文本 |
| model_name | 文本 |
| workflow_run_id | 文本 |
| reviewer_id | 文本 |
| duration_ms | 数字 |
| result | 单选 |
| error_code | 文本 |
| created_at | 时间 |

## 9.4 规则反馈表

V1 可以建表，但不启用自动发布。所有新规则必须由人工批准，再更新版本化配置。

---

# 10. Dify Workflow 规范

## 10.1 名称

`Collator-V1-Text-Ingestion`

## 10.2 输入

- `ingestion_id`
- `raw_text`
- `target_domain`
- `submitted_at`
- `timezone`
- `callback_url`
- `callback_timestamp`
- `callback_signature`

## 10.3 节点

1. **Start/User Input**：接收变量。
2. **Input Guard**：检查 `target_domain == customer_consultation`、文本非空和长度限制。
3. **LLM Structured Extraction**：使用结构化输出生成 `CandidateRecord`。
4. **Optional Repair**：仅在 JSON Schema 不合格时重试一次；最多一次。
5. **HTTP Request**：回调 Core candidate endpoint。
6. **End**：返回 ingestion_id、callback status 和 workflow run ID。

## 10.4 Prompt 约束

- 只提取原文明确表达的信息。
- 不推断电话号码、真实姓名或精确日期。
- 相对日期保留原始表达，由 Core 结合时区和提交时间处理。
- 每个字段必须附 evidence 原文片段。
- 没有证据的字段返回 `null` 或空数组。
- 不输出飞书 Field ID。
- 不调用飞书写入接口。

## 10.5 Workflow 验收

- 实际 Dify 环境导入成功。
- 10 条标准样例均产生符合 Schema 的输出。
- 非法输入进入明确失败分支。
- Callback 重试不会重复创建审核记录。
- 导出 DSL 保存至 `dify/collator-v1-text-ingestion.yml`。
- 截图必须来自真实 Dify Workflow 和运行 Trace。

缺少可访问的 Dify 环境时，Trae只能完成 Workflow Spec，状态必须是 `BLOCKED_EXTERNAL_ENV`，不能写“Dify 验收通过”。

---

# 11. 验收框架

## 11.1 Gate A：代码基线

必须全部通过：

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
```

要求：

- Core 关键模块行覆盖率 ≥80%。
- 不允许跳过失败测试。
- 不允许把真实飞书访问测试混入默认单元测试。
- `npm audit` 的高危项必须说明并处理；无法处理的需记录风险。

## 11.2 Gate B：API 合同

必须验证：

- 202 创建任务。
- 同一输入重复 20 次只创建一个 ingestion。
- Candidate callback 重放 20 次只创建一条审核记录。
- 非法签名返回 401/403。
- 不存在 ingestion 返回 404。
- 状态机非法跳转返回 409。
- 审核拒绝后 approve 返回 409。
- 已完成任务再次 approve 不重复写入。

## 11.3 Gate C：业务数据质量

固定评测集：至少 50 条脱敏或合成客户咨询。

指标定义：

- 字段准确率 = 正确字段值数 / 可评估字段数。
- 必填字段召回率 = 正确识别的必填字段 / 实际存在的必填字段。
- 枚举映射精确率 = 正确枚举映射 / 所有自动枚举映射。
- 错误拦截率 = 被校验拦截的错误样本 / 所有错误样本。

V1 验收门槛：

| 指标 | 门槛 |
|---|---:|
| 总字段准确率 | ≥90% |
| 必填字段召回率 | ≥95% |
| 枚举映射精确率 | ≥95% |
| 非法枚举写入 | 0 |
| 缺必填字段直接写入 | 0 |
| 测试集重复写入率 | 0 |
| 被拒绝记录写入率 | 0 |

若未达门槛，系统仍可作为人工审核辅助工具，但不得标记“V1 数据质量验收通过”。

## 11.4 Gate D：飞书集成

真实环境必须证明：

1. 飞书表单新增记录能触发 Core。
2. 任务状态按状态机更新。
3. Dify 结果产生一条审核记录。
4. 人工修改后通过，修正值进入客户表。
5. 拒绝后客户表无新增和更新。
6. 同一任务重复触发不会重复写客户表。
7. 写入日志包含 before/after、版本和审核人。
8. 无权限或接口异常时任务进入 `commit_failed`，原数据不丢失。

## 11.5 Gate E：安全与隐私

- 仓库不存在 `.env`、App Secret、Access Token、私钥或真实客户数据。
- `.env.example` 只含占位符。
- 日志中的手机号默认掩码。
- 原始聊天不写普通应用日志。
- Callback 使用时间戳 + HMAC，拒绝过期请求。
- Dify Cloud 测试数据必须是合成或脱敏数据。
- `scripts/verify-no-secrets.ts` 执行通过。

## 11.6 Gate F：可部署和可运行

```bash
docker compose up -d
curl http://localhost:PORT/healthz
curl http://localhost:PORT/readyz
```

要求：

- 新机器按 README 可在 30 分钟内启动。
- 服务重启后飞书任务状态不丢失。
- 未配置生产凭据时默认进入 Fake/Dry Run，不得误写真实表。
- Docker 日志能按 ingestion_id 检索。

## 11.7 Gate G：展示证据

官网或作品集所需证据：

- 飞书提交入口截图。
- Dify Workflow 全图。
- 一条真实 Dify Trace。
- 飞书审核前后字段差异。
- 客户主表最终记录。
- 数据写入日志。
- 50 条评测集报告。
- 一条重复请求幂等测试结果。
- 一条拒绝后零写入测试结果。
- 60—90 秒端到端录屏。

每张图必须标注：真实运行截图 / 测试截图 / 解释性架构图，禁止混淆。

---

# 12. 分阶段实施计划

## Phase 0：基线盘点与冻结

Trae 输出：

- 当前目录树。
- 当前可运行入口。
- 现有测试和实际通过结果。
- 现有 7 个 Schema 清单。
- 飞书资源 ID 和密钥硬编码扫描。
- 需要保留、适配、废弃的模块列表。
- Git 基线 Commit。

验收：无代码功能重写前，完成基线报告并可复现现有行为。

## Phase 1：Core Service 外壳

实现：

- TypeScript 配置。
- Fastify 服务。
- 健康检查。
- 错误模型。
- Zod API Schema。
- InMemory Repository。
- HMAC 验签。
- 结构化日志和脱敏。

验收：Gate A、Gate B 的基础接口通过，不连接真实飞书和 Dify。

## Phase 2：现有清洗和校验接入

实现：

- 复用四步清洗。
- 复用五重校验。
- 客户 Schema Adapter。
- Candidate → NormalizedRecord。
- 50 条固定评测集与评测脚本。

验收：Gate C。

## Phase 3：飞书任务、审核和 Writer

实现：

- FeishuTaskRepository。
- 三张系统表配置和检查脚本。
- 审核通过/拒绝 API。
- 客户表 Upsert。
- 写入日志。
- Dry Run。

验收：使用飞书测试 Base 完成 Gate D，不接生产 Base。

## Phase 4：Dify Workflow

实现：

- Workflow Prompt。
- Structured Output Schema。
- Core callback。
- 错误分支和一次修复重试。
- 真实导出 DSL。

验收：10 条标准样例 + callback replay 测试通过。

## Phase 5：端到端与安全

实现：

- 飞书自动化 Webhook。
- 全链路 E2E。
- Secret scan。
- Docker。
- 运维说明。

验收：Gate A—F 全部通过。

## Phase 6：作品集证据

实现：

- 录屏。
- 评测图表。
- 真实截图。
- 项目状态说明。
- 官网更新材料。

验收：Gate G。

---

# 13. Trae 每阶段交付格式

Trae 每次回复必须包含：

```text
阶段：Phase X
状态：IN_PROGRESS / BLOCKED / DONE
当前 Commit：<hash>

本次完成：
- ...

修改文件：
- path/to/file

执行命令与结果：
- npm run test → 82 passed, 0 failed

验收项：
- [x] ...
- [ ] ...

阻塞项：
- 外部凭据 / 表结构不一致 / Dify 不可访问

风险：
- ...

下一步：
- ...
```

禁止只回答“已完成”。

---

# 14. 外部配置清单

Trae 必须生成 `.env.example`，至少包含：

```dotenv
NODE_ENV=development
PORT=8787
LOG_LEVEL=info

COLLATOR_WEBHOOK_SECRET=replace_me
AUTO_COMMIT_ENABLED=false
DRY_RUN=true

DIFY_BASE_URL=https://your-dify.example.com
DIFY_WORKFLOW_API_KEY=replace_me
DIFY_WORKFLOW_ID=replace_me

FEISHU_APP_ID=replace_me
FEISHU_APP_SECRET=replace_me
FEISHU_BASE_APP_TOKEN=replace_me
FEISHU_INGESTION_TABLE_ID=replace_me
FEISHU_REVIEW_TABLE_ID=replace_me
FEISHU_WRITE_LOG_TABLE_ID=replace_me
FEISHU_CUSTOMER_TABLE_ID=replace_me

DEFAULT_TIMEZONE=Asia/Shanghai
```

实际生产值由用户在本地或部署平台配置，不写进文档和 Git。

---

# 15. 必须生成的文档

- `README.md`：启动、环境变量和本地验证。
- `docs/API_CONTRACT.md`：接口和错误码。
- `docs/FEISHU_SETUP.md`：字段配置、权限、自动化。
- `docs/OPERATIONS.md`：重试、失败恢复和日志查询。
- `docs/PROJECT_STATE.md`：跨窗口状态。
- `docs/DECISIONS.md`：架构决策。
- `docs/ACCEPTANCE_REPORT.md`：验收证据。
- `dify/README.md`：节点、变量和导入方式。

---

# 16. 变更控制

以下变更必须暂停实施并请求确认：

- 引入 LangChain、LangGraph 或 Agent 自主执行。
- 将 Core 改写为 Python。
- Dify 直接写业务主表。
- 开启自动提交。
- 从单一客户业务域扩展到多表自动路由。
- 使用真实客户数据调用云端 Dify。
- 物理删除飞书业务记录。
- 修改已有业务表字段或自动化规则。
- 把 Base Token、Table ID 或凭据写入公开代码。

其他实现细节由 Trae在不改变接口和验收标准的前提下自行决定。

---

# 17. 官方技术依据

- Dify HTTP Request Node：`https://docs.dify.ai/en/use-dify/nodes/http-request`
- Dify Human Input Node：`https://docs.dify.ai/en/use-dify/nodes/human-input`
- Dify Code Node：`https://docs.dify.ai/en/use-dify/nodes/code`
- LangChain Structured Output：`https://docs.langchain.com/oss/python/langchain/structured-output`
- Fastify TypeScript：`https://fastify.io/docs/latest/Reference/TypeScript/`
- Fastify Validation and Serialization：`https://fastify.io/docs/latest/Reference/Validation-and-Serialization/`
- Zod：`https://zod.dev/`
- Ajv JSON Schema：`https://ajv.js.org/guide/getting-started.html`
- Vitest：`https://vitest.dev/guide/`
- 飞书多维表记录查询：`https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search`
- 飞书多维表记录新增：`https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create`
- 飞书多维表概览：`https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview`
