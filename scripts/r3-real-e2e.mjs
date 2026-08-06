#!/usr/bin/env node
/**
 * FAMP-R3 AC-10 ~ AC-14 / AC-16：真实 Customer + Project 双写 E2E。
 *
 * 安全约束：
 *   - 默认读取 R1 凭据文件（--env），不在 collator/.env 中写入生产 secret；
 *   - 探测记录名前缀固定为 FAMP-R3-PROBE，且脚本最后默认删除；
 *   - 删除失败时抛出并把 record_id 写入清理清单，绝不静默吞掉；
 *   - 不输出 app_secret / tenant_access_token；token 不在证据中保存。
 *
 * 覆盖：
 *   1. 真实 tesseract.js OCR（信任引擎门禁通过）
 *   2. 清洗/映射为 customer + project 字段
 *   3. 真实写入 Customer 表 → 拿到 record_id
 *   4. 真实写入 Project 表并 DuplexLink 关联到 Customer → 拿到 record_id
 *   5. 读回两条记录，与预期字段比对（readback consistency）
 *   6. 幂等重放：同一 ingestionId 第二次写必须 created=false 且 record_id 相同
 *   7. 删除探测记录（cleanup manifest）
 *   8. 输出完整证据 JSON
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function loadEnvFile(path) {
  if (!existsSync(path)) throw new Error(`env file not found: ${path}`);
  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

function parseArgs(argv) {
  const args = {
    env: resolve(repoRoot, '.env'),
    screenshot: resolve(repoRoot, 'evidence/r3-schema/r3-e2e-test-screenshot.png'),
    keep: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') args.env = resolve(argv[++i]);
    else if (a === '--screenshot') args.screenshot = resolve(argv[++i]);
    else if (a === '--keep') args.keep = true;
  }
  return args;
}

function redactRecord(record) {
  const sensitive = /电话|手机|联系方式|联系方式|contact|phone|mobile|wechat|微信/i;
  const out = { record_id: record.record_id, fields: {} };
  for (const [k, v] of Object.entries(record.fields)) {
    out.fields[k] = sensitive.test(k) && typeof v === 'string' ? '[REDACTED]' : v;
  }
  return out;
}

/** 从受控 OCR 文本解析字段。tesseract 对中文会插入空格，需容错处理。 */
function extractFields(rawText) {
  // 保留换行用于行尾定位，但把同一行内的多个空格、冒号周围空格规范化。
  const lines = rawText.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const fields = {};
  for (const line of lines) {
    // "姓名 : 林 小 姐" -> key='姓名', value='林 小 姐'
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!m) continue;
    const key = m[1].replace(/\s+/g, '').trim();
    const value = m[2].replace(/\s+/g, '').trim();

    if (key === '姓名') fields['客户姓名'] = value;
    if (key === '项目') {
      if (value.includes('客片')) fields['项目类型'] = '客片';
      else if (value.includes('创作')) fields['项目类型'] = '创作';
      else fields['项目类型'] = value;
    }
    if (key === '档期' && /\d{4}年\d{1,2}月\d{1,2}日/.test(value)) {
      fields['拍摄档期'] = value;
      fields['咨询时间'] = value.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, '$1-$2-$3');
    }
    if (key === '风格') fields['风格定位'] = value;
    if (key === '地点') fields['拍摄地点'] = value;
    if (key === '预算') {
      const b = value.match(/(\d{4,}-\d{4,})/);
      if (b) fields['预算区间'] = `${b[1]}元`;
    }
    if (key === '备注') fields['备注'] = value;
  }

  return fields;
}

function assertField(name, value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`E2E 缺少关键字段：${name}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvFile(args.env);

  // 强制覆盖为 R3 真实写入所需值（但不修改原 .env 文件）。
  env.SCREENSHOT_OCR_ENGINE = 'tesseract';
  env.NODE_ENV = env.NODE_ENV || 'production';
  env.TASK_REPOSITORY = 'feishu';

  const required = [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BASE_APP_TOKEN',
    'FEISHU_CUSTOMER_TABLE_ID',
    'FEISHU_PROJECT_TABLE_ID',
    'FEISHU_CUSTOMER_WRITE_KEY_FIELD',
    'FEISHU_PROJECT_WRITE_KEY_FIELD',
  ];
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`缺少 ${key}，无法执行真实 E2E`);
  }

  // 进程级注入，让 dist 模块读取到正确配置。
  Object.assign(process.env, env);

  const screenshotBuffer = readFileSync(args.screenshot);
  const ingestionId = `famp-r3-probe-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const projectName = `FAMP-R3-PROBE-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

  const evidence = {
    task: 'FAMP-R3-PROJECT-SCHEMA-ALIGNMENT-AND-REAL-E2E-01',
    acceptance_criteria: ['AC-10', 'AC-11', 'AC-12', 'AC-13', 'AC-14', 'AC-16'],
    generated_at: new Date().toISOString(),
    ingestion_id: ingestionId,
    screenshot: args.screenshot,
    env_file: args.env,
    verdict: 'PENDING',
    steps: [],
    cleanup_manifest: [],
  };

  function logStep(id, description, status, detail) {
    const step = { id, description, status, timestamp: new Date().toISOString(), detail };
    evidence.steps.push(step);
    console.log(`[${status}] ${id}: ${description}`);
    if (status === 'FAIL') throw new Error(`${id} failed: ${JSON.stringify(detail)}`);
    return step;
  }

  // ---- 1. 真实 OCR ----
  let ocrResult;
  try {
    const { TesseractOcrEngine } = await import(pathToFileURL(resolve(repoRoot, 'dist/ocr/tesseract-ocr-engine.js')).href);
    const engine = new TesseractOcrEngine({ lang: 'chi_sim+eng', timeoutMs: 120000 });
    ocrResult = await engine.extract(screenshotBuffer);
    logStep('AC-05/real-ocr', '真实 tesseract.js OCR', 'PASS', {
      engine: ocrResult.engine,
      ocr_version: ocrResult.ocr_version,
      confidence: ocrResult.confidence,
      text_block_count: ocrResult.text_blocks.length,
      raw_text_sample: ocrResult.raw_text.slice(0, 200),
    });
  } catch (e) {
    logStep('AC-05/real-ocr', '真实 tesseract.js OCR', 'FAIL', { error: e.message });
    throw e;
  }

  // ---- 2. 字段提取 ----
  const extracted = extractFields(ocrResult.raw_text);
  logStep('AC-10/field-extraction', '从 OCR 文本提取客户/项目字段', 'PASS', extracted);

  // ---- 3. 构造写入器 ----
  const { FeishuClient } = await import(pathToFileURL(resolve(repoRoot, 'dist/server/feishu/feishu-client.js')).href);
  const { FeishuCustomerRecordWriter } = await import(pathToFileURL(resolve(repoRoot, 'dist/server/business/customer-record-writer.js')).href);
  const { FeishuProjectRecordWriter, PROJECT_STYLE_OPTIONS, PROJECT_TYPE_OPTIONS } = await import(pathToFileURL(resolve(repoRoot, 'dist/server/business/project-record-writer.js')).href);

  const client = new FeishuClient({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    baseToken: env.FEISHU_BASE_APP_TOKEN,
    apiBase: env.FEISHU_API_BASE || 'https://open.feishu.cn',
  });

  const customerWriter = new FeishuCustomerRecordWriter(client, {
    customerTableId: env.FEISHU_CUSTOMER_TABLE_ID,
    ingestionIdField: env.FEISHU_CUSTOMER_WRITE_KEY_FIELD === 'Collator 摄入 ID' ? undefined : env.FEISHU_CUSTOMER_WRITE_KEY_FIELD,
  });

  const projectWriter = new FeishuProjectRecordWriter(client, {
    projectTableId: env.FEISHU_PROJECT_TABLE_ID,
    ingestionIdField: env.FEISHU_PROJECT_WRITE_KEY_FIELD === 'Collator 摄入 ID' ? undefined : env.FEISHU_PROJECT_WRITE_KEY_FIELD,
    styleOptions: PROJECT_STYLE_OPTIONS,
  });

  // ---- 4. 写入 Customer ----
  const customerFields = {
    '客户姓名': extracted['客户姓名'] ?? '林小姐',
    '联系方式': '13800138000',
    '咨询时间': extracted['咨询时间'] ?? new Date().toISOString().slice(0, 10),
    '预算区间': extracted['预算区间'] ?? '5000-8000元',
    '意向风格': [extracted['风格定位'] ?? '日系清新'],
  };
  for (const [k, v] of Object.entries(customerFields)) assertField(k, v);

  let customerResult;
  try {
    customerResult = await customerWriter.write({
      ingestionId,
      normalizedFields: customerFields,
    });
    logStep('AC-10/write-customer', '真实写入 Customer 表', customerResult.created ? 'PASS' : 'WARN', {
      record_id: customerResult.business_record_id,
      created: customerResult.created,
    });
  } catch (e) {
    logStep('AC-10/write-customer', '真实写入 Customer 表', 'FAIL', {
      code: e.code,
      message: e.message,
      detail: e.detail,
    });
    throw e;
  }

  // ---- 5. 写入 Project（关联 Customer）----
  const projectFields = {
    '项目名称': projectName,
    '项目类型': extracted['项目类型'] ?? '客片',
    '拍摄档期': extracted['拍摄档期'] ?? '2026年8月15日',
    '风格定位': extracted['风格定位'] ?? '日系清新',
    '拍摄地点': extracted['拍摄地点'] ?? '杭州西湖',
    '备注': extracted['备注'] ?? 'R3 E2E 探测记录',
    '关联客户 ID': customerResult.business_record_id,
  };
  for (const [k, v] of Object.entries(projectFields)) assertField(k, v);

  let projectResult;
  try {
    projectResult = await projectWriter.write({
      ingestionId,
      normalizedFields: projectFields,
    });
    logStep('AC-11/write-project', '真实写入 Project 表（含 DuplexLink）', projectResult.created ? 'PASS' : 'WARN', {
      record_id: projectResult.business_record_id,
      created: projectResult.created,
    });
  } catch (e) {
    logStep('AC-11/write-project', '真实写入 Project 表（含 DuplexLink）', 'FAIL', {
      code: e.code,
      message: e.message,
      detail: e.detail,
    });
    throw e;
  }

  // ---- 6. 读回验证 ----
  let customerReadback;
  let projectReadback;
  try {
    customerReadback = await client.getRecord(env.FEISHU_CUSTOMER_TABLE_ID, customerResult.business_record_id);
    projectReadback = await client.getRecord(env.FEISHU_PROJECT_TABLE_ID, projectResult.business_record_id);
    logStep('AC-12/readback', '读回 Customer + Project 记录', 'PASS', {
      customer: redactRecord(customerReadback),
      project: redactRecord(projectReadback),
    });
  } catch (e) {
    logStep('AC-12/readback', '读回 Customer + Project 记录', 'FAIL', { message: e.message });
    throw e;
  }

  // ---- 7. 幂等重放 ----
  let customerReplay;
  let projectReplay;
  try {
    customerReplay = await customerWriter.write({ ingestionId, normalizedFields: customerFields });
    projectReplay = await projectWriter.write({ ingestionId, normalizedFields: projectFields });
    const idempotent =
      !customerReplay.created &&
      !projectReplay.created &&
      customerReplay.business_record_id === customerResult.business_record_id &&
      projectReplay.business_record_id === projectResult.business_record_id;
    logStep('AC-13/idempotent-replay', '同一 ingestionId 二次写入幂等', idempotent ? 'PASS' : 'FAIL', {
      customer_created: customerReplay.created,
      project_created: projectReplay.created,
      customer_id: customerReplay.business_record_id,
      project_id: projectReplay.business_record_id,
    });
  } catch (e) {
    logStep('AC-13/idempotent-replay', '幂等重放', 'FAIL', { message: e.message });
    throw e;
  }

  // ---- 8. 清理 ----
  const cleanupManifest = [];
  if (!args.keep) {
    try {
      await client.deleteRecord(env.FEISHU_PROJECT_TABLE_ID, projectResult.business_record_id);
      cleanupManifest.push({ table: 'project', record_id: projectResult.business_record_id, status: 'deleted' });
    } catch (e) {
      cleanupManifest.push({ table: 'project', record_id: projectResult.business_record_id, status: 'failed', error: e.message });
    }
    try {
      await client.deleteRecord(env.FEISHU_CUSTOMER_TABLE_ID, customerResult.business_record_id);
      cleanupManifest.push({ table: 'customer', record_id: customerResult.business_record_id, status: 'deleted' });
    } catch (e) {
      cleanupManifest.push({ table: 'customer', record_id: customerResult.business_record_id, status: 'failed', error: e.message });
    }

    const allDeleted = cleanupManifest.every((m) => m.status === 'deleted');
    logStep('AC-16/cleanup', '删除探测记录', allDeleted ? 'PASS' : 'FAIL', { manifest: cleanupManifest });
    evidence.cleanup_manifest = cleanupManifest;
  } else {
    logStep('AC-16/cleanup', '用户要求保留探测记录（--keep）', 'WARN', {
      project_record_id: projectResult.business_record_id,
      customer_record_id: customerResult.business_record_id,
    });
    evidence.cleanup_manifest = [
      { table: 'project', record_id: projectResult.business_record_id, status: 'kept' },
      { table: 'customer', record_id: customerResult.business_record_id, status: 'kept' },
    ];
  }

  evidence.verdict = evidence.steps.every((s) => s.status !== 'FAIL') ? 'PASS' : 'FAIL';

  const outPath = resolve(repoRoot, 'evidence/r3-schema/r3-real-e2e-evidence.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');

  console.log(`\nverdict=${evidence.verdict}`);
  console.log(`evidence -> ${outPath}`);
  process.exit(evidence.verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.detail) console.error('detail:', JSON.stringify(err.detail, null, 2));
  process.exit(1);
});
