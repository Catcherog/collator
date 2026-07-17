// TEMP: 创建 Collator 运行表 + 客户表技术字段 | 创建日期 2026-07-17 | 预计删除日期 2026-07-20
// 用途：一次性调用 lark-cli 在目标 Base 创建 3 张运行表 + 客户表隐藏文本字段，输出真实表 ID 供写入 .env
// 执行：npx tsx src/scripts/temp/create-collator-tables.ts
// 清理：完成后由用户决定删除或保留
//
// 重要发现：lark-cli base +table-create --fields 在表+字段都成功创建后，
// 仍可能因内部重试返回 "table already exists" 错误（exit code 非 0）。
// 因此本脚本采用幂等策略：先 list 现有表，已存在则复用，不存在则创建后重新 list 确认。

import { execFileSync } from 'node:child_process';

const BASE_TOKEN = 'MwGMbF0Q0alPc6s3jOccovvOnob';
const CUSTOMER_TABLE_ID = 'tblmRVrUnfodlzlo';
const LARK_CLI = 'bin/lark-cli.exe';

interface FieldSpec {
  type: 'text' | 'select' | 'datetime' | 'number' | 'checkbox';
  name: string;
  multiple?: boolean;
  options?: Array<{ name: string }>;
  style?: { format?: string };
}

interface TableSpec {
  name: string;
  fields: FieldSpec[];
}

const INGESTION_STATUSES = [
  'received', 'dispatching', 'extracting', 'candidate_received', 'validating',
  'pending_review', 'approved', 'committing', 'completed', 'dispatch_failed',
  'extract_failed', 'validation_failed', 'review_rejected', 'commit_failed',
  'rollback_required', 'rolled_back',
];

const tables: TableSpec[] = [
  {
    name: 'Collator 摄入任务',
    fields: [
      { type: 'text', name: '摄入 ID' },
      { type: 'text', name: '幂等键' },
      { type: 'select', name: '状态', multiple: false, options: INGESTION_STATUSES.map((n) => ({ name: n })) },
      { type: 'text', name: '来源记录 ID' },
      { type: 'text', name: '任务快照 JSON' },
      { type: 'datetime', name: '创建时间', style: { format: 'yyyy/MM/dd HH:mm' } },
      { type: 'datetime', name: '更新时间', style: { format: 'yyyy/MM/dd HH:mm' } },
    ],
  },
  {
    name: 'Collator 审核任务',
    fields: [
      { type: 'text', name: '摄入 ID' },
      { type: 'select', name: '状态', multiple: false, options: INGESTION_STATUSES.map((n) => ({ name: n })) },
      { type: 'text', name: '候选 JSON' },
      { type: 'text', name: '标准化结果 JSON' },
      { type: 'text', name: '校验结果 JSON' },
      { type: 'text', name: '审核人' },
      { type: 'select', name: '审核决定', multiple: false, options: ['approved', 'rejected', 'modified'].map((n) => ({ name: n })) },
      { type: 'text', name: '人工修正 JSON' },
      { type: 'datetime', name: '更新时间', style: { format: 'yyyy/MM/dd HH:mm' } },
    ],
  },
  {
    name: 'Collator 写入日志',
    fields: [
      { type: 'text', name: '写入日志 ID' },
      { type: 'text', name: '摄入 ID' },
      { type: 'text', name: '目标表 ID' },
      { type: 'text', name: '业务记录 ID' },
      { type: 'select', name: '写入状态', multiple: false, options: ['pending', 'succeeded', 'failed', 'skipped_dry_run'].map((n) => ({ name: n })) },
      { type: 'text', name: '错误码' },
      { type: 'text', name: '脱敏错误消息' },
      { type: 'datetime', name: '创建时间', style: { format: 'yyyy/MM/dd HH:mm' } },
    ],
  },
];

interface LarkEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; hint?: string; code?: number };
}

interface TableListData {
  tables: Array<{ id: string; name: string }>;
}

interface FieldListData {
  fields: Array<{ id: string; name: string; type: string }>;
}

interface FieldCreateData {
  created?: boolean;
  field: { id: string; name: string };
}

function runLarkCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(LARK_CLI, args, {
      encoding: 'utf-8',
      env: { ...process.env, LARK_CLI_NO_PROXY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

function listTables(): Map<string, string> {
  const { stdout, stderr } = runLarkCli(['base', '+table-list', '--base-token', BASE_TOKEN]);
  const raw = stdout || stderr;
  if (!raw) throw new Error('table-list returned empty output');
  const parsed = JSON.parse(raw) as LarkEnvelope<TableListData>;
  if (!parsed.ok || !parsed.data?.tables) {
    throw new Error(`table-list failed: ${parsed.error?.message ?? raw.slice(0, 200)}`);
  }
  return new Map(parsed.data.tables.map((t) => [t.name, t.id]));
}

function listFields(tableId: string): Map<string, string> {
  const { stdout, stderr } = runLarkCli(['base', '+field-list', '--base-token', BASE_TOKEN, '--table-id', tableId]);
  const raw = stdout || stderr;
  if (!raw) throw new Error(`field-list for ${tableId} returned empty output`);
  const parsed = JSON.parse(raw) as LarkEnvelope<FieldListData>;
  if (!parsed.ok || !parsed.data?.fields) {
    throw new Error(`field-list failed: ${parsed.error?.message ?? raw.slice(0, 200)}`);
  }
  return new Map(parsed.data.fields.map((f) => [f.name, f.id]));
}

function createTableIdempotent(spec: TableSpec): string {
  const existing = listTables();
  if (existing.has(spec.name)) {
    const tableId = existing.get(spec.name)!;
    console.log(`Table "${spec.name}" already exists: ${tableId} — verifying fields`);
    const fields = listFields(tableId);
    const missingFields = spec.fields
      .map((f) => f.name)
      .filter((name) => !fields.has(name));
    if (missingFields.length > 0) {
      console.log(`  WARNING: missing fields: ${missingFields.join(', ')}`);
      console.log(`  Will add missing fields via +field-create`);
      for (const fieldName of missingFields) {
        const fieldSpec = spec.fields.find((f) => f.name === fieldName)!;
        addFieldToTable(tableId, fieldSpec);
      }
    } else {
      console.log(`  All ${spec.fields.length} fields present — reusing`);
    }
    return tableId;
  }

  console.log(`Creating table: ${spec.name}`);
  const fieldsJson = JSON.stringify(spec.fields);
  const { stdout, stderr, exitCode } = runLarkCli([
    'base', '+table-create',
    '--base-token', BASE_TOKEN,
    '--name', spec.name,
    '--fields', fieldsJson,
  ]);

  // lark-cli may return non-zero even when table was created (internal retry false error)
  // Re-list to check if the table was actually created
  const afterCreate = listTables();
  if (afterCreate.has(spec.name)) {
    const tableId = afterCreate.get(spec.name)!;
    console.log(`  -> table created: ${tableId} (lark-cli exit=${exitCode}, treated as success)`);
    // Verify fields
    const fields = listFields(tableId);
    const missingFields = spec.fields
      .map((f) => f.name)
      .filter((name) => !fields.has(name));
    if (missingFields.length > 0) {
      console.log(`  WARNING: missing fields after create: ${missingFields.join(', ')}`);
      for (const fieldName of missingFields) {
        const fieldSpec = spec.fields.find((f) => f.name === fieldName)!;
        addFieldToTable(tableId, fieldSpec);
      }
    }
    return tableId;
  }

  // Table really was not created
  const errRaw = stdout || stderr;
  throw new Error(`Failed to create table ${spec.name}: ${errRaw.slice(0, 300)}`);
}

function addFieldToTable(tableId: string, field: FieldSpec): void {
  console.log(`  Adding field "${field.name}" to ${tableId}`);
  const fieldJson = JSON.stringify(field);
  const { stdout, stderr } = runLarkCli([
    'base', '+field-create',
    '--base-token', BASE_TOKEN,
    '--table-id', tableId,
    '--json', fieldJson,
  ]);
  const raw = stdout || stderr;
  if (!raw) throw new Error(`field-create for "${field.name}" returned empty output`);
  const parsed = JSON.parse(raw) as LarkEnvelope<FieldCreateData>;
  if (!parsed.ok || !parsed.data?.field?.id) {
    throw new Error(`field-create for "${field.name}" failed: ${parsed.error?.message ?? raw.slice(0, 200)}`);
  }
  console.log(`    -> field_id: ${parsed.data.field.id}`);
}

function createCustomerFieldIdempotent(): string {
  const fields = listFields(CUSTOMER_TABLE_ID);
  if (fields.has('Collator 摄入 ID')) {
    const fieldId = fields.get('Collator 摄入 ID')!;
    console.log(`Field "Collator 摄入 ID" already exists on customer table: ${fieldId} — reusing`);
    return fieldId;
  }

  console.log(`Creating field "Collator 摄入 ID" on customer table ${CUSTOMER_TABLE_ID}`);
  const fieldJson = JSON.stringify({ type: 'text', name: 'Collator 摄入 ID' });
  const { stdout, stderr } = runLarkCli([
    'base', '+field-create',
    '--base-token', BASE_TOKEN,
    '--table-id', CUSTOMER_TABLE_ID,
    '--json', fieldJson,
  ]);
  const raw = stdout || stderr;
  if (!raw) throw new Error('field-create for customer field returned empty output');
  const parsed = JSON.parse(raw) as LarkEnvelope<FieldCreateData>;
  if (!parsed.ok || !parsed.data?.field?.id) {
    throw new Error(`Failed to create customer field: ${parsed.error?.message ?? raw.slice(0, 200)}`);
  }
  console.log(`  -> field_id: ${parsed.data.field.id}`);
  return parsed.data.field.id;
}

function main() {
  console.log('=== Collator 运行表创建脚本（幂等版）===');
  console.log(`Base: ${BASE_TOKEN}`);
  console.log(`Customer table: ${CUSTOMER_TABLE_ID}`);
  console.log('');

  const results: Record<string, string> = {};

  for (const spec of tables) {
    const tableId = createTableIdempotent(spec);
    results[spec.name] = tableId;
  }

  console.log('');
  const customerFieldId = createCustomerFieldIdempotent();
  results['Collator 摄入 ID (customer field)'] = customerFieldId;

  console.log('');
  console.log('=== 创建结果 ===');
  for (const [name, id] of Object.entries(results)) {
    console.log(`${name}: ${id}`);
  }

  console.log('');
  console.log('=== .env 配置（复制到 .env）===');
  console.log(`FEISHU_INGESTION_TABLE_ID=${results['Collator 摄入任务']}`);
  console.log(`FEISHU_REVIEW_TABLE_ID=${results['Collator 审核任务']}`);
  console.log(`FEISHU_WRITE_LOG_TABLE_ID=${results['Collator 写入日志']}`);
  console.log(`FEISHU_CUSTOMER_TABLE_ID=${CUSTOMER_TABLE_ID}`);
  console.log(`# Customer field ID (reference only, not needed in runtime config): ${customerFieldId}`);
}

main();
