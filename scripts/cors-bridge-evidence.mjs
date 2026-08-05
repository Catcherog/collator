#!/usr/bin/env node
/**
 * FAMP-R3 AC-02 / AC-03 证据采集：Demo Bridge 跨域 + Private Network Access。
 *
 * 与单元测试的区别：本脚本让 Collator **真正 listen 在 TCP 端口上**，再用 undici
 * 走真实 socket 发请求，采集原始响应头。inject() 会绕过网络栈，无法作为
 * "线上 Portal 能否连上本机 Collator" 的证据。
 *
 * 覆盖场景：
 *   1. 允许 Origin + PNA preflight  → 必须回带 ACAO + ACAPN
 *   2. 允许 Origin + 普通 preflight → 必须回带 ACAO，不需要 ACAPN
 *   3. 非允许 Origin + PNA preflight → 必须不回带 ACAO / ACAPN
 *   4. 允许 Origin 实际 GET /healthz → 必须回带 ACAO
 *   5. 无 Origin（curl/探针）        → 正常 200，不涉及 CORS
 *
 * 只读：不写任何飞书数据，不改配置。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PORTAL_ORIGIN =
  process.env.EVIDENCE_PORTAL_ORIGIN ?? 'https://portal-seven-jade-47.vercel.app';
const EVIL_ORIGIN = 'https://evil.example.com';
const HOST = '127.0.0.1';

// 采集的响应头（小写）。
const CAPTURED = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-allow-private-network',
  'vary',
];

function pickHeaders(res) {
  const out = {};
  for (const name of CAPTURED) {
    out[name] = res.headers.get(name) ?? null;
  }
  return out;
}

async function main() {
  // 用与线上一致的允许列表启动。
  process.env.CORS_ALLOWLIST = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    PORTAL_ORIGIN,
  ].join(',');

  const { buildApp } = await import(
    pathToFileURL(resolve(repoRoot, 'dist/server/app.js')).href
  );

  const { app } = await buildApp({ logger: false });
  await app.listen({ host: HOST, port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://${HOST}:${port}`;

  const checks = [];

  // ---- 1. 允许 Origin + PNA preflight（浏览器真实行为）----
  {
    const res = await fetch(`${base}/healthz`, {
      method: 'OPTIONS',
      headers: {
        origin: PORTAL_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-private-network': 'true',
      },
    });
    const headers = pickHeaders(res);
    checks.push({
      id: 'AC-03/pna-preflight-allowed-origin',
      description: '线上 Portal Origin 发起 Private Network Access 预检',
      request: {
        method: 'OPTIONS',
        path: '/healthz',
        origin: PORTAL_ORIGIN,
        'access-control-request-private-network': 'true',
      },
      status: res.status,
      headers,
      expected: {
        'access-control-allow-origin': PORTAL_ORIGIN,
        'access-control-allow-private-network': 'true',
      },
      passed:
        headers['access-control-allow-origin'] === PORTAL_ORIGIN &&
        headers['access-control-allow-private-network'] === 'true',
    });
  }

  // ---- 2. 允许 Origin + 普通 preflight（无 PNA）----
  {
    const res = await fetch(`${base}/healthz`, {
      method: 'OPTIONS',
      headers: {
        origin: PORTAL_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      },
    });
    const headers = pickHeaders(res);
    checks.push({
      id: 'AC-02/plain-preflight-allowed-origin',
      description: '普通跨域预检：返回 Allow-Origin/Methods/Headers，且不误发 PNA 头',
      request: { method: 'OPTIONS', path: '/healthz', origin: PORTAL_ORIGIN },
      status: res.status,
      headers,
      expected: {
        'access-control-allow-origin': PORTAL_ORIGIN,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-allow-private-network': null,
      },
      passed:
        headers['access-control-allow-origin'] === PORTAL_ORIGIN &&
        (headers['access-control-allow-methods'] ?? '').includes('POST') &&
        (headers['access-control-allow-headers'] ?? '').includes('Content-Type') &&
        headers['access-control-allow-private-network'] === null,
    });
  }

  // ---- 3. 非允许 Origin + PNA preflight（必须拒绝）----
  {
    const res = await fetch(`${base}/healthz`, {
      method: 'OPTIONS',
      headers: {
        origin: EVIL_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-private-network': 'true',
      },
    });
    const headers = pickHeaders(res);
    checks.push({
      id: 'AC-02/pna-preflight-denied-origin',
      description: '允许列表外 Origin：既不回 Allow-Origin，也不回 PNA 头',
      request: { method: 'OPTIONS', path: '/healthz', origin: EVIL_ORIGIN },
      status: res.status,
      headers,
      expected: {
        'access-control-allow-origin': null,
        'access-control-allow-private-network': null,
      },
      passed:
        headers['access-control-allow-origin'] === null &&
        headers['access-control-allow-private-network'] === null,
    });
  }

  // ---- 4. 允许 Origin 实际 GET /healthz ----
  {
    const res = await fetch(`${base}/healthz`, {
      method: 'GET',
      headers: { origin: PORTAL_ORIGIN },
    });
    const body = await res.json().catch(() => null);
    const headers = pickHeaders(res);
    checks.push({
      id: 'AC-02/actual-get-healthz',
      description: '预检通过后的真实 GET /healthz 带 Allow-Origin',
      request: { method: 'GET', path: '/healthz', origin: PORTAL_ORIGIN },
      status: res.status,
      headers,
      body,
      expected: { status: 200, 'access-control-allow-origin': PORTAL_ORIGIN },
      passed: res.status === 200 && headers['access-control-allow-origin'] === PORTAL_ORIGIN,
    });
  }

  // ---- 5. 无 Origin（非浏览器客户端）----
  {
    const res = await fetch(`${base}/healthz`, { method: 'GET' });
    const body = await res.json().catch(() => null);
    checks.push({
      id: 'AC-02/no-origin-probe',
      description: '无 Origin 的健康探针不受 CORS 影响',
      request: { method: 'GET', path: '/healthz', origin: null },
      status: res.status,
      headers: pickHeaders(res),
      body,
      expected: { status: 200 },
      passed: res.status === 200,
    });
  }

  // ---- 6. /readyz 就绪状态（供 Portal 展示运行时信息）----
  {
    const res = await fetch(`${base}/readyz`, {
      method: 'GET',
      headers: { origin: PORTAL_ORIGIN },
    });
    const body = await res.json().catch(() => null);
    const headers = pickHeaders(res);
    checks.push({
      id: 'AC-02/readyz-runtime-info',
      description: '/readyz 跨域可读，供 Portal 展示 API 模式 / OCR 引擎',
      request: { method: 'GET', path: '/readyz', origin: PORTAL_ORIGIN },
      status: res.status,
      headers,
      body,
      expected: { 'access-control-allow-origin': PORTAL_ORIGIN },
      passed: headers['access-control-allow-origin'] === PORTAL_ORIGIN,
    });
  }

  // ---- 7. /buildinfo 构建标识（AC-01：证明应答方是哪个 Collator 构建）----
  {
    const res = await fetch(`${base}/buildinfo`, {
      method: 'GET',
      headers: { origin: PORTAL_ORIGIN },
    });
    const body = await res.json().catch(() => null);
    const headers = pickHeaders(res);
    const serialized = JSON.stringify(body ?? {});
    checks.push({
      id: 'AC-01/collator-buildinfo',
      description: '/buildinfo 跨域可读、字段完整、且不泄露凭据',
      request: { method: 'GET', path: '/buildinfo', origin: PORTAL_ORIGIN },
      status: res.status,
      headers,
      body,
      expected: {
        status: 200,
        'access-control-allow-origin': PORTAL_ORIGIN,
        shape: ['service', 'commit_sha', 'build_ref', 'screenshot_ocr_engine'],
      },
      passed:
        res.status === 200 &&
        headers['access-control-allow-origin'] === PORTAL_ORIGIN &&
        body?.service === 'collator' &&
        typeof body?.commit_sha === 'string' &&
        typeof body?.screenshot_ocr_engine === 'string' &&
        !/secret|password|app_secret/i.test(serialized),
    });
  }

  await app.close();

  const failed = checks.filter((c) => !c.passed);
  const report = {
    task: 'FAMP-R3-PROJECT-SCHEMA-ALIGNMENT-AND-REAL-E2E-01',
    acceptance_criteria: ['AC-01', 'AC-02', 'AC-03'],
    generated_at: new Date().toISOString(),
    method: 'real TCP socket (app.listen + fetch), NOT fastify inject',
    portal_origin: PORTAL_ORIGIN,
    cors_allowlist: process.env.CORS_ALLOWLIST.split(','),
    listen: { host: HOST, port },
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };

  const outPath = resolve(repoRoot, 'evidence/r3-schema/cors-bridge-evidence.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  for (const c of checks) {
    console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.id}  [${c.status}]`);
    if (!c.passed) {
      console.log(`      expected: ${JSON.stringify(c.expected)}`);
      console.log(`      actual  : ${JSON.stringify(c.headers)}`);
    }
  }
  console.log(`\nverdict=${report.verdict}  ${report.passed}/${report.total}`);
  console.log(`evidence -> ${outPath}`);

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('cors-bridge-evidence failed:', err);
  process.exit(1);
});
