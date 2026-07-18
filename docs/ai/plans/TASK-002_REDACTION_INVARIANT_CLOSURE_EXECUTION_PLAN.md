# TASK-002 Redaction Invariant Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan as one bounded batch. Do not introduce intermediate GPT review checkpoints.

**Goal:** Close P0-01D and P0-04B by enforcing monotonic redaction sensitivity and context-aware structural-ID preservation, then deliver code, regressions, final gates, documentation, one commit, and one push.

**Architecture:** Centralize key/parent redaction precedence in one resolver with `contact > content > default`. Preserve structural IDs only when both the current response key is explicitly trusted and the value matches an allowed ID shape; all attacker-controlled unknown Candidate/evidence strings continue through phone redaction.

**Tech Stack:** TypeScript, Fastify injection tests, Vitest, Node.js 20+, existing `redactObject()` response boundary.

## Global Constraints

- Work on `phase/3-feishu-integration`, baseline commit `976fa6c` plus the current uncommitted GPT review/design documents.
- Modify only files authorized by `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_DESIGN.md`.
- Do not modify P0-02/P0-03 behavior, `src/data-cleaning/**`, API contracts, dependencies, or TASK-003.
- Same-root counterexamples may be fixed without pausing if they violate the two approved invariants and remain inside authorized files.
- Use TDD: add counterexamples, verify red, implement, verify green.
- Run the full Gate A + Gate C-Core only once after targeted tests are stable.
- Produce one final commit containing implementation, tests, GPT review documents, execution evidence, and normal audit output; push once.

---

### Task 1: Lock the two invariants with failing unit tests

**Files:**
- Modify: `tests/unit/security/redaction.test.ts`

**Interfaces:**
- Consumes: `redactObject(obj, sensitiveKeys?)` from `src/server/security/redaction.ts`.
- Produces: table-driven regression coverage for monotonic mode resolution and untrusted wrapped-phone values.

- [ ] **Step 1: Replace the misleading content-parent symmetry wording**

Keep the existing long raw-text test, but rename it from “parent content mode wins over nested phone/contact keys” to “parent content mode remains active for ordinary nested phone keys”. Its input only contains `phone`; do not claim it covers nested contact.

- [ ] **Step 2: Add the P0-01D failing matrix**

Add a table-driven test after the existing P0-01C group:

```ts
it.each([
  {
    name: 'content.contact',
    input: { content: { contact: 'wechat_secret_01' } },
  },
  {
    name: 'content.wechat through an array',
    input: { content: [{ wechat: 'wechat_secret_01' }] },
  },
  {
    name: '原始文本.联系方式',
    input: { 原始文本: { 联系方式: 'wechat_secret_01' } },
  },
  {
    name: 'multi-depth content to 微信',
    input: { content: { nested: { 微信: 'wechat_secret_01' } } },
  },
])('upgrades nested contact semantics under $name', ({ input }) => {
  const before = structuredClone(input);
  const result = redactObject(input);
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain('wechat_secret_01');
  expect(serialized).toContain('we************01');
  expect(input).toEqual(before);
  expect(redactObject(input)).toEqual(result);
});
```

This matrix must fail on `976fa6c` because inherited content currently overrides nested contact keys.

- [ ] **Step 3: Add the P0-04B failing matrix**

```ts
it('does not treat structural-looking values in untrusted fields as trusted IDs', () => {
  const input = {
    raw_candidate: {
      fields: {
        unknown_field: 'note_13900139000',
        nested: ['proof_13700137000'],
      },
      evidence: {
        unknown_field: 'trace_13600136000',
      },
    },
  };
  const before = structuredClone(input);
  const result = redactObject(input) as typeof input;

  expect(result.raw_candidate.fields.unknown_field).toBe(
    'note_139****9000'
  );
  expect(result.raw_candidate.fields.nested[0]).toBe(
    'proof_137****7000'
  );
  expect(result.raw_candidate.evidence.unknown_field).toBe(
    'trace_136****6000'
  );
  expect(input).toEqual(before);
  expect(redactObject(input)).toEqual(result);
});
```

This must fail on `976fa6c` because all three values match the broad `<alpha>_<alphanumeric>` branch.

- [ ] **Step 4: Keep trusted-ID coverage contract-based**

Keep the existing tests for:

```ts
{
  ingestion_id: 'ing_2e042890392546c19181507170127599',
  idempotency_key:
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  review_record_id: 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6',
  source_record_id: 'rec_001',
  workflow_run_id: 'run_001',
  reviewer_id: 'reviewer_1',
}
```

Remove or replace the synthetic `related_ids` preservation test. `related_ids` is not in the current response contract and must not expand the trust boundary.

- [ ] **Step 5: Run targeted unit tests and capture red evidence**

Run:

```powershell
npx vitest run tests/unit/security/redaction.test.ts
```

Expected before implementation:

- P0-01D matrix fails because `wechat_secret_01` remains present.
- P0-04B matrix fails because wrapped phone values remain unchanged.
- Existing P0-01A/B/C and deterministic ingestion-ID tests remain green.

Do not run Gate A yet.

---

### Task 2: Implement one monotonic resolver and a trusted ID context

**Files:**
- Modify: `src/server/security/redaction.ts`

**Interfaces:**
- Consumes: existing `RedactionMode`, `isContactKey()`, `isContentKey()`, `isStructuralId()`, `redactContactValue()`, `redactContent()`, `redactPhone()`.
- Produces: centralized `resolveRedactionMode()` and key-aware structural-ID preservation used by all recursion branches.

- [ ] **Step 1: Add the explicit trusted key set**

Place it beside `STRUCTURAL_ID_PATTERN`:

```ts
const TRUSTED_STRUCTURAL_ID_KEYS = new Set([
  'ingestion_id',
  'idempotency_key',
  'review_record_id',
  'source_record_id',
  'workflow_run_id',
  'reviewer_id',
  'business_record_id',
]);

function isTrustedStructuralIdKey(lower: string): boolean {
  return TRUSTED_STRUCTURAL_ID_KEYS.has(lower);
}
```

Do not trust arbitrary `*_id` keys; Candidate fields are attacker-controlled.

- [ ] **Step 2: Add one mode-resolution helper**

```ts
function resolveRedactionMode(
  parentMode: RedactionMode,
  lowerKey: string
): RedactionMode {
  if (parentMode === 'contact' || isContactKey(lowerKey)) {
    return 'contact';
  }
  if (parentMode === 'content' || isContentKey(lowerKey)) {
    return 'content';
  }
  return 'default';
}
```

The ordering is intentional: a nested contact key upgrades inherited content, while inherited contact can never be downgraded.

- [ ] **Step 3: Centralize string handling**

Add:

```ts
function redactStringValue(
  value: string,
  mode: RedactionMode,
  trustedStructuralIdContext: boolean
): string {
  if (mode === 'contact') {
    return redactContactValue(value);
  }
  if (mode === 'content') {
    return redactContent(value);
  }
  if (trustedStructuralIdContext && isStructuralId(value)) {
    return value;
  }
  return redactPhone(value);
}
```

Only default mode may preserve IDs; contact/content contexts always apply their PII policy.

- [ ] **Step 4: Extend recursion with trusted context**

Change the private signature to:

```ts
function redactValueDeep(
  value: unknown,
  sensitiveKeys: string[],
  mode: RedactionMode = 'default',
  trustedStructuralIdContext: boolean = false
): unknown
```

Use the centralized string handler and propagate trusted context only through arrays:

```ts
if (typeof value === 'string') {
  return redactStringValue(value, mode, trustedStructuralIdContext);
}
if (Array.isArray(value)) {
  return value.map((v) =>
    redactValueDeep(
      v,
      sensitiveKeys,
      mode,
      trustedStructuralIdContext
    )
  );
}
```

An object starts new key contexts; do not blindly propagate trusted ID context through arbitrary nested object keys.

- [ ] **Step 5: Apply the same resolver to field-sibling evidence**

Replace the hand-built field-mode branch with:

```ts
const fieldSibling = source['field'];
const fieldMode =
  typeof fieldSibling === 'string'
    ? resolveRedactionMode(mode, fieldSibling.toLowerCase())
    : mode;
```

For `original` / `corrected`, recurse with `fieldMode` and `false` trusted-ID context:

```ts
if (
  typeof fieldSibling === 'string' &&
  (lower === 'original' || lower === 'corrected')
) {
  result[key] = redactValueDeep(v, sensitiveKeys, fieldMode, false);
  continue;
}
```

- [ ] **Step 6: Replace per-branch mode decisions in the object loop**

For every key:

```ts
const valueMode = resolveRedactionMode(mode, lower);
const trustedIdContext =
  valueMode === 'default' && isTrustedStructuralIdKey(lower);

result[key] = redactValueDeep(
  v,
  sensitiveKeys,
  valueMode,
  trustedIdContext
);
```

This single call replaces the current direct-string conditional ladder and the separate non-string `childMode` ladder.

- [ ] **Step 7: Update comments without changing the public API**

- Document `contact > content > default`.
- State that structural-ID recognition is value validation only; preservation additionally requires a trusted contract key.
- Keep `redactObject(obj, sensitiveKeys?)` signature unchanged. Do not use this batch to remove or redesign the optional parameter.

- [ ] **Step 8: Run targeted unit tests and verify green**

Run:

```powershell
npx vitest run tests/unit/security/redaction.test.ts
```

Expected: all redaction unit tests pass, including P0-01A/B/C/D, trusted IDs, wrapped phones, determinism, and input non-mutation.

Do not run Gate A yet.

---

### Task 3: Prove both invariants through signed callback → GET

**Files:**
- Modify: `tests/integration/ingestions.test.ts`

**Interfaces:**
- Consumes: existing `setup()`, `createTask()`, `makeCandidatePayload()`, `postCandidate()`, in-memory task/review repositories.
- Produces: two API-reachable regressions with stored-evidence non-mutation assertions.

- [ ] **Step 1: Add the P0-01D HTTP regression**

Add inside the Candidate callback describe block:

```ts
it('P0-01D: GET upgrades nested contact semantics beneath content without mutating evidence', async () => {
  const { app, repository, reviewRepository } = await setup();
  const ingestionId = await createTask(app);
  const nested = { contact: 'wechat_secret_01' };
  const payload = makeCandidatePayload({ content: nested });

  const callback = await postCandidate(app, ingestionId, payload);
  expect(callback.statusCode).toBe(200);

  const response = await app.inject({
    method: 'GET',
    url: `/v1/ingestions/${ingestionId}`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('wechat_secret_01');
  expect(response.body).toContain('we************01');

  const stored = await repository.findById(ingestionId);
  expect(stored!.raw_candidate!.fields['content']).toEqual(nested);

  const review = await reviewRepository.findByIngestionId(ingestionId);
  const validation = review!.validation as Record<string, unknown>;
  const rawCandidate = validation['rawCandidate'] as {
    fields: Record<string, unknown>;
  };
  expect(rawCandidate.fields['content']).toEqual(nested);

  const storedAgain = await repository.findById(ingestionId);
  expect(storedAgain!.raw_candidate!.fields['content']).toEqual(nested);
});
```

- [ ] **Step 2: Add the P0-04B HTTP regression**

```ts
it('P0-04B: GET redacts wrapped phones in unknown fields and evidence without mutating evidence', async () => {
  const { app, repository, reviewRepository } = await setup();
  const ingestionId = await createTask(app);
  const wrappedField = 'note_13900139000';
  const wrappedEvidence = 'proof_13700137000';
  const payload = makeCandidatePayload({
    unknown_field: wrappedField,
  });
  (payload.candidate as {
    evidence: Record<string, string>;
  }).evidence = {
    unknown_field: wrappedEvidence,
  };

  const callback = await postCandidate(app, ingestionId, payload);
  expect(callback.statusCode).toBe(200);

  const response = await app.inject({
    method: 'GET',
    url: `/v1/ingestions/${ingestionId}`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('13900139000');
  expect(response.body).not.toContain('13700137000');
  expect(response.body).toContain('note_139****9000');
  expect(response.body).toContain('proof_137****7000');

  const stored = await repository.findById(ingestionId);
  expect(stored!.raw_candidate!.fields['unknown_field']).toBe(wrappedField);
  expect(stored!.raw_candidate!.evidence['unknown_field']).toBe(
    wrappedEvidence
  );

  const review = await reviewRepository.findByIngestionId(ingestionId);
  const validation = review!.validation as Record<string, unknown>;
  const rawCandidate = validation['rawCandidate'] as {
    fields: Record<string, unknown>;
    evidence: Record<string, string>;
  };
  expect(rawCandidate.fields['unknown_field']).toBe(wrappedField);
  expect(rawCandidate.evidence['unknown_field']).toBe(wrappedEvidence);

  const storedAgain = await repository.findById(ingestionId);
  expect(storedAgain!.raw_candidate).toEqual(stored!.raw_candidate);
});
```

- [ ] **Step 3: Run targeted integration tests**

Run:

```powershell
npx vitest run tests/integration/ingestions.test.ts
```

Expected: all ingestion HTTP tests pass, including the original P0-01C and deterministic P0-04 regressions plus the two new tests.

- [ ] **Step 4: Run both targeted files together**

```powershell
npx vitest run tests/unit/security/redaction.test.ts tests/integration/ingestions.test.ts
```

Expected: both files pass in one process. This is the last focused check before final gates.

---

### Task 4: Run one final gate, update control files, and deliver one commit

**Files:**
- Modify: `docs/ai/tasks/TASK-002.md`
- Modify: `docs/ai/reviews/TASK-002_GPT_REVIEW.md`
- Modify: `docs/ai/PROJECT_STATE.md`
- Modify: `docs/ACCEPTANCE_REPORT.md`
- Modify if generated: `reports/phase2/legacy-module-profiles.json`
- Preserve: `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_DESIGN.md`
- Preserve: `docs/ai/plans/TASK-002_REDACTION_INVARIANT_CLOSURE_EXECUTION_PLAN.md`

**Interfaces:**
- Consumes: stable targeted implementation and current GPT review documents.
- Produces: one auditable commit, pushed branch, and a new GPT final-review baseline.

- [ ] **Step 1: Run the final Gate A + Gate C-Core exactly once**

Run sequentially and stop on a current-change failure:

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
git diff --check
```

Expected:

- Every npm command exits 0.
- All unit/integration tests, including the new invariant matrix, pass.
- Core critical module line coverage remains at least 80%.
- Evaluation remains 50/50 with all four metrics meeting thresholds.
- Legacy diff prints nothing.
- `git diff --check` exits 0.

Do not rerun the full sequence merely to create duplicate evidence. If a command fails because of the current patch, fix it inside authorized files, run the focused failing command, then rerun the final sequence once from the beginning for clean final evidence.

- [ ] **Step 2: Update the four control documents**

Record:

- Status: `P0-01D + P0-04B INVARIANT CLOSURE APPLIED — AWAITING GPT FINAL RE-REVIEW`.
- Baseline: `976fa6c`.
- Exact changed files and invariant design.
- Red evidence for both original counterexamples.
- Green targeted matrix counts.
- Final Gate A + Gate C-Core commands, exit codes, counts, coverage, evaluation metrics, Legacy diff, and diff-check result.
- P0-01A/B/C, deterministic P0-04, P0-02, and P0-03 remain accepted.
- TASK-003 remains not started and blocked until GPT final re-review.

Append the Trae implementation result beneath the `976fa6c` GPT review section; do not rewrite historical review evidence.

- [ ] **Step 3: Perform final scope and secret checks**

Run:

```powershell
git status --short
git diff --stat
git diff -- src/server/security/redaction.ts tests/unit/security/redaction.test.ts tests/integration/ingestions.test.ts docs/ai docs/ACCEPTANCE_REPORT.md reports/phase2/legacy-module-profiles.json
git diff --check
git diff origin/main -- src/data-cleaning
```

Confirm:

- Only authorized files changed.
- No `.env`, secrets, real table IDs, unrelated generated files, or TASK-003 implementation appear.
- The existing uncommitted GPT review/design documents are included, not overwritten or omitted.

- [ ] **Step 4: Create one commit and push**

Trae owns Git delivery. Stage only the authorized files and create one commit with this intent:

```text
Phase 3B / TASK-002 fix: close redaction mode and structural ID invariants
```

Push to:

```text
origin/phase/3-feishu-integration
```

- [ ] **Step 5: Return the final handoff**

Report:

```text
阶段：Phase 3B / TASK-002 Redaction Invariant Closure
状态：DONE — AWAITING GPT FINAL RE-REVIEW
分支：phase/3-feishu-integration
Commit：运行 `git rev-parse --short HEAD` 后粘贴其实际输出

实现：
- monotonic redaction mode: contact > content > default
- context-aware trusted structural ID preservation
- unit matrix + 2 signed callback/GET regressions

验证：
- targeted red/green evidence
- final Gate A counts and coverage
- Gate C-Core 50/50 metrics
- Legacy diff empty
- git diff --check exit 0

范围：
- P0-02/P0-03 unchanged
- TASK-003 not started
- no unrelated refactor

下一步：
- GPT performs one final bounded re-review of the new commit
```

Do not start TASK-003 after push. Stop at the GPT final-review checkpoint.
