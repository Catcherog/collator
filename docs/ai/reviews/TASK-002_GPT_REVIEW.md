# TASK-002 GPT Review — Commit `94f0199`

## Verdict

`MVP_FAIL`

TASK-003 remains blocked. Trae must apply only the P0 fixes below and their direct regression tests, rerun the specified verification, then return the new commit for GPT re-review.

## Review Baseline

- Base: `26fb51531c5fdff1aa792be622a0e4720497d164`
- Head: `94f0199a657ff883c1fdd63a84d23a2b21388a39`
- Branch: `phase/3-feishu-integration`
- Review date: 2026-07-18

## P0 Blockers

### P0-01: Nested Candidate PII bypasses API response redaction

**Evidence**

- `src/server/routes/ingestions.ts` passes the complete task to `redactObject()`.
- `src/server/security/redaction.ts` only handles top-level string values; nested objects and arrays are returned unchanged.
- TASK-002 stores contact data below `candidate.fields` and `candidate.evidence`.
- Local reproduction against the built service returned:

```json
{"topLevelContentRedacted":true,"nestedCandidatePhoneLeaked":true}
```

**Impact**

`GET /v1/ingestions/:id` has no application-level authentication and can return an unmasked customer phone number. This violates `docs/API_CONTRACT.md` §3.2 and the TASK-002 sensitive-warning/error acceptance criterion. It is an explicit security P0.

**Minimum fix**

- Make response redaction recursively traverse plain objects and arrays without mutating the stored task.
- Redact phone/WeChat/raw-text values at any nesting level.
- Sanitize mapper warning `field` and `message` values before persistence/response so an attacker-controlled unknown key cannot carry PII or a local path through the warning object.
- Do not remove raw evidence from repository storage; the fix applies at the response/log boundary.

**Required regression tests**

- An HTTP integration test creates a task, posts a Candidate containing a phone number in `fields` and `evidence`, calls `GET /v1/ingestions/:id`, and asserts the serialized response contains no original phone number.
- Cover a sensitive unknown-field key/value inside `warnings[]`.
- Assert repository data still retains the original evidence after the redacted GET response is produced.

### P0-02: Original Candidate evidence and unknown fields are discarded

**Evidence**

- `mapCustomerCandidate()` correctly excludes unknown keys from `mappedFields`.
- `IngestionService` then replaces `req.candidate.fields` with `mappedFields` and persists only that canonicalized Candidate to the task and review.
- No untouched raw Candidate snapshot is stored.

**Impact**

`docs/ai/tasks/TASK-002.md` requires unknown fields to remain in the original Candidate while never entering business writes. Current behavior irreversibly loses audit evidence and directly contradicts the accepted task specification.

**Minimum fix**

- Persist an untouched deep copy of `req.candidate` as raw evidence in the task snapshot and successful review evidence.
- Keep the canonical mapped Candidate separate and use only `mappedFields` for `runCleaningPipeline()` and `normalized_fields`.
- Reuse the existing Feishu JSON evidence columns; do not add or modify real Base fields for this fix.

**Required regression tests**

- An unknown Candidate field remains byte-for-byte/deep-equal in raw evidence after processing.
- The same unknown field is absent from canonical Pipeline input and `normalized_fields`.
- Replay after constructing a new service/repository instance returns the same review and retains raw evidence.

### P0-03: Full Pipeline evidence is not persisted on the task

**Evidence**

- Successful tasks store mapper warnings and mapped Pipeline errors, but omit Pipeline warnings, corrections, validation, stages, quality report, and Pipeline version.
- Failed tasks create no review record and therefore lose nearly all Pipeline evidence.
- The unit test named `persists mapping and pipeline warnings on the task` checks only a mapper warning.

**Impact**

This violates the TASK-002 In Scope requirement to persist Pipeline corrections, warnings, errors, and validation results to both the task and the review record. The failure path loses the evidence needed for audit and diagnosis.

**Minimum fix**

- Add one typed Pipeline-evidence snapshot to `IngestionTask` containing `pipelineVersion`, `stages`, `validation`, `corrections`, `warnings`, `errors`, and `qualityReport`.
- Persist it on both Pipeline success and failure.
- Keep mapper warnings distinguishable from Pipeline warnings; do not silently overwrite either source.
- The successful review record may keep the same evidence object to avoid duplicate transformation logic.

**Required regression tests**

- Inject non-empty Pipeline warnings, corrections, validation, and errors and assert the task snapshot retains them.
- Cover both success and `validation_failed` paths.
- Reconstruct a service/repository instance and prove the task evidence is durable.

## P1 Debt / TASK-003 Input

These items do not expand the current P0 fix but must be recorded and handled at the stated boundary:

1. `FeishuReviewRepository.create()` is check-then-create; idempotency is only guaranteed inside one `IngestionService` instance. Record a single-instance deployment constraint or add a durable uniqueness/lock design before multi-replica deployment.
2. `approve()` and `reject()` currently update only the task, not the review record. TASK-003 explicitly owns the review status flow and must update reviewer/decision/corrections/status consistently.
3. Candidate conflict comparison uses `JSON.stringify`, so object key order can produce a false conflict. Treat as P2 unless Candidate values are expanded beyond current MVP shapes.
4. Add runtime validation when reconstructing a `ReviewRecord` from Feishu instead of relying only on casts. Handle actual Base single-select response shapes in the Gate D integration path.

## Verification Required After Fix

Run and record actual exit codes:

```text
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:coverage
npm run build
npm run evaluate
git diff origin/main -- src/data-cleaning
git diff --check
```

Expected: all npm commands exit 0; Gate C-Core remains 50/50 PASS; Legacy diff has no output; all three P0 regression groups pass.

## Stop Condition

After Trae commits and pushes the P0 fix, stop and request GPT re-review. Do not start TASK-003 until GPT changes the TASK-002 verdict to `MVP_PASS` or `MVP_PASS_WITH_DEBT`.

---

## 2026-07-18 Re-review — Commit `9dc7817`

### Verdict

`MVP_FAIL`

P0-02 and P0-03 are accepted. P0-01 is only partially fixed: recursive traversal, phone masking, and mapper-warning phone/path sanitization work, but non-phone WeChat IDs still pass through the GET response unchanged. TASK-003 remains blocked.

### Accepted fixes

- **P0-02 — ACCEPTED**: `raw_candidate` preserves a deep copy of the original Candidate on success and failure; the canonical mapped Candidate remains separate; review evidence retains `validation.rawCandidate`; replay tests pass.
- **P0-03 — ACCEPTED**: `pipeline_evidence` persists `pipelineVersion`, `stages`, `validation`, `corrections`, `warnings`, `errors`, `qualityReport`, and `success` on success and `validation_failed`; mapper warnings remain separate.

### Remaining P0-01: WeChat IDs are not redacted

**Repository evidence**

- `src/server/security/redaction.ts` recognizes keys containing `wechat`, `微信`, or `联系方式` as sensitive.
- For those string values it still calls only `redactPhone()`. A non-phone WeChat ID therefore remains unchanged.
- `docs/API_CONTRACT.md` §3.2 promises that phone, WeChat, and raw-text fields are redacted.
- `docs/PHASE2_DATA_CONTRACTS.md` section 5 requires a WeChat ID to retain its first and last two characters and replace the middle with `*`.

**Fresh built-service reproduction**

The review built Commit `9dc7817`, posted a signed Candidate with `contact: "wechat_secret_01"`, then queried `GET /v1/ingestions/:id`:

```json
{"callbackStatus":200,"getStatus":200,"wechatIdLeaked":true}
```

Direct `redactObject()` reproduction also returned all three values unchanged:

```json
{"candidate":{"fields":{"wechat":"zhangsan001","微信":"lisi_model","联系方式":"wx_secret_01"}}}
```

**Impact**

GET `/v1/ingestions/:id` has no application-level authentication and can expose a customer's WeChat identifier. This is the same security boundary as original P0-01, not a new scope item.

### Minimal fix packet

1. Add a focused `redactWechatId()` helper implementing the accepted rule: preserve the first and last two characters and replace the middle with `*`; define deterministic behavior for IDs of length 4 or less without returning the original secret.
2. In recursive redaction, distinguish raw-text keys, phone-only values, and WeChat/contact keys. Sensitive WeChat/contact string values must mask both phone numbers and non-phone WeChat IDs.
3. Do not redact stored `raw_candidate` or review evidence; apply masking only at response/log boundaries.
4. Add unit tests for nested `wechat`, `微信`, and `联系方式` values, including arrays and a short ID.
5. Add one HTTP regression test that posts `contact: "wechat_secret_01"`, calls GET, asserts the raw ID is absent, asserts the expected masked form is present, and proves repository/review evidence remains unchanged.

Do not change P0-02/P0-03, do not start TASK-003, and do not perform unrelated refactoring.

### Fresh verification evidence

| Command / check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` | exit 0; 260/260 passed, 28 files |
| `npm run test:integration` | exit 0; 32/32 passed, 3 files |
| `npm run test:coverage` | exit 0; Lines 85.28%, Branches 81.95%, Functions 88.53% |
| `npm run build` | exit 0 |
| `npm run evaluate` | exit 0; Gate C-Core 50/50, all four metrics 100% |
| `npm run audit:legacy` | exit 0; 62 modules |
| `git diff origin/main -- src/data-cleaning` | exit 0; no output |
| `git diff --check` | exit 0 |
| Built HTTP WeChat reproduction | failed security expectation; `wechatIdLeaked: true` |

### Stop condition

Trae must commit and push only this P0-01 residual fix and direct tests, then request GPT re-review. TASK-003 remains `NOT STARTED — BLOCKED BY TASK-002`.

---

## 2026-07-18 Re-review — Commit `09f12fa`

### Verdict

`MVP_FAIL`

The single-value case from the `9dc7817` review is fixed: `contact: "wechat_secret_01"` is masked and stored evidence is unchanged. P0-02 and P0-03 remain accepted. P0-01 is still open because two valid Candidate shapes leak the same WeChat ID through GET.

### P0-01A: Mixed phone and WeChat string leaks the WeChat ID

**Evidence**

`redactContactValue()` returns immediately when `redactPhone()` changes the value. For:

```text
电话13800138000 微信wechat_secret_01
```

the built code returns:

```text
电话138****8000 微信wechat_secret_01
```

The phone is masked but the WeChat ID remains. A signed Candidate callback and subsequent GET both returned 200 and the HTTP response contained `wechat_secret_01` (`secretLeaked: true`).

### P0-01B: Contact arrays lose their sensitive-key context

**Evidence**

`redactValueDeep()` applies contact-specific handling only when the direct property value is a string. When `fields.contact` or `fields.联系方式` is an array, recursion processes each element as a generic string and calls only `redactPhone()`.

A signed Candidate with:

```json
{"contact":["wechat_secret_01"]}
```

completed the callback with HTTP 200; GET returned HTTP 200 and still contained `wechat_secret_01` (`secretLeaked: true`). `CandidateRecord.fields` intentionally accepts unknown JSON values, so this is a reachable response path.

### Impact

Both findings are direct variants of original P0-01: attacker-controlled Candidate data crosses an unauthenticated GET response boundary without the promised WeChat redaction. They are not new product scope.

### Minimal fix packet

1. Propagate a redaction mode/context through recursion. Once a property key is classified as contact/WeChat-sensitive, every nested string beneath that value—including array elements and nested objects—must use contact redaction.
2. Make contact-string handling fail closed. It must not stop after masking a phone if any remaining contact content can expose a WeChat ID. For mixed or ambiguous free text, masking the whole contact value or returning a fixed redacted placeholder is acceptable; returning any unmasked residual contact token is not.
3. Preserve existing behavior for a pure phone value and the accepted first/last-two rule for a pure WeChat ID where safely distinguishable.
4. Keep repository and review evidence unchanged; redaction remains response/log-boundary only.
5. Add unit tests for:
   - a contact string containing both phone and WeChat ID;
   - `contact` / `联系方式` arrays of strings;
   - nested objects/arrays beneath a contact key;
   - non-mutation of the input.
6. Add HTTP regressions for both reproduced payloads and assert repository/review evidence retains the originals.

Do not modify P0-02/P0-03, do not start TASK-003, and do not perform unrelated refactoring.

### Fresh verification evidence

| Command / check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| targeted redaction + ingestion tests | exit 0; 41/41 passed |
| `npm run test` | exit 0; 271/271 passed, 28 files |
| `npm run test:integration` | exit 0; 33/33 passed, 3 files |
| `npm run test:coverage` | exit 0; Lines 85.44%, Branches 82.13%, Functions 88.63% |
| `npm run evaluate` | exit 0; Gate C-Core 50/50, all four metrics 100% |
| `git diff origin/main -- src/data-cleaning` | exit 0; no output |
| `git diff --check` | exit 0 |
| mixed contact HTTP reproduction | failed security expectation; `secretLeaked: true` |
| contact-array HTTP reproduction | failed security expectation; `secretLeaked: true` |

### Stop condition

Trae must commit and push only the two P0-01 direct fixes and regression tests, then request GPT re-review. TASK-003 remains blocked.

---

## 2026-07-18 Re-review — Commit `69ce7d5`

### Verdict

`MVP_FAIL`

The two exact payloads from the `09f12fa` review are fixed: the mixed phone+WeChat string fails closed and a direct contact array inherits contact redaction. Repository/review evidence remains unchanged, and P0-02/P0-03 remain accepted. The broader acceptance requirement is not yet met because parent contact mode can still be downgraded by a nested sensitive-key name. Independent Gate A verification also exposed a data-dependent structural-ID mutation.

### Accepted portions

- P0-01A exact reproduction: `电话13800138000 微信wechat_secret_01` no longer returns either raw token.
- P0-01B direct array reproduction: `contact: ["wechat_secret_01"]` returns `we************01`.
- Pure phone formatting and the accepted pure WeChat first/last-two rule remain covered.
- P0-02/P0-03 were not changed by the implementation diff and remain accepted.
- `HEAD` and `origin/phase/3-feishu-integration` both resolve to `69ce7d59902f6404ee3de4de46b8b37bd28461dd`; the worktree was clean before review commands.

### P0-01C: Nested sensitive-key names override parent contact mode

`redactValueDeep()` passes `mode='contact'` into arrays and objects, but its direct-string sensitive-key branch explicitly ignores the parent mode and selects behavior from the child key. A nested `content`/`原始文本` key therefore calls `redactContent()` and a nested `phone`/`mobile` key calls `redactPhone()`; neither masks a non-phone WeChat ID.

Fresh built-code reproductions all returned `leaked: true`:

```text
contact: { content: "wechat_secret_01" }
contact: { phone: "wechat_secret_01" }
联系方式: { 原始文本: "wechat_secret_01" }
contact: { mobile: "wechat_secret_01" }
```

This is reachable over HTTP: Candidate `fields` is `z.record(z.unknown())`, the raw Candidate is persisted on the task, and GET passes the full task through `redactObject()`. It violates the prior requirement that every nested string beneath a contact/WeChat key use contact redaction.

Minimum fix:

1. Make inherited `contact` mode authoritative for every descendant string; nested keys must not downgrade it.
2. Add unit tests for conflicting nested key names plus input non-mutation.
3. Add one signed callback + GET regression and assert repository/review originals remain unchanged.

### P0-04: Response redaction can mutate structural ingestion IDs

Default recursion applies `redactPhone()` to every string, including `ingestion_id`. During the fresh integration run, GET returned a different ID:

```text
expected: ing_2e042890392546c19181507170127599
received: ing_2e042890392546c191****7170127599
```

`npm run test:integration` consequently failed 34/35. A later run passed 35/35 because it generated different random IDs, but replaying the fixed ID against the built `redactObject()` deterministically returns `mutated: true`. This breaks the GET API contract.

Minimum fix:

1. Preserve structural identifiers at the response boundary while retaining phone masking for PII-bearing evidence/contact/content values.
2. Add a deterministic regression using the failing ID (or equivalent) and assert GET returns it byte-for-byte unchanged.

### Fresh verification evidence

| Command / check | Result |
|---|---|
| `npm ci` | sandbox attempt EPERM; approved out-of-sandbox retry exit 0, 261 packages |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` | exit 0; 281/281 passed, 28 files |
| `npm run test:integration` | first run exit 1, 34/35; later random-data rerun exit 0, 35/35 |
| `npm run test:coverage` | exit 0; 281/281; Lines 85.49%, Branches 81.99%, Functions 88.73%; `redaction.ts` Lines 95.89%, Branches 85.71% |
| `npm run build` | exit 0 |
| `npm run evaluate` | evaluation exit 0; Gate C-Core 50/50, all four metrics 100% |
| `npm run audit:legacy` | exit 0; 62 modules |
| `git diff origin/main -- src/data-cleaning` | no output |
| `git diff --check` | exit 0 before GPT documentation edits |
| built contact-mode reproductions | failed security expectation; four shapes `leaked: true` |
| built fixed-ID reproduction | failed API expectation; `mutated: true` |

### Scope and stop rule

Fix only P0-01C, P0-04, and their direct regressions. Do not modify P0-02/P0-03, do not start TASK-003, and do not perform unrelated refactoring. Return a new commit for GPT re-review.

---

## 2026-07-18 — Trae P0-01C + P0-04 Fix Applied

- 基线：Commit `69ce7d5`（GPT re-review `MVP_FAIL`，P0-01C 与 P0-04 阻塞）
- 范围：仅修复本文件“2026-07-18 Re-review — Commit `69ce7d5`” fix packet 定义的 P0-01C 与 P0-04 及其直接回归。不修改 P0-02/P0-03，不启动 TASK-003，不做无关重构。

### P0-01C 修复 — 父级 contact mode 对所有后代字符串保持最高优先级

`src/server/security/redaction.ts` `redactValueDeep` 直接字符串分支重构：

- 父 `mode === 'contact'` 时一律 `redactContactValue(v)`，父 `mode === 'content'` 时一律 `redactContent(v)`。
- 嵌套 `content`/`phone`/`mobile`/`原始文本`/`联系方式` 子键不再降级继承的 contact/content 模式。
- `RedactionMode` 与 `redactValueDeep` 文档注释同步更新。

构建产物复现 `contact: { content: "wechat_secret_01" }`、`contact: { phone: "wechat_secret_01" }`、`联系方式: { 原始文本: "wechat_secret_01" }`、`contact: { mobile: "wechat_secret_01" }` 现均返回 `leaked: false`。

### P0-04 修复 — GET 响应中的结构化 ID 逐字节保持不变

`src/server/security/redaction.ts` 新增 `STRUCTURAL_ID_PATTERN` 正则常量 + `isStructuralId(value)` 函数：

- 覆盖 4 种结构化 ID 形态：`<alpha>_<alphanumeric>` 前缀不透明 ID（`ing_<hex>`、`rec_001`、`reviewer_1`）、32 字符 hex（ingestion_id 主体）、64 字符 hex（SHA-256 幂等键）、规范 UUID（含连字符）。
- `redactValueDeep` 顶层字符串分支与对象内字符串分支在 default mode 下优先调用 `isStructuralId(v)`，匹配则原样返回，短路 `redactPhone` 扫描。
- 自由文本（含空格/CJK/多个下划线分隔 token）不匹配，因此嵌入在非敏感自由文本字段中的手机号仍在响应边界被掩码。

构建产物复现失败 ID `ing_2e042890392546c19181507170127599` 现返回 `mutated: false`，逐字节保留。

### 清理

移除 `isSensitiveKey` 函数（P0-01C 重构后不再使用；TypeScript `noUnusedLocals` 报错 TS6133）。`sensitiveKeys` 参数仍保留在 `redactValueDeep` 签名与 `redactObject` 公共 API 中以维持向后兼容。

### 测试

**单元测试**（`tests/unit/security/redaction.test.ts` 新增 18 个，总计 51 个）：

- P0-01C（9 个）：父 contact mode 覆盖 nested `content`/`phone`/`mobile`/`原始文本`/`联系方式` 子键、数组传播、真实 phone 仍被掩码、父 content mode 对称覆盖、输入非变异。
- P0-04（9 个）：失败 ID `ing_2e042890392546c19181507170127599` 逐字节保留、32 字符 hex、canonical UUID、SHA-256、`rec_001`/`reviewer_1`/`run_001` 前缀 ID、free-text 中 phone 仍掩码、纯 phone 仍掩码、数组中 ID 保留、输入非变异。

**HTTP 回归测试**（`tests/integration/ingestions.test.ts` 新增 2 个，总计 20 个）：

- P0-01C：`wechat: { content: 'wechat_secret_01' }` 经签名 callback 入库 → GET 响应不含 `wechat_secret_01`、含 `we************01`；`repository.raw_candidate.fields.wechat` 与 `review.validation.rawCandidate.fields.wechat` 保持原值；GET 不修改存储。
- P0-04：通过 `repository.save()` 注入 `ingestion_id: 'ing_2e042890392546c19181507170127599'` 的任务 → GET 响应含 `"ingestion_id":"ing_2e042890392546c19181507170127599"` 逐字节不变、不含 `ing_2e0428903925****7170127599`；`content` 中的手机号 `13800138000` 仍被掩码为 `138****8000`；repository 存储 ID 与 content 保持原值。

### Gate A + Gate C-Core 验证结果

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `npm ci` | 0 | up to date in 3s |
| `npm run audit:legacy` | 0 | 62 modules（SAFE 4, UNSAFE 57, BLOCKED 1 预期） |
| `npm run typecheck` | 0 | TypeScript 无错误（含 `isSensitiveKey` 移除后无 TS6133） |
| `npm run lint` | 0 | ESLint 无错误 |
| `npm run test` | 0 | 301 passed（28 test files，新增 20 个测试：18 单元 + 2 HTTP 集成） |
| `npm run test:integration` | 0 | 37 passed（3 test files，新增 2 个 HTTP 回归） |
| `npm run test:coverage` | 0 | All files Lines 85.6% / Branches 82.26% / Funcs 88.73%；redaction.ts Lines 97.43% / Branches 88.73% / Funcs 100% |
| `npm run build` | 0 | `dist/` 构建成功 |
| `npm run evaluate` | 0 | Gate C-Core PASS，50/50 case，4 项核心指标 100% |
| `git diff origin/main -- src/data-cleaning` | 0 | 无输出（Legacy 源码零修改） |
| `git diff --check` | 0 | 无空白错误 |

### 修改文件

- `src/server/security/redaction.ts` — P0-01C 父 mode 优先 + P0-04 `STRUCTURAL_ID_PATTERN`/`isStructuralId` + 移除 `isSensitiveKey`
- `tests/unit/security/redaction.test.ts` — 新增 18 个单元测试
- `tests/integration/ingestions.test.ts` — 新增 2 个 HTTP 回归测试 + `IngestionTask` 类型 import
- `docs/ai/tasks/TASK-002.md` — Status 更新 + Review History 新增 Trae fix section
- `docs/ai/reviews/TASK-002_GPT_REVIEW.md` — 本文件新增 Trae fix section
- `docs/ai/PROJECT_STATE.md` — 状态更新
- `docs/ACCEPTANCE_REPORT.md` — 验收记录追加
- `reports/phase2/legacy-module-profiles.json` — audit:legacy 自动重新生成时间戳

### 下一步

提交新 commit 并 push 到 `origin/phase/3-feishu-integration`，交 GPT 基于 new commit 复核。复核通过前不得启动 TASK-003。
