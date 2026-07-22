#!/usr/bin/env node
/**
 * FAMP Smoke Counter Verification
 *
 * FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX-R3 / RF-R3-01
 *
 * 用途：从文件参数接收 JSON { before, after, httpStatus }，做 fail-closed 无副作用验证。
 *       绕过 PowerShell 对 0 值 -eq 比较的 quirk。
 *
 * 用法：
 *   node scripts/famp-smoke-verify.mjs <json-file-path>
 *
 * 输出：
 *   - 控制台输出 GPT-required format + acceptance checks
 *   - 退出码 0 = 全部 PASS，1 = 有 FAIL
 */

import { readFileSync } from 'node:fs';

// 从文件参数读取 JSON，去除 BOM (U+FEFF)
const filePath = process.argv[2];
const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '').trim();
const payload = JSON.parse(raw);
const before = payload.before;
const after = payload.after;
const httpStatus = parseInt(payload.httpStatus, 10);

const checks = {
  'HTTP status == 500': httpStatus >= 500,
  'task_count after == before': after.task_save === before.task_save,
  'review_count after == before': after.review_create === before.review_create,
  'transport_call_count after == before': after.customer_writer_call === before.customer_writer_call,
  'feishu_writer_call_count after == before': after.customer_writer_call === before.customer_writer_call,
  'candidate_persisted after == before': after.candidate_persisted === before.candidate_persisted,
  'pre_write_call increased by 1 (attempt)': after.pre_write_call === before.pre_write_call + 1,
  'pre_write_error increased by 1 (fail)': after.pre_write_error === before.pre_write_error + 1,
};

console.log('');
console.log('=== GPT-Required Format ===');
console.log('Before failed request:');
console.log(`  task_count               = ${before.task_save}`);
console.log(`  review_count             = ${before.review_create}`);
console.log(`  transport_call_count     = ${before.customer_writer_call}`);
console.log(`  feishu_writer_call_count = ${before.customer_writer_call}`);
console.log(`  candidate_persisted      = ${before.candidate_persisted}`);
console.log('');
console.log('After failed request:');
console.log(`  task_count               = ${after.task_save}`);
console.log(`  review_count             = ${after.review_create}`);
console.log(`  transport_call_count     = ${after.customer_writer_call}`);
console.log(`  feishu_writer_call_count = ${after.customer_writer_call}`);
console.log(`  candidate_persisted      = ${after.candidate_persisted}`);
console.log('');
console.log(`HTTP status = ${httpStatus}`);
console.log('');
console.log('Supplementary evidence (PRE_WRITE attempt + failure → fail-closed):');
console.log(`  pre_write_call    before = ${before.pre_write_call}  after = ${after.pre_write_call}  (expected +1)`);
console.log(`  pre_write_error   before = ${before.pre_write_error}  after = ${after.pre_write_error}  (expected +1)`);
console.log(`  pre_write_success before = ${before.pre_write_success}  after = ${after.pre_write_success}  (expected unchanged)`);

console.log('');
console.log('=== Acceptance Checks ===');
let allPass = true;
for (const [name, pass] of Object.entries(checks)) {
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`${name}: ${status}`);
  if (!pass) allPass = false;
}

console.log('');
if (allPass) {
  console.log('[OK] All acceptance checks PASSED');
  process.exit(0);
} else {
  console.log('[FAIL] One or more acceptance checks FAILED');
  process.exit(1);
}
