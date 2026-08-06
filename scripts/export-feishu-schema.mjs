#!/usr/bin/env node
/**
 * export-feishu-schema.mjs
 *
 * READ-ONLY 诊断脚本：导出飞书多维表格字段 schema。
 *
 * 用途：AC-07 —— 导出 Project / Customer / Model 表的
 * field_id / field_name / field_type / required（是否必填）。
 *
 * 安全约束：
 *  - 只调用 list fields（GET），不做任何写入。
 *  - 输出中 table_id / app_token 一律掩码。
 *  - 绝不输出 app_secret、tenant_access_token、Authorization header。
 *
 * 用法：
 *   node scripts/export-feishu-schema.mjs [--env <path>] [--out <path>]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { env: resolve(repoRoot, '.env'), out: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--env') args.env = resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = resolve(argv[++i]);
  }
  return args;
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`env file not found: ${path}`);
  }
  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** 掩码：只保留前 6 位，其余以长度提示替代。绝不输出完整 ID。 */
function mask(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length <= 6) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}***(len=${value.length})`;
}

/**
 * 飞书字段类型枚举 → 可读名 + 写入时期望的 JS 值形状。
 * 参考 Bitable v1 field type 表。
 */
const FIELD_TYPE_MAP = {
  1: { name: 'Text', expects: 'string' },
  2: { name: 'Number', expects: 'number' },
  3: { name: 'SingleSelect', expects: 'string (must be an existing option)' },
  4: { name: 'MultiSelect', expects: 'string[] (existing options)' },
  5: { name: 'DateTime', expects: 'number (epoch ms)' },
  7: { name: 'Checkbox', expects: 'boolean' },
  11: { name: 'User', expects: '{id}[]' },
  13: { name: 'PhoneNumber', expects: 'string' },
  15: { name: 'Url', expects: '{link,text}' },
  17: { name: 'Attachment', expects: '{file_token}[]' },
  18: { name: 'SingleLink', expects: 'string[] (record_id[])' },
  19: { name: 'Lookup', expects: 'read-only' },
  20: { name: 'Formula', expects: 'read-only' },
  21: { name: 'DuplexLink', expects: 'string[] (record_id[])' },
  22: { name: 'Location', expects: 'string' },
  23: { name: 'GroupChat', expects: '{id}[]' },
  1001: { name: 'CreatedTime', expects: 'read-only' },
  1002: { name: 'ModifiedTime', expects: 'read-only' },
  1003: { name: 'CreatedUser', expects: 'read-only' },
  1004: { name: 'ModifiedUser', expects: 'read-only' },
  1005: { name: 'AutoNumber', expects: 'read-only' },
};

const READ_ONLY_TYPES = new Set([19, 20, 1001, 1002, 1003, 1004, 1005]);

async function getTenantAccessToken(apiBase, appId, appSecret, fetchFn) {
  const resp = await fetchFn(`${apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await resp.json();
  if (json.code !== 0 || !json.tenant_access_token) {
    // 不回显 msg 之外的任何内容，msg 由飞书返回且不含凭据。
    throw new Error(`tenant_access_token failed: code=${json.code} msg=${json.msg}`);
  }
  return json.tenant_access_token;
}

async function listFields(apiBase, appToken, tableId, token, fetchFn) {
  const fields = [];
  let pageToken;
  do {
    const qs = new URLSearchParams({ page_size: '100' });
    if (pageToken) qs.set('page_token', pageToken);
    const url = `${apiBase}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?${qs}`;
    const resp = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await resp.json();
    if (json.code !== 0) {
      const logId = json.log_id ?? resp.headers.get('x-tt-logid') ?? null;
      throw new Error(
        `list fields failed: code=${json.code} msg=${json.msg} log_id=${logId} table=${mask(tableId)}`,
      );
    }
    fields.push(...(json.data?.items ?? []));
    pageToken = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);
  return fields;
}

function describeField(field) {
  const typeInfo = FIELD_TYPE_MAP[field.type] ?? { name: `Unknown(${field.type})`, expects: 'unknown' };
  const property = field.property ?? {};
  const options = Array.isArray(property.options)
    ? property.options.map((option) => option.name)
    : undefined;
  return {
    field_id: field.field_id,
    field_name: field.field_name,
    field_type: typeInfo.name,
    field_type_code: field.type,
    ui_type: field.ui_type ?? null,
    // Bitable 的 "必填" 通过 property.required 暴露（部分版本无此字段）。
    required: property.required === true,
    read_only: READ_ONLY_TYPES.has(field.type),
    expects_value_shape: typeInfo.expects,
    ...(options ? { allowed_options: options } : {}),
    ...(property.formatter ? { formatter: property.formatter } : {}),
    ...(property.multiple !== undefined ? { multiple: property.multiple } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvFile(args.env);

  // NOTE: FEISHU_BASE_URL in .env is the human-facing Base link
  // (https://<tenant>.feishu.cn/base/<app_token>), NOT the OpenAPI host.
  // The OpenAPI host is configured separately and defaults to open.feishu.cn.
  const apiBase = (env.FEISHU_API_BASE || 'https://open.feishu.cn').replace(/\/+$/, '');
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  const appToken = env.FEISHU_BASE_APP_TOKEN;
  if (!appId || !appSecret || !appToken) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_APP_TOKEN are required');
  }

  const targets = [
    ['project', env.FEISHU_PROJECT_TABLE_ID],
    ['customer', env.FEISHU_CUSTOMER_TABLE_ID],
    ['model', env.FEISHU_MODEL_TABLE_ID],
  ].filter(([, id]) => Boolean(id));

  const token = await getTenantAccessToken(apiBase, appId, appSecret, globalThis.fetch);

  const output = {
    generated_at: new Date().toISOString(),
    api_base: apiBase,
    app_token: mask(appToken),
    tables: {},
  };

  for (const [alias, tableId] of targets) {
    const fields = await listFields(apiBase, appToken, tableId, token, globalThis.fetch);
    output.tables[alias] = {
      table_id: mask(tableId),
      field_count: fields.length,
      fields: fields.map(describeField),
    };
    process.stderr.write(`[schema] ${alias}: ${fields.length} fields\n`);
  }

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    writeFileSync(args.out, json, 'utf8');
    process.stderr.write(`[schema] written to ${args.out}\n`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error) => {
  process.stderr.write(`[schema] ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
