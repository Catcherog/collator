# TASK-002: 接通 Candidate 映射、CleaningPipeline 与飞书审核记录

## Status

P0 FIX PARTIALLY ACCEPTED — P0-01 CONTACT CONTEXT LEAK REMAINS

## Stage

MVP / Phase 3B

## Dependencies

- TASK-001 完成并通过复审。

## Batch Execution

- Trae 可按 `docs/ai/plans/TASK-002_BATCH_EXECUTION_PLAN.md` 一次连续完成本任务的实现、测试、Gate A、Gate C-Core 回归、文档与 push。
- 执行中无需逐小步等待用户确认；仅在规格冲突、范围必须扩大、测试无法通过或需要新的真实外部凭据时暂停。
- 完成本任务后必须停止在 GPT 复审检查点，不得在 TASK-002 通过复审前开始 TASK-003。

## Objective

把 Dify Candidate 的英文键转换为中文 Schema，执行 Phase 2C 确定性清洗管道，并将候选、标准化结果和校验信息写入飞书审核表。

## Canonical Field Mapping

| Candidate key | 中文 Schema 字段 |
|---|---|
| `customer_name` | `客户姓名` |
| `contact` | `联系方式` |
| `source_channel` | `来源渠道` |
| `consultation_time` | `咨询时间` |
| `shooting_type` | `拍摄类型` |
| `budget` | `预算区间` |
| `style_preferences` | `意向风格` |
| `follow_up_notes` | `跟进记录` |
| `review_record` | `好评记录` |

中文字段允许直接传入。未知字段保留在原始 Candidate 中，但不得进入业务写入，并产生 `UNMAPPED_CANDIDATE_FIELD` warning。中英文同时提供且值冲突时，以中文字段为准并记录 warning。

## In Scope

- 新增无副作用的 Candidate 字段映射层。
- `receiveCandidate()` 调用映射层及 `runCleaningPipeline()`。
- 将 `standardizedRecord` 保存为 `normalized_fields`。
- 将 Pipeline corrections、warnings、errors 和 validation 结果保存到任务与审核记录。
- 新增 `ReviewRepository` 及内存、飞书实现。
- 飞书实现返回真实 Base `record_id` 作为不透明 `review_record_id`。
- Candidate 重放返回原审核记录，不创建第二条。
- Pipeline 阶段异常时进入 `validation_failed`，不创建审核记录。
- 更新 `docs/API_CONTRACT.md`，正式记录英文键、warning 和失败状态语义。

## Out of Scope

- Dify 真实调用。
- 审核通过后的客户表写入。
- 项目、素材、资源等其他 Schema。
- 修改 Legacy 源码或旧 Schema 文件。

## Expected Files

- Create: `src/server/mapping/customer-candidate-mapper.ts`
- Create: `src/server/repositories/review-repository.ts`
- Create: `src/server/repositories/in-memory-review-repository.ts`
- Create: `src/server/repositories/feishu-review-repository.ts`
- Modify: `src/server/services/ingestion-service.ts`
- Modify: `src/server/domain/ingestion.ts`
- Modify: `src/server/app.ts`
- Modify: `docs/API_CONTRACT.md`
- Test: `tests/unit/mapping/customer-candidate-mapper.test.ts`
- Test: `tests/unit/repositories/feishu-review-repository.test.ts`
- Modify/Test: `tests/unit/ingestion-service.test.ts`
- Modify/Test: `tests/integration/ingestions.test.ts`

## Acceptance Criteria

- [x] 英文 Candidate 与等价中文 Candidate 产生相同 Pipeline 标准化结果。
  - 证据：`tests/unit/mapping/customer-candidate-mapper.test.ts` 6 tests PASS；`tests/unit/ingestion-service.test.ts` "produces identical normalized_fields for equivalent English and Chinese candidates" PASS。
- [x] 现有 50 条 Gate C-Core fixture 结果不回归。
  - 证据：`npm run evaluate` 退出码 0；50/50 case PASS；4 项核心指标 100%。
- [x] Pipeline 阶段顺序、不可变性和确定性保持不变。
  - 证据：`tests/unit/cleaning/pipeline/cleaning-pipeline.test.ts` 11 tests + `cleaning-pipeline-error-paths.test.ts` 5 tests PASS；未修改 `src/data-cleaning/**`。
- [x] 成功回调后任务状态为 `pending_review`，并存在真实审核记录。
  - 证据：`tests/integration/ingestions.test.ts` "accepts a signed candidate callback and stores the mapped review record" PASS；reviewRepository.findByIngestionId 返回非 null 记录。
- [x] 20 次相同回调只存在一条审核记录。
  - 证据：`tests/unit/ingestion-service.test.ts` "returns one opaque review_record_id for 20 concurrent identical callbacks" PASS；并发由 `pendingCandidates` Map 串行化。
- [x] 未知字段和字段冲突产生明确 warning，且不会写入业务字段。
  - 证据：`tests/integration/ingestions.test.ts` "records UNMAPPED_CANDIDATE_FIELD warnings on the task" PASS；mapper 单元测试覆盖 `CANDIDATE_FIELD_CONFLICT`。
- [x] Pipeline 阶段异常时状态为 `validation_failed`，不创建审核记录。
  - 证据：`tests/unit/ingestion-service.test.ts` "sets validation_failed and creates no review when pipeline returns success=false" PASS（通过 vi.mock 注入失败路径）。
- [x] warning/error 中的手机号、路径和敏感文本继续脱敏。
  - 证据：未修改 `src/server/security/redaction.ts`；`tests/unit/feishu/feishu-client.test.ts` + `tests/unit/feishu/feishu-errors.test.ts` 仍 PASS；FeishuApiError 通过 `redactPhone` 兜底。
- [x] 新链路不读取旧 Schema 中已漂移的 field ID。
  - 证据：`src/server/mapping/customer-candidate-mapper.ts` 不引用任何 Legacy field ID；`feishu-review-repository.ts` 使用中文表头常量，不依赖旧 Schema。
- [x] `git diff origin/main -- src/data-cleaning` 无输出。
  - 证据：2026-07-18 执行退出码 0，无输出。

## Implementation Constraints

- 映射函数必须是纯函数，不修改传入 Candidate。
  - 验证：`tests/unit/mapping/customer-candidate-mapper.test.ts` "does not mutate nested or top-level input data" + "returns deeply equal results for repeated equal inputs" PASS。
- 审核记录 ID 对调用方是不透明字符串，不依赖 `rec_review_` 格式。
  - 验证：内存仓库使用 `randomUUID()`；飞书仓库使用真实 Base `record_id`；`tests/integration/ingestions.test.ts` 显式断言 `startsWith('rec_review_')` 为 false。
- Candidate 原始 JSON 可用于审核证据，但不得出现在普通应用日志。
  - 验证：`IngestionService` 不调用 console 或 pino 直接打印 candidate JSON；仅存入 task snapshot 与 review record。
- Gate C-LLM 仍保持阻塞，不得用合成 Candidate 宣称真实 LLM 已通过。
  - 验证：`docs/API_CONTRACT.md` §8 "Gate C-LLM 阻塞说明"；`docs/ai/PROJECT_STATE.md` Active Blockers 列出 DEBT-001。

## Verification

Gate A + Gate C-Core 回归（2026-07-18，Phase 3B / TASK-002 最终验证）：

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `npm ci` | 0 | up to date in 2s |
| `npm run audit:legacy` | 0 | 62 modules（SAFE 4, UNSAFE 57, BLOCKED 1 预期） |
| `npm run typecheck` | 0 | TypeScript 无错误（含 postCandidate 类型修复） |
| `npm run lint` | 0 | ESLint 无错误 |
| `npm run test` | 0 | 236 passed（27 test files） |
| `npm run test:integration` | 0 | 31 passed（3 test files） |
| `npm run test:coverage` | 0 | All files 84.94%；关键模块 Lines 全部 ≥80% |
| `npm run build` | 0 | `dist/` 构建成功 |
| `npm run evaluate` | 0 | Gate C-Core PASS，50/50 case，所有指标 100% |
| `git diff origin/main -- src/data-cleaning` | 0 | 无输出（Legacy 源码零修改） |

### 关键模块覆盖率（Phase 3B / TASK-002）

| 模块 | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| server/mapping/customer-candidate-mapper.ts | 100% | 100% | 100% | 100% |
| server/services/ingestion-service.ts | 96.42% | 83.33% | 100% | 96.42% |
| server/repositories/repository-factory.ts | 100% | 100% | 100% | 100% |
| server/repositories/feishu-review-repository.ts | 86.66% | 63.63% | 100% | 86.66% |
| server/repositories/in-memory-review-repository.ts | 85.71% | 83.33% | 85.71% | 85.71% |
| server/repositories/feishu-task-repository.ts | 91.2% | 88.88% | 100% | 91.2% |
| server/feishu/feishu-client.ts | 95.62% | 79.06% | 100% | 95.62% |
| server/cleaning/pipeline/cleaning-pipeline.ts | 100% | 95.65% | 100% | 100% |

### 实现位置

| 任务 | 文件 | Commit |
|---|---|---|
| Task 0a: TASK-001 最终审计 | `docs/ACCEPTANCE_REPORT.md`, `docs/ai/PROJECT_STATE.md`, `docs/ai/tasks/TASK-001.md` | `26fb515` |
| Task 0b: TASK-002 批次计划 | `docs/ai/tasks/TASK-002.md`, `docs/ai/plans/TASK-002_BATCH_EXECUTION_PLAN.md` | `781e712` |
| Task 1: Candidate 字段映射 | `src/server/mapping/customer-candidate-mapper.ts`, `tests/unit/mapping/customer-candidate-mapper.test.ts` | `bda7623` |
| Task 2: 审核记录合同 + 内存仓库 | `src/server/repositories/review-repository.ts`, `src/server/repositories/in-memory-review-repository.ts`, `tests/unit/repositories/in-memory-review-repository.test.ts` | `536ec82` |
| Task 3: 飞书审核仓库 | `src/server/repositories/feishu-review-repository.ts`, `tests/unit/repositories/feishu-review-repository.test.ts` | `64e843a` |
| Task 4: 接入 Mapping/Pipeline/并发幂等 | `src/server/domain/ingestion.ts`, `src/server/services/ingestion-service.ts`, `tests/unit/ingestion-service.test.ts` | `4aeb6e6` |
| Task 5: 生产装配 + API 合同 | `src/server/repositories/repository-factory.ts`, `src/server/config.ts`, `src/server/app.ts`, `tests/unit/repositories/repository-factory.test.ts`, `tests/integration/ingestions.test.ts`, `docs/API_CONTRACT.md` | `83c15f4` |
| Task 6: 全量验证 + 文档 | `tests/integration/ingestions.test.ts`（typecheck 修复）, `reports/phase2/legacy-module-profiles.json`（audit 自动生成）, `docs/ai/tasks/TASK-002.md`, `docs/ai/PROJECT_STATE.md`, `docs/ACCEPTANCE_REPORT.md` | 本次提交 |

### 阻塞项

- **Gate C-LLM**：仍受 DEBT-001（Dify 凭据未配置）阻塞，不在 TASK-002 解决范围。
- **Gate D（飞书集成验收）**：需待 TASK-003（写入日志仓库 + 业务主表写入）完成后才能整体通过。

### 下一步

- 等待 GPT 基于 P0 修复 commit 复审；通过前不得启动 TASK-003。
- GPT 复审判定 `MVP_PASS` 或 `MVP_PASS_WITH_DEBT` 后启动 TASK-003（写入日志仓库 + 业务主表写入）。

## Review History

### 2026-07-18 — GPT Review of Commit `94f0199`

- Verdict: `MVP_FAIL`
- P0-01: 嵌套 Candidate PII 绕过 GET 响应浅层脱敏。
- P0-02: 原始 Candidate 与未知字段证据被映射结果覆盖后丢失。
- P0-03: 完整 Pipeline 证据未持久化到任务，失败路径证据丢失。
- Fix packet: `docs/ai/reviews/TASK-002_GPT_REVIEW.md`
- TASK-003: `NOT STARTED — BLOCKED BY TASK-002 P0 FIX`

### 2026-07-18 — Trae P0 Fix Applied

- 基线：Commit `94f0199`
- 范围：仅修复 3 个 P0 + 直接回归测试，未处理 P1/P2（按修复包指示）。
- **P0-01 修复**：`src/server/security/redaction.ts` 重写 `redactPhone`（修复 +86 前缀，分离捕获组对号码 mask）；新增 `redactValueDeep`（递归遍历对象/数组返回新副本）；重写 `redactObject` 调用 `redactValueDeep`；新增 `sanitizeWarningText`（mapper warning field/message 中 phone + 绝对路径脱敏，PATH_PATTERN 仅匹配 `/...` 或 `C:\...`，避免误匹配 `style_preferences` 等字段名）。新增 `tests/unit/security/redaction.test.ts`（11 tests）；`tests/integration/ingestions.test.ts` 新增 1 个 HTTP 端到端集成测试（POST 嵌套 phone candidate → GET 响应不含原 phone、含 `138****8000`；repository 仍保留 `raw_candidate`；review.validation.rawCandidate 保留原始证据；GET 不修改存储）。
- **P0-02 修复**：`src/server/domain/ingestion.ts` 新增 `raw_candidate?: CandidateRecord` 字段；`src/server/services/ingestion-service.ts` 新增 `deepClone` helper，在 `doReceiveCandidate` 入口 `rawCandidate = deepClone(req.candidate)` 保留原始证据；mapper warnings 经 `sanitizeMapperWarnings` sanitize；成功路径将 `rawCandidate` 嵌入 `review.validation.rawCandidate`（复用飞书 JSON 列，不新增 Base 字段）；失败路径同样保留 `raw_candidate` 到 task。`tests/unit/ingestion-service.test.ts` 新增 4 个测试覆盖 raw_candidate 深拷贝、未知字段不进入 normalized_fields、跨服务实例持久化、mapper warning sanitization。
- **P0-03 修复**：`src/server/domain/ingestion.ts` 新增 `pipeline_evidence?: Record<string, unknown>` 字段；`src/server/services/ingestion-service.ts` 新增 `buildPipelineEvidence` helper（结构化包含 `pipelineVersion`/`stages`/`validation`/`corrections`/`warnings`/`errors`/`qualityReport`/`success`），成功与失败路径均把 `pipeline_evidence` 写入 task；mapper warnings 与 Pipeline warnings 严格区分（mapper 在 `task.warnings` 是 `{field, code, message}`，Pipeline 在 `pipeline_evidence.warnings` 是 `string[]`）。`tests/unit/ingestion-service.test.ts` 新增 4 个测试覆盖成功路径持久化、失败路径持久化、mapper/Pipeline warnings 区分、跨新服务实例持久化。
- **Gate A + Gate C-Core 回归**：全部命令退出码 0；测试 260 passed（28 test files，新增 24 个测试：11 redaction + 13 ingestion-service）；集成测试 32 passed（3 test files，新增 1 个 HTTP 集成测试）；All files Lines 85.28% / Branch 81.95% / Funcs 88.53%；关键模块 Lines 全部 ≥80%（redaction.ts 100%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）；Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出。
- TASK-003：`NOT STARTED — BLOCKED BY TASK-002 GPT RE-REVIEW`

### 2026-07-18 — GPT Re-review of Commit `9dc7817`

- Verdict: `MVP_FAIL`
- P0-02: `ACCEPTED` — `raw_candidate` 与 `review.validation.rawCandidate` 保留原始证据，未知字段不进入 Pipeline/normalized fields，跨实例回放证据仍在。
- P0-03: `ACCEPTED` — 成功与 `validation_failed` 路径均持久化完整 `pipeline_evidence`，mapper/Pipeline warnings 保持区分。
- P0-01: `PARTIALLY FIXED / STILL BLOCKING` — 递归遍历、手机号与 warning phone/path 脱敏已通过；非手机号微信 ID 仍只经过 `redactPhone()`，构建后的 HTTP 复现为 `wechatIdLeaked: true`。
- Fix packet: `docs/ai/reviews/TASK-002_GPT_REVIEW.md` 的 “2026-07-18 Re-review — Commit `9dc7817`”。
- TASK-003: `NOT STARTED — BLOCKED BY TASK-002 P0-01`

### 2026-07-18 — Trae P0-01 Residual Fix Applied

- 基线：Commit `9dc7817`（GPT re-review MVP_FAIL，仅 P0-01 残项阻塞）
- 范围：仅修复 `docs/ai/reviews/TASK-002_GPT_REVIEW.md` 中 2026-07-18 re-review fix packet 定义的 P0-01 残项；不修改 P0-02/P0-03，不顺手重构，不启动 TASK-003。
- **P0-01 残项修复**：
  - `src/server/security/redaction.ts` 新增 `redactWechatId(value)`：保留首尾各 2 字符，中间字符替换为 `*`；长度 ≤ 4 时全掩码（绝不返回原秘密）；空串原样返回。
  - 新增私有 `redactContactValue(value)`：先 `redactPhone`，未匹配则 fallback 到 `redactWechatId`，确保同一 contact 字段中手机号与微信 ID 都被脱敏。
  - `redactValueDeep` 改为三分支：`content`/`原始文本` → `redactContent`；`wechat`/`微信`/`联系方式`/`contact` → `redactContactValue`；其他敏感 key → `redactPhone`。
  - `redactObject` 默认 sensitiveKeys 新增 `contact`（修复 GPT 复审证据中 `evidence.contact` 仍泄露的根因——原列表只有中文 `联系方式`，缺英文 `contact`）。
- **测试**：
  - `tests/unit/security/redaction.test.ts` 新增 6 个 `redactWechatId` 单测（length 16/11/5/4/3/2/1/0 全覆盖）+ 4 个 `redactObject` 递归测试（nested wechat/微信/联系方式/contact、数组、短 ID、phone 优先级）；更新现有 nested phone 测试的 `evidence.contact` 断言。
  - `tests/integration/ingestions.test.ts` 新增 1 个 HTTP 集成回归测试 `P0-01 (residual): GET response redacts non-phone WeChat IDs under contact / 联系方式 without mutating stored evidence`。
- **Gate A + Gate C-Core 回归**：全部命令退出码 0；测试 271 passed（28 test files，新增 11 个测试：6 redactWechatId + 4 redactObject 递归 + 1 HTTP 集成）；集成测试 33 passed（3 test files，新增 1 个 HTTP 集成回归）；All files Lines 85.44% / Branches 82.13% / Funcs 88.63%；关键模块 Lines 全部 ≥80%（redaction.ts 100% / Branch 90.47%, ingestion-service 96.88%, mapping 100%, repository-factory 100%, feishu-review-repository 86.66%, feishu-task-repository 91.2%, feishu-client 95.62%, cleaning-pipeline 100%）；Gate C-Core PASS（50/50 case，4 项核心指标 100%）；`git diff origin/main -- src/data-cleaning` 无输出；`git diff --check` 退出码 0；`npm run audit:legacy` 退出码 0（62 modules）。
- **HTTP 安全复现**：`wechat_secret_01` 在 GET 响应中被脱敏为 `we************01`，repository/review 原始证据保持不变。
- TASK-003：`NOT STARTED — BLOCKED BY TASK-002 GPT RE-REVIEW OF NEW COMMIT`

### 2026-07-18 — GPT Re-review of Commit `09f12fa`

- Verdict: `MVP_FAIL`
- P0-02/P0-03: 保持 `ACCEPTED`，本提交未修改相关实现。
- P0-01: 单一字符串微信 ID 修复通过；仍有两条同源泄露路径：
  - `contact: "电话13800138000 微信wechat_secret_01"` → callback 200 / GET 200 / `secretLeaked: true`。
  - `fields.contact: ["wechat_secret_01"]` → callback 200 / GET 200 / `secretLeaked: true`。
- 根因：`redactContactValue()` 检测到手机号后提前返回，未继续处理同值中的微信 ID；`redactValueDeep()` 遍历数组时未继承父 `contact`/`联系方式` 敏感上下文。
- Fix packet: `docs/ai/reviews/TASK-002_GPT_REVIEW.md` 的 “2026-07-18 Re-review — Commit `09f12fa`”。
- TASK-003: `NOT STARTED — BLOCKED BY TASK-002 P0-01`
