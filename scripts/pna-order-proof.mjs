/**
 * FAMP-R3 AC-03 证据脚本（只读，不改任何源码）。
 *
 * 目的：证明 "PNA hook 注册在 @fastify/cors 之后" 会导致 preflight 响应
 * 丢失 Access-Control-Allow-Private-Network 头 —— 即修复前的真实缺陷，
 * 而不是一个自证式的测试。
 *
 * 用法: node scripts/pna-order-proof.mjs
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://portal-seven-jade-47.vercel.app';

const corsOpts = {
  origin: [ORIGIN],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

const pnaHook = async (request, reply) => {
  if (
    request.headers['access-control-request-private-network'] === 'true' &&
    request.headers.origin === ORIGIN
  ) {
    reply.header('Access-Control-Allow-Private-Network', 'true');
  }
};

async function probe(label, order) {
  const app = Fastify({ logger: false });
  if (order === 'pna-first') {
    app.addHook('onRequest', pnaHook);
    await app.register(cors, corsOpts);
  } else {
    await app.register(cors, corsOpts);
    app.addHook('onRequest', pnaHook);
  }
  app.post('/internal/write', async () => ({ ok: true }));
  await app.ready();

  const res = await app.inject({
    method: 'OPTIONS',
    url: '/internal/write',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
      'access-control-request-private-network': 'true',
    },
  });
  await app.close();

  const pna = res.headers['access-control-allow-private-network'];
  return {
    label,
    hook_order: order,
    preflight_status: res.statusCode,
    'access-control-allow-origin': res.headers['access-control-allow-origin'] ?? null,
    'access-control-allow-methods': res.headers['access-control-allow-methods'] ?? null,
    'access-control-allow-headers': res.headers['access-control-allow-headers'] ?? null,
    'access-control-allow-private-network': pna ?? null,
    browser_outcome: pna === 'true'
      ? 'ALLOWED — Chrome 放行 public→private 请求'
      : 'BLOCKED — Chrome 拦截，Portal 表现为「浏览器拒绝本地网络访问」',
  };
}

const results = [
  await probe('修复前：app.register(cors) → app.addHook(PNA)', 'cors-first'),
  await probe('修复后：app.addHook(PNA) → app.register(cors)', 'pna-first'),
];

const before = results[0]['access-control-allow-private-network'];
const after = results[1]['access-control-allow-private-network'];

const report = {
  evidence_id: 'FAMP-R3-AC03-PNA-HOOK-ORDER',
  generated_at: new Date().toISOString(),
  fastify_cors_version: '11.3.0',
  root_cause:
    '@fastify/cors 在自身 onRequest hook 内以 reply.send() 终止 preflight 且不调用 next()，' +
    '导致其后注册的 onRequest hook 在 preflight 上永不执行。',
  probe_origin: ORIGIN,
  results,
  verdict:
    before === null && after === 'true'
      ? 'CONFIRMED — 缺陷真实存在且已由 hook 顺序调整修复'
      : 'INCONCLUSIVE — 请人工复核',
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../evidence/r3-schema/pna-hook-order-proof.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

console.log(JSON.stringify(report, null, 2));
console.log(`\n[written] ${outPath}`);
process.exit(report.verdict.startsWith('CONFIRMED') ? 0 : 1);
