// TEMP: TASK-001 真实 Base 结构核验烟雾测试（via lark-cli） | 创建日期 2026-07-17 | 预计删除日期 2026-07-20
// 用途：通过 lark-cli 在真实飞书 Base 上端到端验证 FeishuTaskRepository 字段映射、JSON 快照策略、datetime 格式
// 执行：npx tsx src/scripts/temp/smoke-test-lark-cli.ts
//   运行前必须注入环境变量（与生产代码 config.ts 一致），否则启动失败：
//     - FEISHU_BASE_APP_TOKEN：目标 Base 的 app token
//     - FEISHU_INGESTION_TABLE_ID：Collator 摄入任务 table ID
//   示例（PowerShell）：
//     $env:FEISHU_BASE_APP_TOKEN="<from .env>"; $env:FEISHU_INGESTION_TABLE_ID="<from .env>"; npx tsx src/scripts/temp/smoke-test-lark-cli.ts
//   真实值仅存于本地 .env（gitignored），不入库、不进入本脚本。
// 清理：完成后由用户决定删除或保留
//
// 验证项（对应 TASK-001 验收 #1 #2 #3）：
//   1. 在摄入表 upsert 一条记录（创建），字段映射符合 FeishuTaskRepository.buildFields
//   2. search by "摄入 ID" 能查到记录，且字段值深度等价
//   3. upsert 同摄入 ID 不同状态（更新），保持只有一条记录
//   4. search 验证状态更新生效
//   5. cleanup：delete 测试记录
//
// 注意：本脚本不直接调用 FeishuTaskRepository 代码路径（生产代码不得依赖 lark-cli，
// 见 TASK-001 Implementation Constraints #1），但用相同的字段映射和 JSON 快照策略，
// 用以验证真实飞书 Base 的字段类型、JSON 序列化兼容性、datetime 毫秒时间戳格式。
//
// lark-cli 响应结构（实测）：
//   - +record-upsert: data.created + data.record.record_id_list[0] + data.record.fields + data.record.data[0]
//   - +record-search: data.data (二维数组) + data.fields (字段名) + data.record_id_list
//   - +record-delete: data.record_id_list (已删除)
//   - 单选字段值返回数组 ["received"]，datetime 返回字符串 "2026-07-17 18:00:01"

import { execFileSync } from 'node:child_process';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `Missing required env var ${name}. Set it from your local .env before running this script. ` +
        'Real Feishu Base/ table IDs must not be hardcoded in source (TASK-001 P0-02).'
    );
  }
  return v.trim();
}

const BASE_TOKEN = requireEnv('FEISHU_BASE_APP_TOKEN');
const INGESTION_TABLE_ID = requireEnv('FEISHU_INGESTION_TABLE_ID');
const LARK_CLI = 'bin/lark-cli.exe';

interface LarkEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; hint?: string; code?: number };
}

interface FieldRow {
  record_id: string;
  fields: Record<string, unknown>;
}

interface UpsertEnvelopeData {
  created?: boolean;
  updated?: boolean;
  record?: {
    // create-mode response: columnar shape with record_id_list
    record_id_list?: string[];
    fields?: string[];
    data?: unknown[][];
    // update-mode response: object shape keyed by field name (no record_id_list)
    update?: Record<string, unknown>;
  };
}

interface SearchEnvelopeData {
  data?: unknown[][];
  fields?: string[];
  record_id_list?: string[];
  has_more?: boolean;
}

interface DeleteEnvelopeData {
  record_id_list?: string[];
}

function runLarkCli(args: string[]): string {
  try {
    const stdout = execFileSync(LARK_CLI, args, {
      encoding: 'utf-8',
      env: { ...process.env, LARK_CLI_NO_PROXY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    return stdout;
  } catch (e: any) {
    const errOut = e.stderr?.toString() ?? '';
    const stdOut = e.stdout?.toString() ?? '';
    throw new Error(`lark-cli failed (exit ${e.status}): ${errOut || stdOut || e.message}`);
  }
}

function runEnvelope<T>(args: string[]): T {
  const raw = runLarkCli(args);
  // Strip PowerShell CLIXML noise if present
  const cleaned = raw.replace(/#< CLIXML[\s\S]*?(?=\{)/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) {
    throw new Error(`No JSON envelope found in output: ${cleaned.slice(0, 300)}`);
  }
  const jsonStr = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr) as LarkEnvelope<T>;
  if (!parsed.ok) {
    throw new Error(`lark-cli envelope not ok: ${parsed.error?.message ?? jsonStr.slice(0, 300)}`);
  }
  if (!parsed.data) {
    throw new Error(`lark-cli envelope has no data: ${jsonStr.slice(0, 300)}`);
  }
  return parsed.data;
}

// Build FieldRow[] from lark-cli's columnar response shape.
function zipRows(
  rows: unknown[][],
  fieldNames: string[],
  recordIds: string[]
): FieldRow[] {
  if (rows.length !== recordIds.length) {
    throw new Error(`row/record_id length mismatch: rows=${rows.length}, ids=${recordIds.length}`);
  }
  return rows.map((row, i) => {
    const fields: Record<string, unknown> = {};
    fieldNames.forEach((name, j) => {
      fields[name] = row[j];
    });
    return { record_id: recordIds[i], fields };
  });
}

function upsertRecord(
  fields: Record<string, unknown>,
  recordId?: string
): FieldRow {
  const json = JSON.stringify(fields);
  const args = [
    'base', '+record-upsert',
    '--base-token', BASE_TOKEN,
    '--table-id', INGESTION_TABLE_ID,
    '--json', json,
  ];
  if (recordId) {
    args.push('--record-id', recordId);
  }
  const data = runEnvelope<UpsertEnvelopeData>(args);
  const rec = data.record;
  if (!rec) {
    throw new Error(`upsert returned no record: ${JSON.stringify(data)}`);
  }
  // create-mode: record_id_list present.
  // update-mode: record_id_list absent; fall back to the recordId we passed in.
  const id = rec.record_id_list?.[0] ?? recordId;
  if (!id) {
    throw new Error(`upsert returned no record_id and no recordId was passed: ${JSON.stringify(data)}`);
  }
  // Build stored fields for caller convenience.
  // create-mode: columnar shape (fields + data[0]).
  // update-mode: object shape (update: { field_name: value }).
  let storedFields: Record<string, unknown> = fields;
  if (rec.fields && rec.data && rec.data[0]) {
    const rebuilt: Record<string, unknown> = {};
    rec.fields.forEach((name, j) => {
      rebuilt[name] = rec.data![0][j];
    });
    storedFields = rebuilt;
  } else if (rec.update) {
    storedFields = { ...fields, ...rec.update };
  }
  return { record_id: id, fields: storedFields };
}

function searchByIngestionId(ingestionId: string): FieldRow[] {
  const json = JSON.stringify({
    keyword: ingestionId,
    search_fields: ['摄入 ID'],
    limit: 10,
  });
  const args = [
    'base', '+record-search',
    '--base-token', BASE_TOKEN,
    '--table-id', INGESTION_TABLE_ID,
    '--json', json,
    '--format', 'json',
  ];
  const data = runEnvelope<SearchEnvelopeData>(args);
  if (!data.data || !data.fields || !data.record_id_list) {
    return [];
  }
  return zipRows(data.data, data.fields, data.record_id_list);
}

function deleteRecord(recordId: string): void {
  const args = [
    'base', '+record-delete',
    '--base-token', BASE_TOKEN,
    '--table-id', INGESTION_TABLE_ID,
    '--record-id', recordId,
    '--yes',
  ];
  runEnvelope<DeleteEnvelopeData>(args);
}

// Build a complete IngestionTask matching tests/unit/repositories/feishu-task-repository.test.ts makeTask()
function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ingestion_id: 'ing_smoke_001',
    idempotency_key: 'idem_smoke_abc',
    status: 'received',
    source_system: 'feishu_form',
    source_record_id: 'rec_source_001',
    source_type: 'chat_text',
    target_domain: 'customer_consultation',
    content: '你好，预算3000左右',
    submitted_at: '2026-07-17T10:00:00.000Z',
    timezone: 'Asia/Shanghai',
    submitted_by: 'operator_1',
    dry_run: true,
    attempt_count: 0,
    warnings: [],
    errors: [],
    duplicate_candidates: [],
    created_at: '2026-07-17T10:00:01.000Z',
    updated_at: '2026-07-17T10:00:01.000Z',
    ...overrides,
  };
}

// Build fields the same way FeishuTaskRepository.buildFields does.
// Note: created_at/updated_at are passed as ms timestamps (number) — this is what
// FeishuTaskRepository.toFeishuDatetime() does and what the Feishu Base API expects
// for datetime fields.
function buildFields(task: Record<string, unknown>): Record<string, unknown> {
  const createdAt = Date.parse(task.created_at as string);
  const updatedAt = Date.parse(task.updated_at as string);
  return {
    '摄入 ID': task.ingestion_id,
    '幂等键': task.idempotency_key,
    '状态': task.status,
    '来源记录 ID': task.source_record_id,
    '任务快照 JSON': JSON.stringify(task),
    '创建时间': createdAt,
    '更新时间': updatedAt,
  };
}

// Feishu Base returns single-select fields as ["received"] (array) and datetime as
// "2026-07-17 18:00:01" (string). Normalize for comparison.
function normalizeFieldValue(v: unknown): unknown {
  if (Array.isArray(v) && v.length === 1) {
    return v[0];
  }
  return v;
}

function assertDeepEqual(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(normalizeFieldValue(actual));
  const e = JSON.stringify(normalizeFieldValue(expected));
  if (a !== e) {
    throw new Error(`ASSERT FAIL [${msg}]\n  actual:   ${a}\n  expected: ${e}`);
  }
}

function main() {
  console.log('=== TASK-001 真实 Base 结构核验（via lark-cli）===');
  console.log(`Base: ${BASE_TOKEN}`);
  console.log(`Ingestion table: ${INGESTION_TABLE_ID}`);
  console.log('');

  const createdRecordIds: string[] = [];

  try {
    // ----- Pre-clean: ensure no leftover records with our test ingestion_id -----
    console.log('[pre-clean] Searching for any leftover smoke test records...');
    const existing = searchByIngestionId('ing_smoke_001');
    if (existing.length > 0) {
      console.log(`  Found ${existing.length} leftover record(s); deleting...`);
      for (const r of existing) {
        deleteRecord(r.record_id);
        console.log(`  deleted: ${r.record_id}`);
      }
    } else {
      console.log('  No leftovers.');
    }
    console.log('');

    // ----- Step 1: Create via upsert (no record-id) -----
    console.log('[step 1] Create record via upsert (no record-id)...');
    const task1 = makeTask();
    const fields1 = buildFields(task1);
    const created = upsertRecord(fields1);
    createdRecordIds.push(created.record_id);
    console.log(`  -> record_id: ${created.record_id}`);
    console.log('');

    // ----- Step 2: Search by 摄入 ID and verify deep equality of snapshot -----
    console.log('[step 2] Search by 摄入 ID and verify snapshot deep equality...');
    const found = searchByIngestionId('ing_smoke_001');
    if (found.length !== 1) {
      throw new Error(`Expected exactly 1 record, got ${found.length}`);
    }
    const fetchedFields = found[0].fields;
    assertDeepEqual(fetchedFields['摄入 ID'], 'ing_smoke_001', '摄入 ID');
    assertDeepEqual(fetchedFields['幂等键'], 'idem_smoke_abc', '幂等键');
    assertDeepEqual(fetchedFields['状态'], 'received', '状态');
    assertDeepEqual(fetchedFields['来源记录 ID'], 'rec_source_001', '来源记录 ID');
    const fetchedSnapshotRaw = fetchedFields['任务快照 JSON'];
    if (typeof fetchedSnapshotRaw !== 'string') {
      throw new Error(`Snapshot field is not string: ${typeof fetchedSnapshotRaw}`);
    }
    const fetchedSnapshot = JSON.parse(fetchedSnapshotRaw);
    assertDeepEqual(fetchedSnapshot, task1, '任务快照 JSON 深度等价');
    console.log('  -> all fields deep-equal ✓');
    console.log('');

    // ----- Step 3: Update via upsert (with record-id), change status -----
    console.log('[step 3] Update record (same ingestion_id, new status=pending_review)...');
    const task2 = makeTask({
      status: 'pending_review',
      updated_at: '2026-07-17T11:00:00.000Z',
      review_record_id: 'rec_review_xyz',
    });
    const fields2 = buildFields(task2);
    const updated = upsertRecord(fields2, created.record_id);
    if (updated.record_id !== created.record_id) {
      throw new Error(`record_id changed after update: ${updated.record_id} vs ${created.record_id}`);
    }
    console.log(`  -> same record_id: ${updated.record_id}`);
    console.log('');

    // ----- Step 4: Search again, verify exactly 1 record with updated status -----
    console.log('[step 4] Search again, verify single record with updated status...');
    const found2 = searchByIngestionId('ing_smoke_001');
    if (found2.length !== 1) {
      throw new Error(`Expected exactly 1 record after update, got ${found2.length}`);
    }
    const fetched2 = found2[0].fields;
    assertDeepEqual(fetched2['状态'], 'pending_review', '状态 updated');
    const fetched2SnapshotRaw = fetched2['任务快照 JSON'];
    if (typeof fetched2SnapshotRaw !== 'string') {
      throw new Error(`Snapshot field is not string after update: ${typeof fetched2SnapshotRaw}`);
    }
    const fetched2Snapshot = JSON.parse(fetched2SnapshotRaw);
    assertDeepEqual(fetched2Snapshot, task2, 'updated snapshot deep-equal');
    console.log('  -> status updated, snapshot deep-equal ✓');
    console.log('');

    console.log('=== ALL SMOKE TESTS PASSED ===');
  } finally {
    // ----- Step 5: Cleanup -----
    console.log('');
    console.log('[cleanup] Deleting created record(s)...');
    for (const id of createdRecordIds) {
      try {
        deleteRecord(id);
        console.log(`  deleted: ${id}`);
      } catch (e: any) {
        console.error(`  FAILED to delete ${id}: ${e.message}`);
      }
    }
    // Final verification: search again to ensure clean
    try {
      const after = searchByIngestionId('ing_smoke_001');
      if (after.length === 0) {
        console.log('  cleanup verified: 0 records remain.');
      } else {
        console.error(`  WARNING: ${after.length} records still remain after cleanup!`);
        for (const r of after) {
          console.error(`    leftover: ${r.record_id}`);
        }
      }
    } catch (e: any) {
      console.error(`  cleanup verification failed: ${e.message}`);
    }
  }
}

main();
