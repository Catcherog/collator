# TASK-R3: Production Pilot Review Fix

## Status

`CODEX_FIX_READY_FOR_TRAE_REVIEW` after the local Codex FIX commit.

## Scope

Implement the `CODEX_REQUIRED` review findings for RF-03 and RF-04 on the
production-pilot path. This task does not authorize a real Feishu/Base write,
production pilot completion, merge, or deployment.

## Closed in this FIX

- RF-03: server-owned preview generation, authenticated-operator confirmation,
  opaque preview ID plus nonce execution, and manifest bindings for candidate,
  governance, authoritative plan, pilot run, Base/table digests, and operator.
- RF-04: durable `CREATE_INTENT` before each external Create Record call,
  immediate `CREATE_CONFIRMED` after the API returns and before read-back,
  exact-record compensation, restart recovery for pending intents, ambiguous
  lookup fail-closed behavior, and production-pilot startup recovery gating.
- Legacy full-preview and client confirmation fields are rejected by the strict
  HTTP schema.

## Verification evidence

- Targeted RF-03/RF-04 Vitest suites pass, including route rejection and startup
  recovery tests.
- `npm run typecheck` passes.
- `npm run build` passes after the final source changes.
- `npm run lint` passes with zero errors and one pre-existing warning outside
  this task.
- No real Feishu/Base write was executed.

## Remaining boundaries

- RF-02 real Feishu relation-schema validation remains an external-contract
  limitation and is not represented as production readiness.
- The pre-existing full-suite legacy module source-hash failures remain outside
  this FIX; the baseline full suite already failed before these changes. The
  integration suite also remains red on the same legacy/evaluation/old
  ingestion/Gate-D mock families and is not an RF-03/RF-04 regression.
- Trae must inspect the local commit, rerun the required gates, and own push/PR
  updates. The PR must remain unmerged until independent review and explicit
  production authorization.
