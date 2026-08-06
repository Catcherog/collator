import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerCors,
  getAllowedOrigins,
  isAllowedOrigin,
  buildCorsOptions,
  CorsConfigError,
  DEFAULT_DEV_ORIGINS,
  PNA_REQUEST_HEADER,
} from '../../../src/server/cors.js';

/**
 * FAMP-R3 AC-02 / AC-03 回归防护。
 *
 * 背景：线上 Portal (Vercel HTTPS) 通过浏览器直连本机 Collator
 * (http://127.0.0.1:8787)，属于 Private Network Access 场景。
 * Chrome 要求 preflight 响应回带 Access-Control-Allow-Private-Network: true，
 * 否则请求被拦截，表现为 Portal 侧 "浏览器拒绝本地网络访问"。
 */

const PORTAL_ORIGIN = 'https://portal-seven-jade-47.vercel.app';
const HOSTILE_ORIGIN = 'https://attacker.example.com';

async function buildTestApp(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCors(app, env);
  app.get('/readyz', async () => ({ status: 'ready' }));
  app.post('/internal/write', async () => ({ ok: true }));
  await app.ready();
  return app;
}

/** 模拟 Chrome 对私有网络地址发出的 PNA preflight。 */
function pnaPreflight(app: FastifyInstance, origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/internal/write',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
      [PNA_REQUEST_HEADER]: 'true',
    },
  });
}

describe('CORS allowlist 解析', () => {
  it('未配置 CORS_ALLOWLIST 时回退到本地开发 Origin', () => {
    expect(getAllowedOrigins({})).toEqual([...DEFAULT_DEV_ORIGINS]);
  });

  it('按逗号分隔解析并去除空白', () => {
    expect(
      getAllowedOrigins({ CORS_ALLOWLIST: ` ${PORTAL_ORIGIN} , http://localhost:3000 ` }),
    ).toEqual([PORTAL_ORIGIN, 'http://localhost:3000']);
  });

  it('拒绝通配符 Origin（fail closed，不得降级为放行任意站点）', () => {
    expect(() => getAllowedOrigins({ CORS_ALLOWLIST: '*' })).toThrow(CorsConfigError);
    expect(() => getAllowedOrigins({ CORS_ALLOWLIST: 'https://*.vercel.app' })).toThrow(
      CorsConfigError,
    );
  });

  it('buildCorsOptions 在配置非法时于启动阶段即抛出', () => {
    expect(() => buildCorsOptions({ CORS_ALLOWLIST: '*' })).toThrow(CorsConfigError);
  });

  it('isAllowedOrigin 做精确匹配，不做前缀/后缀匹配', () => {
    const env = { CORS_ALLOWLIST: PORTAL_ORIGIN };
    expect(isAllowedOrigin(PORTAL_ORIGIN, env)).toBe(true);
    expect(isAllowedOrigin(`${PORTAL_ORIGIN}.evil.com`, env)).toBe(false);
    expect(isAllowedOrigin('https://portal-seven-jade-47.vercel.app:8443', env)).toBe(false);
    expect(isAllowedOrigin(HOSTILE_ORIGIN, env)).toBe(false);
  });
});

describe('Private Network Access preflight (AC-03)', () => {
  let app: FastifyInstance;
  const env = { CORS_ALLOWLIST: `${PORTAL_ORIGIN},http://localhost:3000` };

  beforeEach(async () => {
    app = await buildTestApp(env);
  });

  afterEach(async () => {
    await app.close();
  });

  it('对允许列表内 Origin 的 PNA preflight 回带 Access-Control-Allow-Private-Network', async () => {
    const res = await pnaPreflight(app, PORTAL_ORIGIN);

    // 回归锚点：@fastify/cors 在自身 onRequest hook 内终止 preflight，
    // PNA hook 若注册在其之后将永不执行，此断言即失败。
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    expect(res.statusCode).toBeLessThan(300);
  });

  it('PNA preflight 同时返回完整 CORS 三件套（AC-02）', async () => {
    const res = await pnaPreflight(app, PORTAL_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(PORTAL_ORIGIN);
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(res.headers['access-control-allow-methods'])).toContain('OPTIONS');
    expect(String(res.headers['access-control-allow-headers'])).toContain('Content-Type');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('不在允许列表内的 Origin 既拿不到 ACAO 也拿不到 PNA 头', async () => {
    const res = await pnaPreflight(app, HOSTILE_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });

  it('未声明 PNA 的普通 preflight 不回带 PNA 头（不过度授予）', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/internal/write',
      headers: {
        origin: PORTAL_ORIGIN,
        'access-control-request-method': 'POST',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBe(PORTAL_ORIGIN);
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });
});

describe('实际请求的 CORS 行为 (AC-02)', () => {
  let app: FastifyInstance;
  const env = { CORS_ALLOWLIST: PORTAL_ORIGIN };

  beforeEach(async () => {
    app = await buildTestApp(env);
  });

  afterEach(async () => {
    await app.close();
  });

  it('允许列表内 Origin 的 GET /readyz 回带 ACAO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/readyz',
      headers: { origin: PORTAL_ORIGIN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(PORTAL_ORIGIN);
  });

  it('非允许 Origin 的实际请求不回带 ACAO（浏览器侧被拦截）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/readyz',
      headers: { origin: HOSTILE_ORIGIN },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('无 Origin 头的非浏览器客户端（健康探针 / curl）不受影响', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });
});
