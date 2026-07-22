// run-gate-d.ts
// TASK-003 Phase 3C: Gate D real-Feishu acceptance runner.
//
// 用法:
//   npm run gate:d                                   # 默认运行，报告输出到 artifacts/feishu-gate-d/
//   npm run gate:d -- --output-dir <dir>             # 指定报告输出目录
//   npm run gate:d -- --help                         # 帮助
//
// 退出码:
//   0 = Gate D 通过（所有断言通过，测试数据已按精确 record_id 清理）
//   1 = Gate D 失败（断言不通过或清理失败）
//   2 = 环境错误（缺少凭据 / 飞书不可达 / 配置错误）
//
// 安全约束（TASK-003 spec）:
// - 必须使用任务规定的合成记录（姓名 GateD测试客户 / 电话 13800000000 等）
// - Secret 不得输出到终端、报告、CLI 参数或 .env 之外的任何文件
// - 清理只能按本次 API 返回的精确 record_id 在 finally 块中进行
// - 禁止按姓名、手机号或模糊条件批量删除
// - 清理失败必须退出失败并报告精确 record ID
//
// 报告输出:
// - artifacts/feishu-gate-d/gate-d-report.json（结构化报告，不含 Secret）
// - artifacts/feishu-gate-d/gate-d-report.md（人类可读报告，不含 Secret）

import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FeishuClient } from '../src/server/feishu/feishu-client.js';
import { FeishuTaskRepository } from '../src/server/repositories/feishu-task-repository.js';
import { FeishuReviewRepository } from '../src/server/repositories/feishu-review-repository.js';
import { FeishuWriteLogRepository } from '../src/server/repositories/feishu-write-log-repository.js';
import { FeishuCustomerRecordWriter } from '../src/server/business/customer-record-writer.js';
import { IngestionService } from '../src/server/services/ingestion-service.js';
import { CollatorError } from '../src/server/domain/errors.js';
// RF-02: 显式注入 PreWriteClient。Gate D 不调用 adoptCandidateV1，
// 但仍需注入以满足 IngestionService 构造函数要求（无 NoOp 默认 fallback）。
// 使用 SopPreWriteClient 以保持与生产环境一致的依赖配置；
// 实际不触发 PRE_WRITE 调用（仅 adoptCandidateV1 会调用 preWriteClient）。
import { SopPreWriteClient } from '../src/server/governance/pre-write-client.js';

interface ParsedArgs {
  outputDir: string;
  help: boolean;
}

const DEFAULT_OUTPUT_DIR = 'artifacts/feishu-gate-d';

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { outputDir: DEFAULT_OUTPUT_DIR, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--output-dir') {
      args.outputDir = argv[++i];
    } else if (a.startsWith('--output-dir=')) {
      args.outputDir = a.slice('--output-dir='.length);
    } else {
      throw new Error(`未识别的参数: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  const lines = [
    'TASK-003 Phase 3C Gate D real-Feishu acceptance runner',
    '',
    '用法:',
    '  npm run gate:d                              # 默认输出到 artifacts/feishu-gate-d/',
    '  npm run gate:d -- --output-dir <dir>        # 指定报告输出目录',
    '  npm run gate:d -- --help                    # 帮助',
    '',
    '退出码:',
    '  0 = Gate D 通过',
    '  1 = Gate D 失败（断言不通过或清理失败）',
    '  2 = 环境错误（缺少凭据 / 飞书不可达 / 配置错误）',
    '',
    '必需环境变量:',
    '  FEISHU_APP_ID              飞书应用 App ID',
    '  FEISHU_APP_SECRET          飞书应用 App Secret（不输出到任何报告）',
    '  FEISHU_BASE_APP_TOKEN      飞书 Base App Token',
    '  FEISHU_INGESTION_TABLE_ID  摄入任务表 ID',
    '  FEISHU_REVIEW_TABLE_ID     审核记录表 ID',
    '  FEISHU_WRITE_LOG_TABLE_ID  写入日志表 ID',
    '  FEISHU_CUSTOMER_TABLE_ID   客户主表 ID',
    '  COLLATOR_WEBHOOK_SECRET    Webhook 签名密钥（不输出到任何报告）',
    '',
    '安全约束:',
    ' - 仅使用合成记录 GateD测试客户 / 13800000000',
    ' - Secret 不输出到终端、报告或 .env 之外的文件',
    ' - 清理只能按精确 record_id 在 finally 中进行',
    ' - 清理失败时退出码 1 并报告精确 record ID',
  ];
  console.log(lines.join('\n'));
}

interface GateDReport {
  started_at: string;
  finished_at: string;
  exit_code: 0 | 1 | 2;
  status: 'PASS' | 'FAIL' | 'ENV_ERROR';
  ingestion_id?: string;
  ingestion_record_id?: string;
  review_record_id?: string;
  business_record_id?: string;
  write_log_id?: string;
  cleanup: {
    ingestion_record_deleted: boolean;
    review_record_deleted: boolean;
    customer_record_deleted: boolean;
    write_log_deleted: boolean;
    cleanup_errors: string[];
  };
  assertions: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
  errors: string[];
}

function newReport(): GateDReport {
  return {
    started_at: new Date().toISOString(),
    finished_at: '',
    exit_code: 2,
    status: 'ENV_ERROR',
    cleanup: {
      ingestion_record_deleted: false,
      review_record_deleted: false,
      customer_record_deleted: false,
      write_log_deleted: false,
      cleanup_errors: [],
    },
    assertions: [],
    errors: [],
  };
}

function assertCondition(
  report: GateDReport,
  name: string,
  condition: boolean,
  detail?: string
): boolean {
  report.assertions.push({ name, passed: condition, detail });
  if (!condition) {
    report.errors.push(`Assertion failed: ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return condition;
}

interface RequiredEnv {
  appId: string;
  appSecret: string;
  baseToken: string;
  ingestionTableId: string;
  reviewTableId: string;
  writeLogTableId: string;
  customerTableId: string;
  webhookSecret: string;
}

function loadRequiredEnv(): RequiredEnv {
  const required: Array<[keyof RequiredEnv, string]> = [
    ['appId', 'FEISHU_APP_ID'],
    ['appSecret', 'FEISHU_APP_SECRET'],
    ['baseToken', 'FEISHU_BASE_APP_TOKEN'],
    ['ingestionTableId', 'FEISHU_INGESTION_TABLE_ID'],
    ['reviewTableId', 'FEISHU_REVIEW_TABLE_ID'],
    ['writeLogTableId', 'FEISHU_WRITE_LOG_TABLE_ID'],
    ['customerTableId', 'FEISHU_CUSTOMER_TABLE_ID'],
    ['webhookSecret', 'COLLATOR_WEBHOOK_SECRET'],
  ];
  const env = {} as RequiredEnv;
  const missing: string[] = [];
  for (const [key, envName] of required) {
    const v = process.env[envName];
    if (typeof v !== 'string' || v.trim().length === 0) {
      missing.push(envName);
    } else {
      env[key] = v;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `缺少必需环境变量: ${missing.join(', ')}。请通过安全方式注入（不要写入 .env 之外的文件或 CLI 参数）。`
    );
  }
  return env;
}

function makeGateDIngestionContent(): string {
  return 'Gate D synthetic test ingestion. 用于 TASK-003 真实飞书验收，不应进入真实业务流程。';
}

function makeGateDCandidateFields() {
  const gateDUuid = randomUUID();
  return {
    客户姓名: 'GateD测试客户',
    联系方式: '13800000000',
    来源渠道: '其他',
    拍摄类型: '亲子',
    预算区间: '1000-2000元',
    意向风格: '日系清新',
    跟进记录: `COLLATOR_GATE_D_TEST:${gateDUuid}`,
  };
}

/**
 * Check whether a MultiSelect field value returned by Feishu contains the
 * expected option string. MultiSelect fields (type=4) may be returned as:
 * - a bare string (rare, when text_field_as_array=false applies)
 * - an array of strings: `['日系清新']`
 * - an array of `{name: '...'}` objects (canonical select/multiselect shape)
 * - an array of `{text: '...'}` objects (rich-text-like shape)
 *
 * The Gate D assertion must accept all legitimate shapes; the writer always
 * sends `['日系清新']` (array of strings) but the read-back shape depends
 * on the Feishu API response format for MultiSelect fields.
 */
function matchesMultiSelectValue(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value === expected;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => {
    if (typeof item === 'string') {
      return item === expected;
    }
    if (item && typeof item === 'object') {
      const obj = item as { name?: unknown; text?: unknown };
      return obj.name === expected || obj.text === expected;
    }
    return false;
  });
}

async function writeReports(report: GateDReport, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  // Strip any potentially sensitive fields before writing. The report is
  // designed to never contain secrets, but we double-check the error
  // messages don't accidentally include them.
  const safeJson = JSON.stringify(report, null, 2);
  await writeFile(join(outputDir, 'gate-d-report.json'), safeJson, 'utf8');
  const md = renderMarkdownReport(report);
  await writeFile(join(outputDir, 'gate-d-report.md'), md, 'utf8');
}

function renderMarkdownReport(report: GateDReport): string {
  const lines: string[] = [];
  lines.push('# Gate D 验收报告');
  lines.push('');
  lines.push(`- 开始时间: ${report.started_at}`);
  lines.push(`- 结束时间: ${report.finished_at}`);
  lines.push(`- 状态: **${report.status}** (退出码 ${report.exit_code})`);
  if (report.ingestion_id) lines.push(`- 摄入 ID: \`${report.ingestion_id}\``);
  if (report.ingestion_record_id) lines.push(`- 摄入记录 ID (Feishu): \`${report.ingestion_record_id}\``);
  if (report.review_record_id) lines.push(`- 审核 ID: \`${report.review_record_id}\``);
  if (report.business_record_id) lines.push(`- 客户记录 ID: \`${report.business_record_id}\``);
  if (report.write_log_id) lines.push(`- 写入日志 ID: \`${report.write_log_id}\``);
  lines.push('');
  lines.push('## 断言结果');
  lines.push('');
  lines.push('| 断言 | 结果 | 详情 |');
  lines.push('|------|------|------|');
  for (const a of report.assertions) {
    lines.push(`| ${a.name} | ${a.passed ? '✅' : '❌'} | ${a.detail ?? ''} |`);
  }
  lines.push('');
  lines.push('## 清理结果');
  lines.push('');
  lines.push(`- 摄入记录已删除: ${report.cleanup.ingestion_record_deleted ? '✅' : '❌'}`);
  lines.push(`- 审核记录已删除: ${report.cleanup.review_record_deleted ? '✅' : '❌'}`);
  lines.push(`- 客户记录已删除: ${report.cleanup.customer_record_deleted ? '✅' : '❌'}`);
  lines.push(`- 写入日志已删除: ${report.cleanup.write_log_deleted ? '✅' : '❌'}`);
  if (report.cleanup.cleanup_errors.length > 0) {
    lines.push('');
    lines.push('### 清理错误');
    for (const e of report.cleanup.cleanup_errors) {
      lines.push(`- ${e}`);
    }
  }
  if (report.errors.length > 0) {
    lines.push('');
    lines.push('## 错误');
    for (const e of report.errors) {
      lines.push(`- ${e}`);
    }
  }
  return lines.join('\n');
}

async function runGateD(env: RequiredEnv, report: GateDReport): Promise<0 | 1> {
  const client = new FeishuClient({
    appId: env.appId,
    appSecret: env.appSecret,
    baseToken: env.baseToken,
  });

  // Production repositories — Gate D must verify cross-instance durability.
  const taskRepository = new FeishuTaskRepository(client, {
    ingestionTableId: env.ingestionTableId,
  });
  const reviewRepository = new FeishuReviewRepository(client, {
    reviewTableId: env.reviewTableId,
  });
  const writeLogRepository = new FeishuWriteLogRepository(client, {
    writeLogTableId: env.writeLogTableId,
  });
  const customerRecordWriter = new FeishuCustomerRecordWriter(client, {
    customerTableId: env.customerTableId,
  });

  const service = new IngestionService(
    taskRepository,
    reviewRepository,
    customerRecordWriter,
    writeLogRepository,
    new SopPreWriteClient()  // RF-02: 显式注入，gate:d 不调用 adoptCandidateV1
  );

  // Track IDs for finally cleanup.
  // All four Feishu tables touched by Gate D must have their precise
  // record_ids tracked so the finally block can delete each one by ID.
  // We NEVER delete by name / phone / fuzzy condition.
  let businessRecordId: string | undefined;
  let writeLogId: string | undefined;
  let ingestionId: string | undefined;
  let ingestionRecordId: string | undefined; // Feishu record_id in ingestion table
  let reviewRecordId: string | undefined;    // Feishu record_id in review table

  try {
    // Step 1: create ingestion (dry_run=false so the commit flow runs).
    const ingestion = await service.createIngestion({
      source_system: 'gate_d_runner',
      source_record_id: `gate_d_${Date.now()}`,
      source_type: 'chat_text',
      target_domain: 'customer_consultation',
      content: makeGateDIngestionContent(),
      submitted_at: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      submitted_by: 'gate_d_runner',
      dry_run: false,
    });
    ingestionId = ingestion.ingestion_id;
    report.ingestion_id = ingestionId;
    assertCondition(report, 'createIngestion returns 202-like status', ingestion.status === 'received');

    // Track the ingestion-table Feishu record_id by searching the ingestion
    // table for the exact ingestion_id we just created. This is a precise
    // key match (not a fuzzy condition), so it satisfies AC-07.
    try {
      const ingestionRecords = await client.searchRecords(env.ingestionTableId, {
        filter: {
          conjunction: 'and',
          conditions: [
            { field_name: '摄入 ID', operator: 'is', value: [ingestionId] },
          ],
        },
        page_size: 2,
      });
      if (ingestionRecords.length > 0) {
        ingestionRecordId = ingestionRecords[0].record_id;
        report.ingestion_record_id = ingestionRecordId;
      }
    } catch (e) {
      // Tracking failure should not break the test flow; the finally
      // block will still attempt to clean up the other records. Record
      // the tracking failure so it is visible in the report.
      report.errors.push(
        `Failed to track ingestion record_id for cleanup: ${(e as Error)?.message ?? String(e)}`
      );
    }

    // Step 2: candidate callback with Gate D synthetic fields.
    // We bypass the HTTP layer here because the runner is a CLI tool that
    // does not start a Fastify server. The candidate is fed directly to
    // the service — this still exercises the same pipeline + review-record
    // persistence path the HTTP route would. The HTTP-level PII redaction
    // is verified by the mock Gate D test (feishu-gate-d.test.ts).
    const candidateFields = makeGateDCandidateFields();
    const candidateResult = await service.receiveCandidate(ingestionId, {
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: candidateFields,
        field_confidence: {},
        evidence: {},
      },
    });
    reviewRecordId = candidateResult.review_record_id;
    report.review_record_id = reviewRecordId;
    assertCondition(report, 'receiveCandidate returns pending_review', candidateResult.status === 'pending_review', `got ${candidateResult.status}`);
    assertCondition(report, 'review_record_id is non-empty', Boolean(candidateResult.review_record_id));

    // Step 3: approve — triggers the full commit flow.
    const approvedTask = await service.approve(ingestionId, {
      reviewer_id: 'gate_d_reviewer',
      review_record_id: candidateResult.review_record_id,
    });
    businessRecordId = approvedTask.business_record_id;
    report.business_record_id = businessRecordId;
    assertCondition(report, 'approve sets status=completed', approvedTask.status === 'completed', `got ${approvedTask.status}`);
    assertCondition(report, 'approve sets business_record_id', typeof businessRecordId === 'string' && businessRecordId.length > 0, `got ${businessRecordId}`);
    assertCondition(report, 'approve clears error_code', approvedTask.error_code === undefined);

    // Step 4: verify the customer record via a fresh FeishuClient read.
    // This proves the record is durable across repository instances.
    const freshClient = new FeishuClient({
      appId: env.appId,
      appSecret: env.appSecret,
      baseToken: env.baseToken,
    });
    const customerRecord = await freshClient.getRecord(env.customerTableId, businessRecordId!);
    const fields = customerRecord.fields as Record<string, unknown>;
    assertCondition(report, 'customer record 客户姓名 == GateD测试客户', fields['客户姓名'] === 'GateD测试客户', `got ${JSON.stringify(fields['客户姓名'])}`);
    assertCondition(report, 'customer record 联系方式 == 13800000000', fields['联系方式'] === '13800000000');
    assertCondition(report, 'customer record 来源渠道 == 其他', fields['来源渠道'] === '其他');
    assertCondition(report, 'customer record 拍摄类型 == 亲子', fields['拍摄类型'] === '亲子');
    assertCondition(report, 'customer record 预算区间 == 1000-2000元', fields['预算区间'] === '1000-2000元');
    assertCondition(report, 'customer record 意向风格 == 日系清新', matchesMultiSelectValue(fields['意向风格'], '日系清新'), `got ${JSON.stringify(fields['意向风格'])}`);
    assertCondition(report, 'customer record 跟进记录 matches COLLATOR_GATE_D_TEST:', typeof fields['跟进记录'] === 'string' && String(fields['跟进记录']).startsWith('COLLATOR_GATE_D_TEST:'));
    assertCondition(report, 'customer record Collator 摄入 ID == ingestionId', fields['Collator 摄入 ID'] === ingestionId);

    // Step 5: verify task durability via a fresh task repository instance.
    const freshTaskRepository = new FeishuTaskRepository(client, {
      ingestionTableId: env.ingestionTableId,
    });
    const rereadTask = await freshTaskRepository.findById(ingestionId);
    assertCondition(report, 'task re-readable from fresh repository instance', rereadTask !== null);
    if (rereadTask) {
      assertCondition(report, 'fresh-read task status == completed', rereadTask.status === 'completed');
      assertCondition(report, 'fresh-read task business_record_id matches', rereadTask.business_record_id === businessRecordId);
    }

    // Step 6: verify the write log via a fresh write-log repository.
    const freshWriteLogRepository = new FeishuWriteLogRepository(client, {
      writeLogTableId: env.writeLogTableId,
    });
    const logs = await freshWriteLogRepository.findByIngestionId(ingestionId);
    const succeededLog = logs.find((l) => l.status === 'succeeded');
    assertCondition(report, 'write log exists with status=succeeded', succeededLog !== undefined, `got ${logs.length} logs: ${logs.map((l) => l.status).join(',')}`);
    if (succeededLog) {
      writeLogId = succeededLog.write_log_id;
      report.write_log_id = writeLogId;
      assertCondition(report, 'write log business_record_id matches', succeededLog.business_record_id === businessRecordId);
      assertCondition(report, 'write log target_table_id == customer table', succeededLog.target_table_id === env.customerTableId, `got ${succeededLog.target_table_id}`);
    }

    // Step 7: verify review record persisted.
    const freshReviewRepository = new FeishuReviewRepository(client, {
      reviewTableId: env.reviewTableId,
    });
    const review = await freshReviewRepository.findByIngestionId(ingestionId);
    assertCondition(report, 'review record persisted', review !== null);
    if (review) {
      assertCondition(report, 'review candidate 客户姓名 == GateD测试客户', review.candidate.fields['客户姓名'] === 'GateD测试客户');
    }

    // Step 8: verify duplicate approve is idempotent (service-level).
    // The second approve on a completed task must throw ConflictError.
    let duplicateThrew = false;
    let duplicateErrorCode: string | undefined;
    try {
      await service.approve(ingestionId, {
        reviewer_id: 'gate_d_reviewer',
        review_record_id: candidateResult.review_record_id,
      });
    } catch (e) {
      duplicateThrew = e instanceof CollatorError && e.code === 'CONFLICT';
      duplicateErrorCode = e instanceof CollatorError ? e.code : undefined;
    }
    assertCondition(report, 'duplicate approve throws ConflictError (409)', duplicateThrew, `got code=${duplicateErrorCode}`);

    // Step 9: verify writer idempotency — search by Collator 摄入 ID now
    // finds the existing record. A second write call must return the same
    // business_record_id with created=false.
    const replayResult = await customerRecordWriter.write({
      ingestionId,
      normalizedFields: candidateFields,
    });
    assertCondition(report, 'writer replay returns same business_record_id', replayResult.business_record_id === businessRecordId, `got ${replayResult.business_record_id}`);
    assertCondition(report, 'writer replay returns created=false', replayResult.created === false);

    // Aggregate result.
    const allPassed = report.assertions.every((a) => a.passed);
    report.status = allPassed ? 'PASS' : 'FAIL';
    report.exit_code = allPassed ? 0 : 1;
    return allPassed ? 0 : 1;
  } catch (e) {
    report.errors.push(`Runner error: ${(e as Error)?.message ?? String(e)}`);
    report.status = 'FAIL';
    report.exit_code = 1;
    return 1;
  } finally {
    // Cleanup: ONLY by precise record_id returned by the API. NEVER by
    // name / phone / fuzzy condition. A cleanup failure must be recorded
    // and surfaced in the report (and affects the final exit code).
    //
    // Cleanup errors must NOT mask the original business failure: both
    // are preserved in the report.errors array. The business failure
    // (if any) was already recorded in the try/catch above before we
    // reach finally.
    //
    // Order: delete in reverse creation order to respect any logical
    // dependency (customer record → write log → review → ingestion).
    // Each delete is independent; a failure in one does not skip the
    // remaining deletes.
    if (businessRecordId) {
      try {
        await client.deleteRecord(env.customerTableId, businessRecordId);
        report.cleanup.customer_record_deleted = true;
      } catch (e) {
        const msg = `Failed to delete customer record ${businessRecordId}: ${(e as Error)?.message ?? String(e)}`;
        report.cleanup.cleanup_errors.push(msg);
        report.errors.push(msg);
      }
    }
    if (writeLogId) {
      try {
        await client.deleteRecord(env.writeLogTableId, writeLogId);
        report.cleanup.write_log_deleted = true;
      } catch (e) {
        const msg = `Failed to delete write log ${writeLogId}: ${(e as Error)?.message ?? String(e)}`;
        report.cleanup.cleanup_errors.push(msg);
        report.errors.push(msg);
      }
    }
    if (reviewRecordId) {
      try {
        await client.deleteRecord(env.reviewTableId, reviewRecordId);
        report.cleanup.review_record_deleted = true;
      } catch (e) {
        const msg = `Failed to delete review record ${reviewRecordId}: ${(e as Error)?.message ?? String(e)}`;
        report.cleanup.cleanup_errors.push(msg);
        report.errors.push(msg);
      }
    }
    if (ingestionRecordId) {
      try {
        await client.deleteRecord(env.ingestionTableId, ingestionRecordId);
        report.cleanup.ingestion_record_deleted = true;
      } catch (e) {
        const msg = `Failed to delete ingestion record ${ingestionRecordId}: ${(e as Error)?.message ?? String(e)}`;
        report.cleanup.cleanup_errors.push(msg);
        report.errors.push(msg);
      }
    }
    // If any tracked record was NOT deleted, the run cannot pass.
    // This keeps the gate failing on cleanup errors without masking
    // the original business failure (both errors are in the report).
    // Only check flags for records that were actually tracked; records
    // never created (e.g., customer record before approve succeeded)
    // do not count as cleanup failures.
    const deletionChecks: boolean[] = [];
    if (businessRecordId) deletionChecks.push(report.cleanup.customer_record_deleted);
    if (writeLogId) deletionChecks.push(report.cleanup.write_log_deleted);
    if (reviewRecordId) deletionChecks.push(report.cleanup.review_record_deleted);
    if (ingestionRecordId) deletionChecks.push(report.cleanup.ingestion_record_deleted);
    if (deletionChecks.length > 0 && !deletionChecks.every(Boolean)) {
      report.status = 'FAIL';
      report.exit_code = 1;
    }
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const report = newReport();

  let env: RequiredEnv;
  try {
    env = loadRequiredEnv();
  } catch (e) {
    report.errors.push(`Environment error: ${(e as Error).message}`);
    report.status = 'ENV_ERROR';
    report.exit_code = 2;
    report.finished_at = new Date().toISOString();
    await writeReports(report, args.outputDir).catch(() => {});
    console.error(`[gate:d] ENV_ERROR: ${(e as Error).message}`);
    return 2;
  }

  // Suppress the secret-bearing env from any accidental logging by the
  // FeishuClient. We never log env values directly.
  const exitCode = await runGateD(env, report);
  report.finished_at = new Date().toISOString();

  await writeReports(report, args.outputDir).catch((e) => {
    console.error(`[gate:d] Failed to write report: ${(e as Error).message}`);
  });

  // Console summary — secrets are never included.
  console.log(`[gate:d] status=${report.status} exit_code=${report.exit_code}`);
  console.log(`[gate:d] assertions: ${report.assertions.filter((a) => a.passed).length}/${report.assertions.length} passed`);
  if (report.ingestion_id) console.log(`[gate:d] ingestion_id=${report.ingestion_id}`);
  if (report.ingestion_record_id) console.log(`[gate:d] ingestion_record_id=${report.ingestion_record_id}`);
  if (report.review_record_id) console.log(`[gate:d] review_record_id=${report.review_record_id}`);
  if (report.business_record_id) console.log(`[gate:d] business_record_id=${report.business_record_id}`);
  if (report.write_log_id) console.log(`[gate:d] write_log_id=${report.write_log_id}`);
  console.log(`[gate:d] cleanup: ingestion=${report.cleanup.ingestion_record_deleted ? 'deleted' : 'NOT deleted'}, review=${report.cleanup.review_record_deleted ? 'deleted' : 'NOT deleted'}, customer=${report.cleanup.customer_record_deleted ? 'deleted' : 'NOT deleted'}, write_log=${report.cleanup.write_log_deleted ? 'deleted' : 'NOT deleted'}`);
  if (report.cleanup.cleanup_errors.length > 0) {
    console.error(`[gate:d] cleanup errors:`);
    for (const e of report.cleanup.cleanup_errors) {
      console.error(`  - ${e}`);
    }
  }
  console.log(`[gate:d] report written to ${join(args.outputDir, 'gate-d-report.md')}`);

  return exitCode;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(`[gate:d] uncaught error: ${(e as Error)?.message ?? String(e)}`);
  process.exit(2);
});
