# TASK-002 GPT Review — Current Verdict and History

## Current Review Status

- Current reviewed commit: `0f0f63d`
- Current verdict: `MVP_PASS`
- TASK-002: `DONE — CLOSED`
- TASK-003 review gate: released; TASK-003's own real-write and migration gates still apply.

The sections below preserve the chronological review/fix history. The authoritative latest decision is “2026-07-18 — GPT Re-review of Commit `0f0f63d`”.

---

## Initial Review — Commit `94f0199`

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

---

## 2026-07-18 — GPT Re-review of Commit `0f0f63d`

### Verdict

`MVP_PASS`

P0-01D and P0-04B are accepted. P0-02 and P0-03 remain accepted. No P0 blocker or new P1 debt was found in the focused re-review, so TASK-002 is closed and the TASK-003 review gate is released.

### Review baseline

- Branch: `phase/3-feishu-integration`
- Head: `0f0f63dae2ca7a92ef477717f2aa06794e5234ea`
- Remote: `origin/phase/3-feishu-integration` resolved to the same commit.
- Scope: commit `976fa6c..0f0f63d`, limited to P0-01D, P0-04B, and direct regressions.

### Accepted findings

- **P0-01D — ACCEPTED**: `resolveRedactionMode()` enforces `contact > content > default`; inherited contact cannot downgrade, and a nested contact/联系方式/wechat/微信 key beneath content upgrades descendants to contact mode.
- **P0-04B — ACCEPTED**: default-mode structural IDs are preserved only when the current key is one of the seven trusted response-contract ID keys and the value matches `STRUCTURAL_ID_PATTERN`. Unknown Candidate/evidence values such as `note_13900139000` continue through phone redaction.
- Stored `raw_candidate` and review evidence remain unchanged; redaction is applied at the response boundary.

### Fresh independent verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/security/redaction.test.ts tests/integration/ingestions.test.ts` | exit 0; 77/77 passed (55 unit + 22 integration) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `git diff --check` | exit 0 |
| `git diff origin/main -- src/data-cleaning` | exit 0; no output |

Trae's committed final Gate record additionally reports `test:coverage` 307/307, All files Lines 85.77%, `redaction.ts` Lines 100%, build exit 0, and Gate C-Core evaluate 50/50 with all four metrics at 100%. Those full-suite results were not redundantly rerun during this focused re-review.

### Gate decision

- Gate E: `PASSED` for TASK-002 scope.
- TASK-002: `DONE — CLOSED`.
- TASK-003: may start under its own accepted task scope. Real writes, migration, and production execution remain subject to TASK-003's explicit gates and user authority.

---

## 2026-07-18 — GPT Re-review of Commit `976fa6c`

### Verdict

`MVP_FAIL`

P0-01C 的 contact-parent 权威性与 P0-04 的确定性失败 ingestion ID 已按原复现修复，P0-02/P0-03 保持 accepted。但本次实现同时产生两条可通过签名 callback → GET 到达的 PII 泄露路径，Gate E 仍未通过。

### Accepted portions

- `HEAD` 与 `origin/phase/3-feishu-integration` 均为 `976fa6cb6bf9380d389704660ad4be17284d1d7c`；复审开始时工作区干净。
- P0-01C：`contact.content`、`contact.phone`、`contact.mobile`、`联系方式.原始文本` 中的非手机号微信 ID 均按 contact mode 脱敏；输入不变性与签名 callback + GET 回归通过。
- P0-04：`ing_2e042890392546c19181507170127599` 在 GET 中逐字节保留，普通 content 中的手机号仍被掩码。
- P0-02/P0-03：本提交未改变原始 Candidate 与 Pipeline 证据持久化实现，继续保持 accepted。

### P0-01D: Parent content mode downgrades a nested contact key

`redactValueDeep()` 在 `mode === 'content'` 时无条件对所有后代字符串调用 `redactContent()`。因此，更敏感的嵌套 `contact` / `联系方式` key 不能升级到 contact redaction；非手机号微信 ID 只经过 phone-only content redaction并原样返回。

构建产物直接复现：

```text
input:  { content: { contact: "wechat_secret_01" } }
result: { content: { contact: "wechat_secret_01" } }
wechatLeaked: true
```

签名 HTTP 复现同样可达：Candidate `fields.content.contact = "wechat_secret_01"`，callback 200，GET 200，`wechatLeaked: true`、masked form 不存在。

影响：这是本次为 P0-01C 添加“content parent 对称权威性”产生的直接安全回归。原 fix packet 只要求 inherited contact mode 不得被子键降级；安全优先级必须单调，contact 语义不能被 content 语义压低。

### P0-04B: Value-only structural-ID exemption becomes a phone-redaction bypass

`STRUCTURAL_ID_PATTERN` 的 `<alpha>_<alphanumeric>` 分支匹配任意类似 token，而 `isStructuralId(v)` 在 default mode 下不检查字段语义便直接原样返回。因此，攻击者控制的未知 Candidate/evidence 字符串可以把手机号包装成该形态绕过 response-boundary `redactPhone()`。

签名 HTTP 复现：

```text
fields.unknown_field = "note_13900139000"
evidence.unknown_field = "proof_13700137000"
callback: 200
GET: 200
unknownPhoneLeaked: true
evidencePhoneLeaked: true
```

这直接违反原 P0-04 minimum fix 的“保留结构化 ID，同时继续遮蔽 PII-bearing evidence/contact/content values”。`fields` 是 `z.record(z.unknown())`，所以该路径不是理论问题。

### Minimum fix

1. 让 redaction mode 的敏感度单调：inherited contact 仍为最高优先级；inherited content 下遇到嵌套 contact/联系方式/wechat/微信 key 时必须升级为 contact mode，不得继续用 phone-only `redactContent()`。
2. 结构化 ID 放行必须结合可信字段语义/明确响应合同，不能仅凭任意字符串的值形态全局豁免。未知 Candidate/evidence 字段中的 `<prefix>_<phone>` 必须继续经过 `redactPhone()`；同时保留确定性 ingestion ID、UUID、SHA-256 与实际合同内 opaque ID 的逐字节稳定性。
3. 新增两个单元反例：`content.contact`/`原始文本.联系方式` 的微信 ID；default unknown/evidence 字段中的 `note_13800138000`。
4. 新增两个签名 callback + GET 回归，分别证明上述微信 ID 与手机号不再泄露，并继续断言 repository/review 原始证据未被 GET 修改。
5. 保留原 P0-01C 四类复现与确定性 ingestion ID 回归，避免修复回摆。

### Fresh verification evidence

| Command / check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` | exit 0; 301/301, 28 files |
| `npm run test:integration` | exit 0; 37/37, 3 files |
| `npm run test:coverage` | exit 0; Lines 85.6%, Branches 82.26%, Functions 88.73%; redaction.ts Lines 97.43% |
| `npm run build` | exit 0 |
| `npm run evaluate` | exit 0; 50/50, four metrics 100% |
| `git diff origin/main -- src/data-cleaning` | no output |
| `git diff --check` | exit 0 before GPT documentation edits |
| built direct counterexamples | failed security expectation; WeChat and wrapped phones leaked |
| signed callback → GET counterexamples | callback 200 / GET 200; both leak classes reproduced |

### Scope and stop rule

Fix only P0-01D, P0-04B, and their direct regressions. Do not modify P0-02/P0-03, do not start TASK-003, and do not refactor unrelated redaction behavior. Return a new commit for GPT re-review.

---

## 2026-07-18 — Trae Redaction Invariant Closure Fix (P0-01D + P0-04B)

- 基线：Commit `976fa6c`（GPT re-review `MVP_FAIL`，P0-01D + P0-04B 阻塞）
- 范围：按用户批准的 `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_EXECUTION_PLAN.md` 与 `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_DESIGN.md` 单批次连续完成 P0-01D（redaction mode 单调敏感度）+ P0-04B（context-aware structural ID 保留）+ 直接反例，并在代码稳定后只运行一次最终 Gate A + Gate C-Core。不修改 P0-02/P0-03，不启动 TASK-003，不做无关重构。

### 两个安全不变量

- **Invariant A（Monotonic Redaction Sensitivity）**：`contact > content > default`。inherited contact 仍为最高优先级；inherited content 下遇到嵌套 `contact`/`联系方式`/`wechat`/`微信` key 必须升级为 contact mode；inherited contact 不得被任何子键降级。原 P0-01C 的 contact-parent 权威性保持不变。
- **Invariant B（Context-Aware Structural ID Preservation）**：结构化 ID 逐字节保留要求同时满足（a）当前 key 属于可信响应合同 ID 字段集合（`ingestion_id` / `idempotency_key` / `review_record_id` / `source_record_id` / `workflow_run_id` / `reviewer_id` / `business_record_id`），（b）value 形态匹配 `STRUCTURAL_ID_PATTERN`。Candidate `fields` 与 `evidence` 属 `z.record(z.unknown())`，其中的 `<prefix>_<phone>` 不再被 value-only 规则放行。

### 代码修改

#### `src/server/security/redaction.ts`

1. 重写 `RedactionMode` 注释，明确 `contact > content > default` 单调性以及“inherited contact 不能被降级 / inherited content 下嵌套 contact key 升级为 contact”语义。
2. 新增 `TRUSTED_STRUCTURAL_ID_KEYS` Set（7 个可信响应合同 ID 字段）+ `isTrustedStructuralIdKey(lower)` helper。
3. 新增 `resolveRedactionMode(parentMode, lowerKey)`：parent contact 或 contact key → contact；否则 parent content 或 content key → content；否则 default。集中化、单调、可测试。
4. 新增 `redactStringValue(value, mode, trustedStructuralIdContext)`：contact → `redactContactValue`；content → `redactContent`；default + trusted + `isStructuralId` → 原样；default → `redactPhone`。
5. 重写 `redactValueDeep(value, sensitiveKeys, mode, trustedStructuralIdContext)`：
   - 字符串走 `redactStringValue`。
   - 数组传播 `mode` + `trustedStructuralIdContext`。
   - 对象：先用 `fieldSibling` 计算 `fieldMode`（仅当 `fieldSibling` 是字符串时）；`original`/`corrected` 继承 `fieldMode` 且强制 `trusted=false`（Pipeline 证据永不是可信 ID 上下文）；每个 key 用 `resolveRedactionMode` 计算 `valueMode`，`childTrustedIdContext = (valueMode === 'default' && isTrustedStructuralIdKey(lower))`。
   - 可信上下文不通过任意嵌套对象 key 传播；每个对象 key 启动新的 key-context 评估。

### Targeted TDD red → green 证据

#### Red（Task 1，先添加反例测试）

`npx vitest run tests/unit/security/redaction.test.ts` → **5 failed | 50 passed (55 total)**

- 4 个 P0-01D table-driven case 全部失败（`content.contact`、`content.wechat through array`、`原始文本.联系方式`、multi-depth content to 微信）—— `wechat_secret_01` 原样返回。
- 1 个 P0-04B case 失败（`raw_candidate.fields.unknown_field='note_13900139000'` / `nested[0]='proof_13700137000'` / `evidence.unknown_field='trace_13600136000'`）—— 手机号未被掩码为 `note_139****9000` / `proof_137****7000` / `trace_136****6000`。

#### Green（Task 2 单元）

`npx vitest run tests/unit/security/redaction.test.ts` → **55/55 passed**

#### Green（Task 3 集成）

`npx vitest run tests/integration/ingestions.test.ts` → **22/22 passed**

#### Green（Task 3 联合 targeted）

`npx vitest run tests/unit/security/redaction.test.ts tests/integration/ingestions.test.ts` → **77/77 passed (2 test files)**

### 单元测试新增（`tests/unit/security/redaction.test.ts`）

- 重命名原 `parent content mode wins over nested phone/contact keys` 为 `parent content mode remains active for ordinary nested phone keys`，注释明确仅含 phone（避免与 P0-01D contact-upgrade 混淆）。
- 新增 P0-01D table-driven 矩阵（4 个 case）：`content.contact` / `content.wechat through array` / `原始文本.联系方式` / multi-depth content to 微信，全部断言 `wechat_secret_01` 被脱敏为 `we************01`。
- 移除合成 `related_ids` 测试（不在当前响应合同中，避免误依赖）。
- 新增 P0-04B 测试：`raw_candidate.fields.unknown_field='note_13900139000'` / `nested[0]='proof_13700137000'` / `evidence.unknown_field='trace_13600136000'`，期望分别变为 `note_139****9000` / `proof_137****7000` / `trace_136****6000`；同时保留 `ingestion_id` 等可信 ID 逐字节不变。

### HTTP 回归测试新增（`tests/integration/ingestions.test.ts`）

1. **P0-01D**：POST candidate with `content: { contact: 'wechat_secret_01' }` → callback 200 / GET 200。GET 响应不含原 ID、含 `we************01`；`repository.raw_candidate.fields.content.contact` 与 `review.validation.rawCandidate.fields.content.contact` 保持原值；GET 不修改存储。
2. **P0-04B**：POST candidate with `unknown_field='note_13900139000'` + `evidence.unknown_field='proof_13700137000'` → callback 200 / GET 200。GET 响应不含原号码、含 `note_139****9000` / `proof_137****7000`；`repository.raw_candidate.fields.unknown_field` 与 `review.validation.rawCandidate.evidence.unknown_field` 保持原值；GET 不修改存储。

### 最终 Gate A + Gate C-Core 一次性全套验证

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `npm run typecheck` | 0 | tsc -p tsconfig.test.json --noEmit 通过 |
| `npm run lint` | 0 | eslint src tests scripts 通过 |
| `npm run audit:legacy` | 0 | 62 modules（SAFE 4 / UNSAFE 57 / BLOCKED 1，预期） |
| `npm run test:coverage` | 0 | 307/307 passed（28 test files）；All files Lines 85.77% / Branches 82.35% / Funcs 88.88%；`server/security/redaction.ts` Lines 100% / Branch 90.62% / Funcs 100% |
| `npm run build` | 0 | `dist/` 构建成功（tsc -p tsconfig.json） |
| `npm run evaluate` | 0 | Gate C-Core PASS；50/50 case；4 项核心指标 100%（field_accuracy 132/132, required_field_recall 91/91, enum_precision 33/33, error_interception_rate 1/1） |
| `git diff origin/main -- src/data-cleaning` | 0 | 无输出（Legacy 源码零修改） |
| `git diff --check` | 0 | 仅 LF/CRLF 警告，无 whitespace 错误 |

> `test:coverage` 已覆盖 `npm run test`（全量）与 `npm run test:integration`（集成子集），本次单批次验证未单独重复运行后两者；`test:coverage` 结果中 307/307 全量通过即代表两者均通过。

### 修改文件

- `src/server/security/redaction.ts` — Invariant A + Invariant B 实现（`resolveRedactionMode` / `redactStringValue` / `TRUSTED_STRUCTURAL_ID_KEYS` / `isTrustedStructuralIdKey` / `trustedStructuralIdContext` 传播）
- `tests/unit/security/redaction.test.ts` — P0-01D table-driven 4 case + P0-04B 3 case + 原测试重命名
- `tests/integration/ingestions.test.ts` — 2 个 HTTP 回归（P0-01D content.contact / P0-04B unknown_field + evidence.unknown_field）
- `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_DESIGN.md` — 新增设计文档（用户批准）
- `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_EXECUTION_PLAN.md` — 新增执行计划（用户批准）
- `docs/ai/tasks/TASK-002.md` — Status 更新 + Review History 新增本段
- `docs/ai/reviews/TASK-002_GPT_REVIEW.md` — 本段
- `docs/ai/PROJECT_STATE.md` — 状态更新
- `docs/ACCEPTANCE_REPORT.md` — 验收记录追加
- `reports/phase2/legacy-module-profiles.json` — audit:legacy 自动重新生成时间戳

### 安全复现

GPT re-review 暴露的两条 HTTP 可达 PII 泄露路径现已修复：

- **P0-01D**：`content: { contact: "wechat_secret_01" }` 在 GET 响应中被逐层升级为 contact mode，`wechat_secret_01` 被脱敏为 `we************01`。
- **P0-04B**：未知字段 `note_13900139000` / `proof_13700137000` 在 GET 响应中被 `redactPhone` 扫描并分别掩码为 `note_139****9000` / `proof_137****7000`；可信合同 ID（`ingestion_id` 等）仍逐字节保留。

repository / review 原始证据均保持不变，GET 不修改存储。

### 未通过项

无。等待 GPT 基于新 commit 复核。

### 下一步

提交新 commit 并 push 到 `origin/phase/3-feishu-integration`，交 GPT 基于 new commit 复核。复核通过前不得启动 TASK-003。
