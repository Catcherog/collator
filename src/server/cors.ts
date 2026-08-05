import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * CORS + Private Network Access (PNA) 接入层。
 *
 * FAMP-R3 AC-02 / AC-03:
 *   线上 Portal (https://…vercel.app) 通过浏览器直连本机 Collator
 *   (http://127.0.0.1:8787) 属于 "public → private" 请求，Chrome 会在正式请求前
 *   发送带 `Access-Control-Request-Private-Network: true` 的 preflight，
 *   并要求 preflight 响应回带 `Access-Control-Allow-Private-Network: true`。
 *
 * 关键顺序约束（本模块存在的根本原因）:
 *   @fastify/cors@11 在自己的 onRequest hook 内直接终止 preflight
 *   （index.js: `if (!options.preflightContinue) { … reply.send(); return }`，
 *   不调用 next()）。因此任何在 cors 之后注册的 onRequest hook 都不会在
 *   preflight 上执行 —— 而 preflight 恰恰是浏览器唯一需要 PNA 头的那次请求。
 *   所以 PNA hook 必须在 cors 之前注册。回归防护见
 *   tests/unit/server/cors-private-network.test.ts。
 */

/** 未配置 CORS_ALLOWLIST 时的开发默认值（仅本地 Portal dev server）。 */
export const DEFAULT_DEV_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

/** PNA preflight 请求头（浏览器发出）。 */
export const PNA_REQUEST_HEADER = 'access-control-request-private-network';
/** PNA 响应头（服务端必须在 preflight 响应回带）。 */
export const PNA_RESPONSE_HEADER = 'Access-Control-Allow-Private-Network';

export const CORS_METHODS = Object.freeze(['GET', 'POST', 'OPTIONS']);
export const CORS_ALLOWED_HEADERS = Object.freeze(['Content-Type', 'Authorization']);

/** CORS 配置非法时抛出（fail closed，禁止降级为放行任意 Origin）。 */
export class CorsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorsConfigError';
  }
}

/**
 * 解析精确 Origin 允许列表。
 * 禁止 `*` / 任何含通配符的条目 —— 受控真实写入端点不得对任意站点开放。
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CORS_ALLOWLIST?.trim();
  if (!raw) {
    return [...DEFAULT_DEV_ORIGINS];
  }
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  for (const origin of origins) {
    if (origin.includes('*')) {
      throw new CorsConfigError(
        'CORS_ALLOWLIST 不允许通配符 Origin，必须逐条列出精确 Origin。',
      );
    }
  }
  if (origins.length === 0) {
    return [...DEFAULT_DEV_ORIGINS];
  }
  return origins;
}

export function isAllowedOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getAllowedOrigins(env).includes(origin);
}

/**
 * 构造 @fastify/cors 选项。
 *
 * origin 使用函数形式而非静态数组，使允许列表在每次请求时求值：
 * 便于测试隔离，也避免进程内配置变更被 register 时刻的快照冻结。
 */
export function buildCorsOptions(env: NodeJS.ProcessEnv = process.env) {
  // 启动即校验：配置非法时直接抛出，不静默放行。
  getAllowedOrigins(env);

  return {
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow: boolean) => void,
    ) {
      // 无 Origin 头 = 同源请求或非浏览器客户端（curl / 健康探针），不涉及 CORS。
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, isAllowedOrigin(origin, env));
    },
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: true,
  };
}

/**
 * 注册 CORS 与 Private Network Access 支持。
 *
 * PNA hook 必须先于 @fastify/cors 注册，原因见文件头注释。
 * 仅对允许列表内的 Origin 回带 PNA 头，绝不无条件放行。
 */
export async function registerCors(
  app: FastifyInstance,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers[PNA_REQUEST_HEADER] !== 'true') return;
    const requestOrigin = request.headers.origin;
    if (requestOrigin && isAllowedOrigin(requestOrigin, env)) {
      reply.header(PNA_RESPONSE_HEADER, 'true');
    }
  });

  await app.register(cors, buildCorsOptions(env));
}
