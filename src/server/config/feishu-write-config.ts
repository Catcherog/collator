// feishu-write-config.ts
// Workstream C / Amendment 6: Double-layer enablement gate for real Feishu
// Create Record API calls.
//
// Layer 1 (existing `config.ts`): TASK_REPOSITORY + DRY_RUN.
// Layer 2 (THIS file): ENABLE_REAL_FEISHU_WRITE + FEISHU_WRITE_ENV + test
// whitelist.
//
// The gate function `isRealWriteAllowed` is the SINGLE fail-closed decision
// point. It checks ALL 6 conditions from Amendment 6. If ANY condition is
// missing it returns `{ allowed: false, reason }` and the caller MUST NOT
// call the Feishu Create Record API.
//
// This batch does NOT enable FEISHU_WRITE_ENV=production. The gate only
// allows `feishuWriteEnv === 'test'` and only against the test whitelist.
//
// Security (AC-C12): reasons are static diagnostic strings. They never echo
// env values, secrets, tokens, or PII — so logging a blocked reason cannot
// leak FEISHU_APP_SECRET or any other credential.

/**
 * The write environment the gate may allow.
 *
 * `production` is defined for type completeness but is NOT enabled by this
 * batch — `isRealWriteAllowed` only returns `allowed: true` when
 * `feishuWriteEnv === 'test'`.
 */
export type FeishuWriteEnv = 'test' | 'production';

/**
 * Aggregate of every input the gate needs to evaluate. This is the
 * "double-layer gate config": it carries both layer-1 fields
 * (`taskRepository`, `dryRun`) and layer-2 fields
 * (`enableRealFeishuWrite`, `feishuWriteEnv`, `testWhitelist`) so the gate
 * is fully self-contained and independently testable.
 */
export interface FeishuWriteConfig {
  /** Layer 1 — `TASK_REPOSITORY` must be `feishu`. */
  taskRepository: 'memory' | 'feishu';
  /** Layer 1 — `DRY_RUN` must be `false` for real writes. */
  dryRun: boolean;
  /** Layer 2 — `ENABLE_REAL_FEISHU_WRITE` (defaults to `false`). */
  enableRealFeishuWrite: boolean;
  /**
   * Layer 2 — `FEISHU_WRITE_ENV`. NO default: when missing or unrecognised
   * the value is `undefined` and the gate blocks (condition 4).
   */
  feishuWriteEnv: FeishuWriteEnv | undefined;
  /**
   * Layer 2 — test whitelist. A real write is only allowed when the target
   * table id is listed here (and, when `baseAppToken` is set, the target
   * base token matches it).
   */
  testWhitelist: {
    baseAppToken?: string;
    tableIds: string[];
  };
}

/**
 * Accepted shapes for the governance-decision argument of the gate. Either a
 * full governance result object carrying a `decision` field, or the decision
 * string itself. The decision values produced by SOP are `PASS`,
 * `NEEDS_REVIEW` (review) and `BLOCKED` (reject).
 */
export type GovernanceDecisionInput =
  | { decision: string }
  | string;

/**
 * Outcome of the gate. `reason` is a static diagnostic string (no secrets).
 */
export interface RealWriteGateResult {
  allowed: boolean;
  reason: string;
}

/**
 * Parse a boolean env var. Unlike `z.coerce.boolean()` (which turns the
 * string `"false"` into `true`), this treats only the case-insensitive
 * literal `"true"` as `true`; every other value is `false`. Missing values
 * fall back to `defaultValue`.
 *
 * Correctness here is critical: `DRY_RUN=false` and
 * `ENABLE_REAL_FEISHU_WRITE=true` must be parsed exactly, or the gate could
 * accidentally allow or block a real write.
 */
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  return value.trim().toLowerCase() === 'true';
}

/**
 * Load the double-layer gate config from an environment map (defaults to
 * `process.env`).
 *
 * Reads:
 * - `TASK_REPOSITORY`             → `taskRepository` (`'feishu'` only; else `'memory'`)
 * - `DRY_RUN`                     → `dryRun` (parsed via `parseBooleanEnv`)
 * - `ENABLE_REAL_FEISHU_WRITE`    → `enableRealFeishuWrite` (default `false`)
 * - `FEISHU_WRITE_ENV`            → `feishuWriteEnv` (`'test'` | `'production'`; else `undefined`)
 * - `FEISHU_TEST_BASE_APP_TOKEN`  → `testWhitelist.baseAppToken`
 * - `FEISHU_TEST_TABLE_IDS`       → `testWhitelist.tableIds` (comma-separated)
 *
 * This function NEVER throws on a missing layer-2 value: a missing value is
 * a legitimate "blocked" state that the gate reports via its `reason`. The
 * caller decides whether to surface that as an error or a dry-run fallback.
 */
export function loadFeishuWriteConfig(
  env: Record<string, string | undefined> = process.env
): FeishuWriteConfig {
  const taskRepository: FeishuWriteConfig['taskRepository'] =
    env.TASK_REPOSITORY === 'feishu' ? 'feishu' : 'memory';

  const dryRun = parseBooleanEnv(env.DRY_RUN, true);

  const enableRealFeishuWrite = parseBooleanEnv(env.ENABLE_REAL_FEISHU_WRITE, false);

  const rawEnv = env.FEISHU_WRITE_ENV?.trim().toLowerCase();
  const feishuWriteEnv: FeishuWriteEnv | undefined =
    rawEnv === 'test' ? 'test' : rawEnv === 'production' ? 'production' : undefined;

  const baseAppTokenRaw = env.FEISHU_TEST_BASE_APP_TOKEN?.trim();
  const baseAppToken = baseAppTokenRaw && baseAppTokenRaw.length > 0 ? baseAppTokenRaw : undefined;

  const tableIdsRaw = env.FEISHU_TEST_TABLE_IDS ?? '';
  const tableIds = tableIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    taskRepository,
    dryRun,
    enableRealFeishuWrite,
    feishuWriteEnv,
    testWhitelist: {
      baseAppToken,
      tableIds,
    },
  };
}

/**
 * Normalise the governance-decision argument to a single decision string.
 */
function normalizeDecision(input: GovernanceDecisionInput): string {
  if (typeof input === 'string') return input;
  if (input && typeof input.decision === 'string') return input.decision;
  return '';
}

/**
 * The fail-closed double-layer gate (Amendment 6).
 *
 * Returns `{ allowed: true, reason }` only when ALL 6 conditions hold:
 *   1. `config.taskRepository === 'feishu'`
 *   2. `config.dryRun === false`
 *   3. `config.enableRealFeishuWrite === true`
 *   4. `config.feishuWriteEnv === 'test'`  (production NOT enabled this batch)
 *   5. the target table id is in the test whitelist (and the target base
 *      token matches `testWhitelist.baseAppToken` when it is set)
 *   6. the SOP governance decision is `PASS`
 *
 * If ANY condition fails, returns `{ allowed: false, reason }` with a static
 * diagnostic reason. The caller MUST NOT call the Feishu Create Record API
 * when `allowed === false`.
 *
 * Condition 6 enforces AC-C02 (write only after PASS) and AC-C03 (REJECT /
 * REVIEW → no write): `BLOCKED` (reject) and `NEEDS_REVIEW` (review) both
 * fail this condition.
 *
 * `reason` strings never contain secrets, env values, tokens or PII, so they
 * are safe to log (AC-C12).
 */
export function isRealWriteAllowed(
  config: FeishuWriteConfig,
  governanceDecision: GovernanceDecisionInput,
  targetBaseToken: string | undefined,
  targetTableId: string | undefined
): RealWriteGateResult {
  // Condition 1.
  if (config.taskRepository !== 'feishu') {
    return {
      allowed: false,
      reason:
        "Gate blocked: TASK_REPOSITORY must be 'feishu' (condition 1 of 6).",
    };
  }

  // Condition 2.
  if (config.dryRun) {
    return {
      allowed: false,
      reason: 'Gate blocked: DRY_RUN must be false (condition 2 of 6).',
    };
  }

  // Condition 3.
  if (!config.enableRealFeishuWrite) {
    return {
      allowed: false,
      reason:
        'Gate blocked: ENABLE_REAL_FEISHU_WRITE must be true (condition 3 of 6).',
    };
  }

  // Condition 4. Production is NOT enabled in this batch.
  if (config.feishuWriteEnv !== 'test') {
    return {
      allowed: false,
      reason:
        "Gate blocked: FEISHU_WRITE_ENV must be 'test' — production is not enabled in this batch " +
        '(condition 4 of 6).',
    };
  }

  // Condition 5. Target must hit the test whitelist.
  const whitelist = config.testWhitelist;
  if (!targetTableId) {
    return {
      allowed: false,
      reason:
        'Gate blocked: target table id was not provided for whitelist check (condition 5 of 6).',
    };
  }
  if (whitelist.tableIds.length === 0) {
    return {
      allowed: false,
      reason:
        'Gate blocked: test whitelist (FEISHU_TEST_TABLE_IDS) is empty — no table is allow-listed ' +
        '(condition 5 of 6).',
    };
  }
  if (!whitelist.tableIds.includes(targetTableId)) {
    return {
      allowed: false,
      reason:
        'Gate blocked: target table id is not in the test whitelist (condition 5 of 6).',
    };
  }
  if (whitelist.baseAppToken) {
    if (!targetBaseToken || targetBaseToken !== whitelist.baseAppToken) {
      return {
        allowed: false,
        reason:
          'Gate blocked: target base token does not match the whitelisted test base ' +
          '(condition 5 of 6).',
      };
    }
  }

  // Condition 6. SOP governance decision must be PASS.
  const decision = normalizeDecision(governanceDecision);
  if (decision !== 'PASS') {
    return {
      allowed: false,
      reason:
        `Gate blocked: SOP Governance Result must be PASS, got '${decision || '<empty>'}' ` +
        '(condition 6 of 6). REJECT (BLOCKED) and REVIEW (NEEDS_REVIEW) never write.',
    };
  }

  return {
    allowed: true,
    reason: 'All 6 gate conditions met: real Feishu write allowed (test env, whitelisted target).',
  };
}
