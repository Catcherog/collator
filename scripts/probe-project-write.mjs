#!/usr/bin/env node
/**
 * probe-project-write.mjs
 *
 * 诊断脚本：复现 FeishuProjectRecordWriter 的两个飞书调用边界，
 * 分别捕获原始飞书错误码 / 错误消息 / log_id。
 *
 *   step 1 (READ-ONLY)  : records/search —— 幂等探测所用的过滤器
 *   step 2 (WRITE，可选) : records/create —— 实际写入载荷
 *
 * 默认只跑 step 1。加 --create 才会尝试写入，且写入成功后
 * **立即删除**（除非显式 --keep）。
 *
 * 安全约束：不输出 app_secret / tenant_access_token / Authorization。
 * table_id 与 app_token 一律掩码。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    env: resolve(repoRoot, '.env'),
    create: false,
    keep: false,
    withRelation: false,
    style: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') args.env = resolve(argv[++i]);
    else if (a === '--create') args.create = true;
    else if (a === '--keep') args.keep = true;
    else if (a === '--with-relation') args.withRelation = true;
    else if (a === '--style') args.style = argv[++i];
  }
  return args;
}

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

const mask = (v) => (typeof v === 'string' && v.length > 6 ? `${v.slice(0, 6)}***` : '***');

function stableClientToken(operationKey) {
  const bytes = Buffer.from(createHash('sha256').update(operationKey).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function call(apiBase, token, method, path, body) {
  const resp = await globalThis.fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    ...(body !== undefined && method !== 'GET' && method !== 'DELETE'
      ? { body: JSON.stringify(body) }
      : {}),
  });
  const headerLogId = resp.headers.get('x-tt-logid');
  let json;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, httpStatus: resp.status, code: -3, msg: 'non-JSON response', logId: headerLogId };
  }
  return {
    ok: json.code === 0,
    httpStatus: resp.status,
    code: json.code,
    msg: json.msg,
    logId: json.log_id ?? headerLogId ?? null,
    data: json.data,
    // 飞书对字段级错误会在 error.field_violations 里给出具体字段
    fieldViolations: json.error?.field_violations ?? null,
    troubleshooter: json.error?.troubleshooter ?? null,
  };
}

function report(label, r) {
  if (r.ok) {
    console.log(`  [OK]   ${label}`);
    return;
  }
  console.log(`  [FAIL] ${label}`);
  console.log(`         feishu_code    = ${r.code}`);
  console.log(`         feishu_message = ${r.msg}`);
  console.log(`         request_id     = ${r.logId}`);
  console.log(`         http_status    = ${r.httpStatus}`);
  if (r.fieldViolations) {
    console.log(`         field_violations = ${JSON.stringify(r.fieldViolations)}`);
  }
  if (r.troubleshooter) {
    console.log(`         troubleshooter = ${r.troubleshooter}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvFile(args.env);
  const apiBase = (env.FEISHU_API_BASE || 'https://open.feishu.cn').replace(/\/+$/, '');
  const appToken = env.FEISHU_BASE_APP_TOKEN;
  const projectTableId = env.FEISHU_PROJECT_TABLE_ID;
  const customerTableId = env.FEISHU_CUSTOMER_TABLE_ID;

  const tokenResp = await globalThis.fetch(`${apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const tokenJson = await tokenResp.json();
  if (tokenJson.code !== 0) throw new Error(`token failed code=${tokenJson.code} msg=${tokenJson.msg}`);
  const token = tokenJson.tenant_access_token;

  const base = `/open-apis/bitable/v1/apps/${appToken}/tables`;
  const projectName = `__PROBE__${Date.now()}`;

  console.log(`app_token=${mask(appToken)} project_table=${mask(projectTableId)}\n`);

  // ---- 找一条真实客户 record_id，用于 DuplexLink 测试 ----
  let customerRecordId = null;
  let customerDisplayName = null;
  if (customerTableId) {
    const r = await call(apiBase, token, 'POST', `${base}/${customerTableId}/records/search?page_size=1`, {
      page_size: 1,
      text_field_as_array: false,
    });
    if (r.ok && r.data?.items?.length) {
      customerRecordId = r.data.items[0].record_id;
      const f = r.data.items[0].fields;
      customerDisplayName = f['客户姓名'] ?? f['姓名'] ?? Object.values(f).find((v) => typeof v === 'string') ?? null;
    }
  }
  console.log(`sample customer record_id = ${customerRecordId ? mask(customerRecordId) : 'none'}`);
  console.log(`sample customer display   = ${customerDisplayName ?? 'none'}\n`);

  // ---- STEP 1a: 仅按 项目名称 搜索（当前 writer 的最小过滤器）----
  console.log('STEP 1a: search by 项目名称 only (READ-ONLY)');
  report(
    'records/search filter=[项目名称 is <name>]',
    await call(apiBase, token, 'POST', `${base}/${projectTableId}/records/search`, {
      filter: { conjunction: 'and', conditions: [{ field_name: '项目名称', operator: 'is', value: [projectName] }] },
      page_size: 2,
      text_field_as_array: false,
    }),
  );

  // ---- STEP 1b: 加上 关联客户 ID（DuplexLink）过滤，传 record_id ----
  if (customerRecordId) {
    console.log('\nSTEP 1b: search with DuplexLink filter using record_id (READ-ONLY)');
    report(
      'records/search filter=[项目名称, 关联客户 ID is <record_id>]',
      await call(apiBase, token, 'POST', `${base}/${projectTableId}/records/search`, {
        filter: {
          conjunction: 'and',
          conditions: [
            { field_name: '项目名称', operator: 'is', value: [projectName] },
            { field_name: '关联客户 ID', operator: 'is', value: [customerRecordId] },
          ],
        },
        page_size: 2,
        text_field_as_array: false,
      }),
    );
  }

  if (!args.create) {
    console.log('\n(skip write probes; pass --create to exercise records/create)');
    return;
  }

  // ---- STEP 2: create 探针 ----
  const cases = [
    {
      label: 'minimal: 项目名称 + 项目类型(客片)',
      fields: { 项目名称: `${projectName}_min`, 项目类型: '客片' },
    },
    {
      label: 'illegal MultiSelect option 风格定位=["温柔日系"]',
      fields: { 项目名称: `${projectName}_badopt`, 项目类型: '客片', 风格定位: ['温柔日系'] },
    },
    {
      label: 'legal MultiSelect option 风格定位=["日系清新"]',
      fields: { 项目名称: `${projectName}_okopt`, 项目类型: '客片', 风格定位: ['日系清新'] },
    },
    {
      label: 'DuplexLink with display NAME (wrong)',
      fields: { 项目名称: `${projectName}_relname`, 项目类型: '客片', '关联客户 ID': ['张三'] },
    },
  ];
  if (customerRecordId) {
    cases.push({
      label: 'DuplexLink with real record_id (correct)',
      fields: { 项目名称: `${projectName}_relid`, 项目类型: '客片', '关联客户 ID': [customerRecordId] },
    });
  }
  cases.push({
    label: 'DateTime 拍摄档期 as ISO string (wrong shape)',
    fields: { 项目名称: `${projectName}_dtstr`, 项目类型: '客片', 拍摄档期: '2026-08-10' },
  });
  cases.push({
    label: 'DateTime 拍摄档期 as epoch ms (correct)',
    fields: { 项目名称: `${projectName}_dtms`, 项目类型: '客片', 拍摄档期: Date.parse('2026-08-10') },
  });

  const created = [];
  console.log('\nSTEP 2: records/create probes');
  for (const c of cases) {
    const clientToken = stableClientToken(`probe:${c.label}:${projectName}`);
    const r = await call(
      apiBase,
      token,
      'POST',
      `${base}/${projectTableId}/records?client_token=${encodeURIComponent(clientToken)}`,
      { fields: c.fields },
    );
    report(c.label, r);
    if (r.ok && r.data?.record?.record_id) created.push(r.data.record.record_id);
  }

  // ---- cleanup ----
  if (!args.keep && created.length) {
    console.log(`\nCLEANUP: deleting ${created.length} probe record(s)`);
    for (const id of created) {
      const r = await call(apiBase, token, 'DELETE', `${base}/${projectTableId}/records/${id}`);
      console.log(`  ${r.ok ? 'deleted' : 'DELETE FAILED'} ${mask(id)}`);
    }
  } else if (created.length) {
    console.log(`\nKEEPING ${created.length} probe record(s) (--keep)`);
    created.forEach((id) => console.log(`  ${mask(id)}`));
  }
}

main().catch((e) => {
  console.error(`[probe] ERROR: ${e.message}`);
  process.exitCode = 1;
});
