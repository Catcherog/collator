import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

export interface HealthRouteOptions extends FastifyPluginOptions {
  /** 受控真实写入依赖 SOP；启用后 /readyz 会实际探测 SOP /healthz。 */
  requireSop?: boolean;
  sopHttpUrl?: string;
  sopTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** /buildinfo 返回体：证明"正在应答的是哪个 Collator 构建"。 */
export interface CollatorBuildInfo {
  service: 'collator';
  /** 构建时注入的 commit SHA；未注入时为 'unknown'（绝不伪造）。 */
  commit_sha: string;
  commit_sha_short: string;
  build_ref: string;
  build_time: string;
  node_env: string;
  /** 显式配置的 OCR 引擎；Portal 展示与 R3 可信 OCR 门禁均依赖它。 */
  screenshot_ocr_engine: string;
  started_at: string;
}

const UNKNOWN = 'unknown';
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000))
  .toISOString();

/**
 * 解析构建标识。
 *
 * FAMP-R3 AC-01/AC-02：R3 的核心争议是"线上跑的到底是不是修好的那份代码"。
 * 缺失时一律返回 'unknown' —— 宁可暴露不可验证，也不返回看起来可信的假值。
 */
export function resolveCollatorBuildInfo(
  env: NodeJS.ProcessEnv = process.env,
): CollatorBuildInfo {
  const sha =
    env.COLLATOR_BUILD_SHA?.trim()
    || env.GIT_COMMIT_SHA?.trim()
    || UNKNOWN;

  return {
    service: 'collator',
    commit_sha: sha,
    commit_sha_short: sha === UNKNOWN ? UNKNOWN : sha.slice(0, 7),
    build_ref: env.COLLATOR_BUILD_REF?.trim() || UNKNOWN,
    build_time: env.COLLATOR_BUILD_TIME?.trim() || UNKNOWN,
    node_env: env.NODE_ENV?.trim() || UNKNOWN,
    screenshot_ocr_engine: env.SCREENSHOT_OCR_ENGINE?.trim() || UNKNOWN,
    started_at: PROCESS_STARTED_AT,
  };
}

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions = {},
): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  // 只读构建标识。不含任何凭据，可安全跨域暴露给已允许的 Portal Origin。
  app.get('/buildinfo', async () => resolveCollatorBuildInfo());

  app.get('/readyz', async (_request, reply) => {
    if (!options.requireSop) {
      return {
        status: 'ready',
        dependencies: { sop: 'not_required' },
      };
    }

    const sopHttpUrl = (
      options.sopHttpUrl
      ?? process.env.SOP_HTTP_URL
      ?? 'http://127.0.0.1:3001'
    ).replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.sopTimeoutMs ?? 2000);

    try {
      const response = await (options.fetchImpl ?? fetch)(`${sopHttpUrl}/healthz`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return reply.status(503).send({
          status: 'not_ready',
          dependencies: { sop: 'unavailable' },
        });
      }
      const body = await response.json().catch(() => null) as { status?: string } | null;
      if (body?.status !== 'ok') {
        return reply.status(503).send({
          status: 'not_ready',
          dependencies: { sop: 'unavailable' },
        });
      }
      return {
        status: 'ready',
        dependencies: { sop: 'ready' },
      };
    } catch {
      return reply.status(503).send({
        status: 'not_ready',
        dependencies: { sop: 'unavailable' },
      });
    } finally {
      clearTimeout(timeout);
    }
  });
}
