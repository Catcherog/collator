# Collator internal-controlled Feishu write lane

This lane is an internal, operator-controlled write path. It is not a
production-pilot switch and it does not make a production-readiness claim.
The default is disabled:

```text
ENABLE_INTERNAL_CONTROLLED_WRITE=false
FEISHU_WRITE_ENV=internal-controlled
INTERNAL_WRITE_MAX_CONCURRENCY=1
INTERNAL_WRITE_REQUIRE_HUMAN_CONFIRMATION=true
INTERNAL_WRITE_AUTO_RETRY_CREATE=false
INTERNAL_WRITE_RECONCILIATION_ENABLED=true
```

## Execution boundary

1. The server reads the current Candidate V1 and PRE_WRITE governance result.
2. It computes the authoritative plan. `client` is exactly
   `customer + project`; `creative` is exactly `model + project`; `unknown`
   plans zero writes.
3. A server-owned preview binds the candidate, governance result, plan,
   target-table digests, operator, nonce, and expiry. The HTTP body cannot
   supply a complete plan or override those bindings.
4. A separately authenticated operator confirms the preview. The execute
   endpoint accepts only the preview identity, nonce, and candidate ID.
5. A single-process queue runs one execution at a time. A second click for
   the same preview is rejected; a terminal success is replayed without a
   new Create call.

The internal gate checks `TASK_REPOSITORY=feishu`, `DRY_RUN=false`, the global
real-write flag, the exact internal mode, the human confirmation, the trusted
operator binding, governance `PASS`, server digests, and the exact Base/table
allowlist. Missing values fail closed.

## Unknown and partial results

Create calls use the existing stable UUIDv4 `client_token` boundary. The
internal lane never performs an automatic blind Create retry. A network or
ambiguous response is stored as `result_unknown`; any known record IDs are
preserved. Partial results are stored as `partial`. Neither state performs an
automatic delete or compensation.

The Feishu client’s only existing automatic retry branch is access-token
refresh for an authentication-expiry response; it is not a generic network
retry. The stable create token remains the server-owned idempotency boundary.

`POST /v1/internal-controlled-writes/previews/:id/reconcile` performs a
read-only marker lookup when the configured marker field is available:

- one match: bind the existing record ID and complete successfully;
- zero matches: keep `needs_reconciliation` for manual action;
- multiple matches: keep `needs_reconciliation` with
  `DUPLICATE_CANDIDATES_FOUND`;
- missing marker/schema binding: keep the result unresolved.

Reconciliation never creates or deletes a record. The durable internal
journal stores preview state and per-entity intent/result logs. Logs contain
logical keys and table-ID digests, not raw table IDs or request nonce values.

## Routes

- `POST /v1/internal-controlled-writes/previews`
- `POST /v1/internal-controlled-writes/previews/:id/confirm`
- `POST /v1/internal-controlled-writes/previews/:id/execute`
- `POST /v1/internal-controlled-writes/previews/:id/reconcile`

Short `/internal-controlled-writes` aliases and `/internal-writes` aliases
are registered for internal adapters. These routes require the verified
operator resolver; client headers are not accepted as a substitute when the
lane is active.

The formal Feishu Base schema is not modified by this lane. Project/model
marker fields must be supplied only after the schema owner confirms their
names. If the marker boundary is unavailable, the result stays unresolved.

## Deployment constraint

Internal controlled writes are serialized within one application process.
This is a best-effort low-concurrency safeguard, not a distributed lock.
Run exactly one internal write worker. Do not horizontally scale the write
executor, and do not let read-only/API instances execute internal writes. If
the deployment cannot separate those roles, keep the whole service at one
instance until an external transaction coordinator is introduced.

This lane does not support distributed locking, cross-instance CAS, strict
exactly-once delivery, automatic horizontal scaling, destructive automatic
compensation, or production-grade multi-instance writes.
`PRODUCTION_GRADE_MULTI_INSTANCE_WRITE_NOT_SUPPORTED` remains an explicit
boundary for this release.
