#!/usr/bin/env node
/**
 * build-schema-alignment.mjs
 *
 * AC-07 / AC-08: produce the payload -> live-Base-schema alignment matrix for
 * the Project table, and *verify* it rather than merely describing it.
 *
 * Inputs
 *  - evidence/r3-schema/feishu-tables-schema.json  (exported from the live Base)
 *  - dist/server/business/project-record-writer.js (the option allowlists the
 *    writer actually enforces — imported, so the matrix cannot drift from code)
 *
 * Checks performed per mapped field:
 *  - the Feishu column exists
 *  - it is not read-only
 *  - the serializer matches the column's declared type
 *  - for Select columns, the writer's allowlist equals the live option set
 *
 * READ-ONLY with respect to Feishu: performs no network calls at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const schemaPath = resolve(repoRoot, 'evidence/r3-schema/feishu-tables-schema.json');
const outPath = resolve(repoRoot, 'evidence/r3-schema/project-schema-alignment.json');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const { PROJECT_TYPE_OPTIONS, PROJECT_STYLE_OPTIONS } = await import(
  pathToFileURL(resolve(repoRoot, 'dist/server/business/project-record-writer.js')).href
);

const projectFields = new Map(schema.tables.project.fields.map((f) => [f.field_name, f]));

/**
 * The exact set of columns buildLiveProjectFields() may emit.
 * Anything outside this allowlist is dropped before the API call, which is why
 * candidate keys such as 预算区间 (a Customer-table column) can never reach the
 * Project create payload.
 */
const MAPPING = [
  {
    feishu_field: '项目名称',
    internal_keys: ['项目名称', 'project_name'],
    serializer: 'toFeishuText',
    validation: 'non-empty string; trimmed',
    notes: 'Also serves as the bounded natural key for idempotent search (the live table has no technical marker column).',
  },
  {
    feishu_field: '项目类型',
    internal_keys: ['项目类型', 'project_type'],
    serializer: 'toFeishuSingleSelect',
    validation: 'normalizeProjectType: client->客片, creative->创作; then must be an existing option',
    expect_options: PROJECT_TYPE_OPTIONS,
  },
  {
    feishu_field: '拍摄档期',
    internal_keys: ['拍摄档期', '拍摄日期', 'shoot_date'],
    serializer: 'toFeishuDateTime',
    validation:
      'epoch ms only. Accepts YYYY-MM-DD, YYYY/M/D, YYYY年M月D日, M月D日 (reference year), ISO+TZ. NO Date.parse fallback.',
    notes: 'ROOT CAUSE of FEISHU_COMMIT_FAILED: a raw OCR string here returns 1254064 DatetimeFieldConvFail.',
  },
  {
    feishu_field: '风格定位',
    internal_keys: ['风格定位', '风格要求'],
    serializer: 'toFeishuMultiSelect',
    validation: 'string[]; every option must already exist (Feishu auto-creates unknown options otherwise)',
    expect_options: PROJECT_STYLE_OPTIONS,
  },
  {
    feishu_field: '关联客户 ID',
    internal_keys: ['关联客户 ID', '客户关联'],
    serializer: 'toFeishuRelation',
    validation: 'record_id[] matching /^rec[A-Za-z0-9_-]+$/; display names rejected',
    notes: 'Feishu accepts a display name and silently stores an empty relation (record_ids:null), so shape is enforced client-side.',
  },
  ...['拍摄地点', '备注', '系列', '主题', '项目Wiki文档', '项目云盘文件夹'].map((name) => ({
    feishu_field: name,
    internal_keys: [name],
    serializer: 'toFeishuText',
    validation: 'non-empty string; trimmed',
  })),
];

const SERIALIZER_EXPECTED_TYPE = {
  toFeishuText: ['Text'],
  toFeishuSingleSelect: ['SingleSelect'],
  toFeishuMultiSelect: ['MultiSelect'],
  toFeishuDateTime: ['DateTime'],
  toFeishuRelation: ['DuplexLink', 'SingleLink'],
};

const rows = [];
const problems = [];

for (const entry of MAPPING) {
  const field = projectFields.get(entry.feishu_field);
  const row = {
    feishu_field: entry.feishu_field,
    internal_keys: entry.internal_keys,
    serializer: entry.serializer,
    validation: entry.validation,
    ...(entry.notes ? { notes: entry.notes } : {}),
  };

  if (!field) {
    row.status = 'MISSING_IN_LIVE_SCHEMA';
    problems.push(`${entry.feishu_field}: column does not exist in the live Project table`);
    rows.push(row);
    continue;
  }

  row.feishu_type = field.field_type;
  row.feishu_expects = field.expects_value_shape;
  row.read_only = field.read_only;
  row.required = field.required;

  const issues = [];
  if (field.read_only) issues.push('column is read-only');

  const allowed = SERIALIZER_EXPECTED_TYPE[entry.serializer] ?? [];
  if (!allowed.includes(field.field_type)) {
    issues.push(`serializer ${entry.serializer} does not match column type ${field.field_type}`);
  }

  if (entry.expect_options) {
    const live = field.allowed_options ?? [];
    const declared = [...entry.expect_options];
    row.live_options = live;
    row.writer_allowlist = declared;
    const missing = declared.filter((o) => !live.includes(o));
    const extra = live.filter((o) => !declared.includes(o));
    if (missing.length) issues.push(`writer allows options absent from the Base: ${missing.join(', ')}`);
    if (extra.length) row.options_present_in_base_but_not_written = extra;
  }

  row.status = issues.length ? 'MISALIGNED' : 'ALIGNED';
  if (issues.length) {
    row.issues = issues;
    problems.push(`${entry.feishu_field}: ${issues.join('; ')}`);
  }
  rows.push(row);
}

const writtenNames = new Set(MAPPING.map((m) => m.feishu_field));
const notWritten = schema.tables.project.fields
  .filter((f) => !writtenNames.has(f.field_name))
  .map((f) => ({
    feishu_field: f.field_name,
    feishu_type: f.field_type,
    read_only: f.read_only,
    required: f.required,
    reason: f.read_only
      ? 'read-only column, never written'
      : 'outside the writer allowlist; not populated by this flow',
  }));

const requiredButUnwritten = notWritten.filter((f) => f.required);

const output = {
  generated_at: new Date().toISOString(),
  source_schema: 'evidence/r3-schema/feishu-tables-schema.json',
  schema_generated_at: schema.generated_at,
  table: 'project',
  live_field_count: schema.tables.project.field_count,
  written_field_count: MAPPING.length,
  summary: {
    aligned: rows.filter((r) => r.status === 'ALIGNED').length,
    misaligned: rows.filter((r) => r.status !== 'ALIGNED').length,
    required_columns_not_written: requiredButUnwritten.length,
    verdict: problems.length === 0 && requiredButUnwritten.length === 0 ? 'ALIGNED' : 'MISALIGNED',
  },
  matrix: rows,
  columns_not_written: notWritten,
  problems,
};

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stderr.write(
  `[alignment] ${output.summary.verdict}: ${output.summary.aligned}/${MAPPING.length} aligned, ` +
    `${requiredButUnwritten.length} required-but-unwritten -> ${outPath}\n`,
);
process.exitCode = output.summary.verdict === 'ALIGNED' ? 0 : 1;
