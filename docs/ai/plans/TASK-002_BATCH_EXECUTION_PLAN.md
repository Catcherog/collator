# TASK-002 Candidate Mapping and Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次连续完成 Candidate 中英文字段映射、确定性 CleaningPipeline 接入、审核记录持久化与回调幂等，并在一个 GPT 复审检查点前交付 TASK-002 全部代码、测试、文档和验证证据。

**Architecture:** 在 `IngestionService` 前增加纯函数映射边界，将 Candidate 转换为 Pipeline 所需的中文字段；Pipeline 结果写回任务快照，并通过独立 `ReviewRepository` 保存审核证据。内存与飞书实现遵循同一合同，生产装配继续由 repository factory 管理；同一 ingestion 的并发 Candidate 回调由服务层 promise map 串行化。

**Tech Stack:** Node.js 20、TypeScript、Fastify、Vitest、现有 `FeishuClient`、现有 `runCleaningPipeline()`。

## Global Constraints

- 只执行 `docs/ai/tasks/TASK-002.md` 的 In Scope；不得提前实现 TASK-003 客户表写入。
- 不修改 `src/data-cleaning/**`，最终 `git diff origin/main -- src/data-cleaning` 必须无输出。
- 不访问 Dify，不得把合成 Candidate 的结果宣称为 Gate C-LLM 通过。
- Candidate 原始 JSON 只进入任务快照和审核记录，不进入普通应用日志。
- 未知英文键不得进入 `normalized_fields`；中英文冲突时中文值优先并产生 warning。
- 开始编码前先单独提交当前 3 个 GPT 审计文档，禁止与 TASK-002 代码混入同一 commit。
- Trae 可连续执行本计划全部任务；仅在测试无法通过、规格冲突、需要扩大范围或需要真实外部凭据时暂停。
- TASK-002 完成后必须停止在 GPT 复审检查点；不得直接开始 TASK-003。

---

### Task 0: 隔离 TASK-001 最终审计记录

**Files:**
- Existing modifications: `docs/ACCEPTANCE_REPORT.md`
- Existing modifications: `docs/ai/PROJECT_STATE.md`
- Existing modifications: `docs/ai/tasks/TASK-001.md`

**Interfaces:**
- Consumes: GPT 对 Commit `1217942` 的 `MVP_PASS` 结论。
- Produces: 独立、可追溯的 TASK-001 最终审计 commit；干净工作区供 TASK-002 开始。

- [ ] **Step 1: 核对当前修改仅为三份审计文档**

Run:

```powershell
git status --short
git diff -- docs/ACCEPTANCE_REPORT.md docs/ai/PROJECT_STATE.md docs/ai/tasks/TASK-001.md
```

Expected: 仅上述 3 个文件有修改，内容为 `MVP_PASS` 与最终 Git 扫描记录。

- [ ] **Step 2: 复查三个运行表真实 ID 没有被审计文字重新写入**

Run:

```powershell
$runtimeTableIds = Get-Content -Encoding UTF8 '.env' |
  Where-Object { $_ -match '^FEISHU_(INGESTION|REVIEW|WRITE_LOG)_TABLE_ID=' } |
  ForEach-Object { ($_ -split '=', 2)[1].Trim() }
foreach ($runtimeTableId in $runtimeTableIds) {
  git grep -n -F -- $runtimeTableId
}
```

Expected: 无输出，退出码 1。

- [ ] **Step 3: 单独提交并 push 审计记录**

Run:

```powershell
git add docs/ACCEPTANCE_REPORT.md docs/ai/PROJECT_STATE.md docs/ai/tasks/TASK-001.md
git commit -m "Phase 3A / TASK-001: record final GPT MVP pass"
git push origin phase/3-feishu-integration
```

Expected: commit 和 push 成功；`git status --short` 仅剩 TASK-002 任务入口与本批次计划。

- [ ] **Step 4: 单独提交 TASK-002 批次计划**

Run:

```powershell
git add docs/ai/tasks/TASK-002.md docs/ai/plans/TASK-002_BATCH_EXECUTION_PLAN.md
git commit -m "TASK-002: add continuous execution plan"
git push origin phase/3-feishu-integration
```

Expected: 计划与任务入口进入独立 commit，`git status --short` 再次无输出。

---

### Task 1: 实现无副作用 Candidate 字段映射

**Files:**
- Create: `src/server/mapping/customer-candidate-mapper.ts`
- Create: `tests/unit/mapping/customer-candidate-mapper.test.ts`

**Interfaces:**
- Consumes: `CandidateRecord.fields: Record<string, unknown>`。
- Produces: `mapCustomerCandidate(fields): CandidateMappingResult`。

Required public contract:

```ts
export interface CandidateMappingWarning {
  field: string;
  code: 'UNMAPPED_CANDIDATE_FIELD' | 'CANDIDATE_FIELD_CONFLICT';
  message: string;
}

export interface CandidateMappingResult {
  mappedFields: Record<string, unknown>;
  warnings: CandidateMappingWarning[];
}

export function mapCustomerCandidate(
  fields: Readonly<Record<string, unknown>>
): CandidateMappingResult;
```

Canonical mapping must be an immutable constant containing exactly:

```ts
const CUSTOMER_FIELD_MAP = {
  customer_name: '客户姓名',
  contact: '联系方式',
  source_channel: '来源渠道',
  consultation_time: '咨询时间',
  shooting_type: '拍摄类型',
  budget: '预算区间',
  style_preferences: '意向风格',
  follow_up_notes: '跟进记录',
  review_record: '好评记录',
} as const;
```

- [ ] **Step 1: 先写映射失败测试**

Tests must assert all of the following:

```ts
it('maps the nine canonical English keys to Chinese schema fields');
it('accepts canonical Chinese fields unchanged');
it('keeps the Chinese value and warns when English and Chinese values conflict');
it('drops unknown fields from mappedFields and records UNMAPPED_CANDIDATE_FIELD');
it('does not mutate nested or top-level input data');
it('returns deeply equal results for repeated equal inputs');
```

Run:

```powershell
npx vitest run tests/unit/mapping/customer-candidate-mapper.test.ts
```

Expected: FAIL because mapper module does not exist.

- [ ] **Step 2: 实现最小纯函数映射器**

Implementation rules:

```ts
const chineseFields = new Set(Object.values(CUSTOMER_FIELD_MAP));
const mappedFields: Record<string, unknown> = {};
const warnings: CandidateMappingWarning[] = [];
```

First copy recognized Chinese fields. Then process English keys so an existing Chinese field always wins. Unknown keys only create a warning and are not copied. Return new objects and never assign into `fields`.

- [ ] **Step 3: 运行映射测试**

Run:

```powershell
npx vitest run tests/unit/mapping/customer-candidate-mapper.test.ts
```

Expected: all mapper tests PASS.

- [ ] **Step 4: 提交映射层**

```powershell
git add src/server/mapping/customer-candidate-mapper.ts tests/unit/mapping/customer-candidate-mapper.test.ts
git commit -m "TASK-002: add immutable customer candidate mapping"
```

---

### Task 2: 定义审核记录合同与内存仓库

**Files:**
- Create: `src/server/repositories/review-repository.ts`
- Create: `src/server/repositories/in-memory-review-repository.ts`
- Create: `tests/unit/repositories/in-memory-review-repository.test.ts`

**Interfaces:**
- Consumes: Candidate、Pipeline 标准化结果与 validation 证据。
- Produces: 可由内存和飞书实现共享的审核记录合同。

Required contract:

```ts
import type { CandidateRecord } from '../domain/ingestion.js';

export interface ReviewRecord {
  review_record_id: string;
  ingestion_id: string;
  status: 'pending_review' | 'approved' | 'rejected';
  candidate: CandidateRecord;
  normalized_fields: Record<string, unknown>;
  validation: Record<string, unknown>;
  reviewer_id?: string;
  review_decision?: 'approved' | 'rejected' | 'modified';
  corrections?: Record<string, unknown>;
  updated_at: string;
}

export type NewReviewRecord = Omit<ReviewRecord, 'review_record_id'>;

export interface ReviewRepository {
  findByIngestionId(ingestionId: string): Promise<ReviewRecord | null>;
  create(record: NewReviewRecord): Promise<ReviewRecord>;
  save(record: ReviewRecord): Promise<void>;
}
```

- [ ] **Step 1: 写内存仓库失败测试**

Tests must cover create returning an opaque ID, find by ingestion ID, save updating without duplicating, missing returning null, and defensive deep-copy behavior.

Run:

```powershell
npx vitest run tests/unit/repositories/in-memory-review-repository.test.ts
```

Expected: FAIL because repository modules do not exist.

- [ ] **Step 2: 实现内存审核仓库**

Use two maps: review ID to record and ingestion ID to review ID. Generate IDs with `randomUUID()` but tests must only assert non-empty opaque strings, not a `rec_review_` format.

- [ ] **Step 3: 运行并提交**

```powershell
npx vitest run tests/unit/repositories/in-memory-review-repository.test.ts
git add src/server/repositories/review-repository.ts src/server/repositories/in-memory-review-repository.ts tests/unit/repositories/in-memory-review-repository.test.ts
git commit -m "TASK-002: add review repository contract"
```

Expected: tests PASS and commit succeeds.

---

### Task 3: 实现飞书审核仓库

**Files:**
- Create: `src/server/repositories/feishu-review-repository.ts`
- Create: `tests/unit/repositories/feishu-review-repository.test.ts`

**Interfaces:**
- Consumes: existing `FeishuClient.createRecord/searchRecords/updateRecord` and `ReviewRepository` contract.
- Produces: real Feishu `record_id` as `review_record_id`.

Field constants must be exactly:

```ts
const FIELD = {
  ingestionId: '摄入 ID',
  status: '状态',
  candidate: '候选 JSON',
  normalized: '标准化结果 JSON',
  validation: '校验结果 JSON',
  reviewer: '审核人',
  decision: '审核决定',
  corrections: '人工修正 JSON',
  updatedAt: '更新时间',
} as const;
```

- [ ] **Step 1: 写飞书仓库失败测试**

Tests must verify:

```ts
it('creates a review and uses Feishu record_id as review_record_id');
it('searches by 摄入 ID and reconstructs JSON fields');
it('updates an existing record without creating a second record');
it('writes datetime as epoch milliseconds');
it('throws a descriptive error for malformed JSON without exposing raw candidate content');
```

Run:

```powershell
npx vitest run tests/unit/repositories/feishu-review-repository.test.ts
```

Expected: FAIL because implementation does not exist.

- [ ] **Step 2: 实现飞书仓库**

`create()` must first call `findByIngestionId`; if an existing record exists, return it. Otherwise call `client.createRecord(reviewTableId, fields)` and return the input data plus returned real record ID. `save()` must update by `review_record_id`. All JSON evidence must use `JSON.stringify`; parse failures must mention only field name and record ID.

- [ ] **Step 3: 运行并提交**

```powershell
npx vitest run tests/unit/repositories/feishu-review-repository.test.ts
git add src/server/repositories/feishu-review-repository.ts tests/unit/repositories/feishu-review-repository.test.ts
git commit -m "TASK-002: persist review records in Feishu"
```

Expected: tests PASS and commit succeeds.

---

### Task 4: 接入 Mapping、Pipeline 与并发幂等

**Files:**
- Modify: `src/server/domain/ingestion.ts`
- Modify: `src/server/services/ingestion-service.ts`
- Modify: `tests/unit/ingestion-service.test.ts`

**Interfaces:**
- Consumes: `mapCustomerCandidate()`, `runCleaningPipeline()`, `TaskRepository`, `ReviewRepository`。
- Produces: persisted task snapshot and one review record per ingestion.

Required constructor:

```ts
constructor(
  private readonly repository: TaskRepository,
  private readonly reviewRepository: ReviewRepository
) {}
```

Required concurrency guard:

```ts
private readonly pendingCandidates = new Map<
  string,
  Promise<{ ingestion_id: string; status: string; review_record_id: string }>
>();
```

- [ ] **Step 1: 更新服务测试为显式注入内存审核仓库**

In `beforeEach`, construct both repositories and pass both to `IngestionService`.

- [ ] **Step 2: 写 Candidate 链路失败测试**

Tests must assert:

```ts
it('produces identical normalized_fields for equivalent English and Chinese candidates');
it('persists mapping and pipeline warnings on the task');
it('keeps unknown fields out of normalized_fields');
it('stores pipeline validation and corrections in the review record');
it('sets validation_failed and creates no review when pipeline returns success=false');
it('returns one opaque review_record_id for 20 concurrent identical callbacks');
it('returns the existing review for a replay after a new service instance is created');
```

Run:

```powershell
npx vitest run tests/unit/ingestion-service.test.ts
```

Expected: new tests FAIL against current placeholder review-ID behavior.

- [ ] **Step 3: 实现 receiveCandidate 的最小顺序**

The implementation order must be:

```text
get task
-> return persisted review on replay
-> enter per-ingestion pendingCandidates guard
-> map candidate fields
-> runCleaningPipeline({ schemaKey: 'customer', recordType: task.target_domain, data: mappedFields })
-> on pipeline failure save task as validation_failed and create no review
-> on success create ReviewRecord
-> save task as pending_review with normalized_fields and real review_record_id
-> clear pendingCandidates in finally
```

Convert mapper warnings to the task's existing `{field, code, message}` shape. Convert Pipeline errors to the same shape using `stage` as field. Persist pipeline `validation`, `corrections`, `warnings`, `errors`, `qualityReport`, `stages`, and `pipelineVersion` inside the review record's `validation` object.

- [ ] **Step 4: 运行服务与 Pipeline 回归测试**

```powershell
npx vitest run tests/unit/ingestion-service.test.ts tests/unit/cleaning/pipeline
```

Expected: all selected tests PASS; existing Pipeline stage order and immutability tests remain green.

- [ ] **Step 5: 提交服务接入**

```powershell
git add src/server/domain/ingestion.ts src/server/services/ingestion-service.ts tests/unit/ingestion-service.test.ts
git commit -m "TASK-002: connect candidate pipeline and review workflow"
```

---

### Task 5: 生产装配、配置校验与 API 集成测试

**Files:**
- Modify: `src/server/repositories/repository-factory.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/unit/repositories/repository-factory.test.ts`
- Modify: `tests/integration/ingestions.test.ts`
- Modify: `docs/API_CONTRACT.md`

**Interfaces:**
- Consumes: task and review repository implementations.
- Produces: application wiring for memory and Feishu modes.

- [ ] **Step 1: 增加 FEISHU_REVIEW_TABLE_ID 配置失败测试**

When `TASK_REPOSITORY=feishu`, config and factory must reject an empty `FEISHU_REVIEW_TABLE_ID` with that exact environment variable name in the message. Memory mode must not require Feishu values.

- [ ] **Step 2: 扩展 repository factory**

Export a bundle contract:

```ts
export interface RepositoryBundle {
  taskRepository: TaskRepository;
  reviewRepository: ReviewRepository;
}

export function createRepositories(config: Config): RepositoryBundle;
```

Memory mode returns `InMemoryTaskRepository` plus `InMemoryReviewRepository`. Feishu mode constructs one shared `FeishuClient`, then returns `FeishuTaskRepository` and `FeishuReviewRepository` with their environment-injected table IDs. Keep `createTaskRepository(config)` as a compatibility wrapper if existing tests or callers still import it.

- [ ] **Step 3: 更新 buildApp 注入边界**

Required options shape:

```ts
export interface BuildAppOptions {
  repository?: TaskRepository;
  reviewRepository?: ReviewRepository;
}
```

Tests may inject both in-memory repositories; production calls `createRepositories(config)`. Return both repositories from `buildApp()` for integration assertions.

- [ ] **Step 4: 扩展 HTTP 集成测试**

Verify callback response uses the stored review ID, English Candidate produces Chinese normalized fields, replay returns the same ID, unknown fields produce warnings, and pipeline failure returns task status `validation_failed` without a review.

- [ ] **Step 5: 更新 API 合同**

Document the nine English keys, direct Chinese-key support, `UNMAPPED_CANDIDATE_FIELD`, `CANDIDATE_FIELD_CONFLICT`, opaque `review_record_id`, `validation_failed`, and the statement that Gate C-LLM remains blocked.

- [ ] **Step 6: 运行定向测试并提交**

```powershell
npx vitest run tests/unit/repositories/repository-factory.test.ts tests/integration/ingestions.test.ts
git add src/server/repositories/repository-factory.ts src/server/config.ts src/server/app.ts tests/unit/repositories/repository-factory.test.ts tests/integration/ingestions.test.ts docs/API_CONTRACT.md
git commit -m "TASK-002: wire review repositories into the application"
```

Expected: selected tests PASS and commit succeeds.

---

### Task 6: 全量验证、状态落库与交付

**Files:**
- Modify: `docs/ai/tasks/TASK-002.md`
- Modify: `docs/ai/PROJECT_STATE.md`
- Modify: `docs/ACCEPTANCE_REPORT.md`

**Interfaces:**
- Consumes: completed TASK-002 implementation.
- Produces: one reviewable branch state and objective verification evidence.

- [ ] **Step 1: 运行 Gate A 与 Gate C-Core 回归**

Run each command separately and record its actual exit code:

```powershell
npm ci
npm run audit:legacy
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:coverage
npm run build
npm run evaluate
git diff origin/main -- src/data-cleaning
```

Expected: all npm commands exit 0; evaluation is PASS; Legacy diff has no output.

- [ ] **Step 2: 核对验收标准**

Run:

```powershell
git status --short
git diff --check
git grep -n "lark-cli" -- src/server
$runtimeTableIds = Get-Content -Encoding UTF8 '.env' |
  Where-Object { $_ -match '^FEISHU_(INGESTION|REVIEW|WRITE_LOG)_TABLE_ID=' } |
  ForEach-Object { ($_ -split '=', 2)[1].Trim() }
foreach ($runtimeTableId in $runtimeTableIds) {
  git grep -n -F -- $runtimeTableId
}
```

Expected: only intended TASK-002/document files are modified; `git diff --check` exits 0; production source contains no lark-cli; real runtime IDs have no matches.

- [ ] **Step 3: 更新项目文档**

Set TASK-002 status to `DONE — AWAITING_GPT_REVIEW`, check every acceptance item with command evidence, and update PROJECT_STATE to Phase 3B awaiting GPT review. Do not mark Gate D passed and do not resolve DEBT-002; those belong to TASK-003.

- [ ] **Step 4: 提交并 push TASK-002**

```powershell
git add src tests docs package.json .env.example
git diff --staged --check
git commit -m "Phase 3B / TASK-002: connect candidate mapping and review workflow"
git push origin phase/3-feishu-integration
```

Before committing, remove any path from the staging area that is unrelated to TASK-002. Expected: commit and push succeed.

- [ ] **Step 5: 停止在 GPT 复审检查点**

Trae must report branch, full commit hash, changed files, each verification command and result, coverage, remaining external blockers, and explicitly state: `TASK-003 NOT STARTED — AWAITING GPT REVIEW OF TASK-002`.

---

## Self-Review

- Spec coverage: mapping, Pipeline connection, ReviewRepository memory/Feishu implementations, replay idempotency, failure state, configuration, API contract, Gate C-Core regression, security and Legacy protection are each assigned to an implementation task.
- Scope boundary: no customer-table writer, write-log repository, Gate D runner, Dify call, Docker work, or Legacy modification is included.
- Type consistency: `ReviewRecord`, `NewReviewRecord`, `ReviewRepository`, `CandidateMappingResult`, and `RepositoryBundle` are defined before consumers.
- Checkpoint: TASK-003 remains blocked until GPT reviews the completed TASK-002 commit.
