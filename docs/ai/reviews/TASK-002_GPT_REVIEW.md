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
