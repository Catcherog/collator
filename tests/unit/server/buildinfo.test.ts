import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes, resolveCollatorBuildInfo } from '../../../src/server/routes/health.js';

/**
 * FAMP-R3 AC-01 / AC-02：Collator 构建标识可验证性。
 *
 * R3 被打回的头号原因是"无法证明线上跑的是修好的那份代码"。
 * 因此本模块的核心契约是：**缺失时必须显式 unknown，绝不返回看似可信的假值**。
 */
describe('resolveCollatorBuildInfo', () => {
  it('未注入任何构建变量时全部返回 unknown，而不是伪造值', () => {
    const info = resolveCollatorBuildInfo({} as NodeJS.ProcessEnv);

    expect(info.service).toBe('collator');
    expect(info.commit_sha).toBe('unknown');
    expect(info.commit_sha_short).toBe('unknown');
    expect(info.build_ref).toBe('unknown');
    expect(info.build_time).toBe('unknown');
    expect(info.node_env).toBe('unknown');
    expect(info.screenshot_ocr_engine).toBe('unknown');
  });

  it('读取 COLLATOR_BUILD_SHA 并派生 7 位短 SHA', () => {
    const info = resolveCollatorBuildInfo({
      COLLATOR_BUILD_SHA: '3f9a1c2d4e5f60718293a4b5c6d7e8f901234567',
      COLLATOR_BUILD_REF: 'famp/real-ocr-write-result-r3',
      COLLATOR_BUILD_TIME: '2026-08-05T00:00:00.000Z',
      NODE_ENV: 'production',
      SCREENSHOT_OCR_ENGINE: 'tesseract',
    } as NodeJS.ProcessEnv);

    expect(info.commit_sha).toBe('3f9a1c2d4e5f60718293a4b5c6d7e8f901234567');
    expect(info.commit_sha_short).toBe('3f9a1c2');
    expect(info.build_ref).toBe('famp/real-ocr-write-result-r3');
    expect(info.build_time).toBe('2026-08-05T00:00:00.000Z');
    expect(info.node_env).toBe('production');
    expect(info.screenshot_ocr_engine).toBe('tesseract');
  });

  it('GIT_COMMIT_SHA 作为回退来源，但 COLLATOR_BUILD_SHA 优先', () => {
    expect(
      resolveCollatorBuildInfo({ GIT_COMMIT_SHA: 'abcdef1234567890' } as NodeJS.ProcessEnv)
        .commit_sha_short,
    ).toBe('abcdef1');

    expect(
      resolveCollatorBuildInfo({
        GIT_COMMIT_SHA: 'abcdef1234567890',
        COLLATOR_BUILD_SHA: '1111111222222233333334444444555555566666',
      } as NodeJS.ProcessEnv).commit_sha_short,
    ).toBe('1111111');
  });

  it('空白字符串视同未设置（避免 CI 注入空变量伪装成已知构建）', () => {
    const info = resolveCollatorBuildInfo({
      COLLATOR_BUILD_SHA: '   ',
      COLLATOR_BUILD_REF: '',
      SCREENSHOT_OCR_ENGINE: '\t',
    } as NodeJS.ProcessEnv);

    expect(info.commit_sha).toBe('unknown');
    expect(info.build_ref).toBe('unknown');
    expect(info.screenshot_ocr_engine).toBe('unknown');
  });

  it('started_at 是合法 ISO 时间戳且不在未来', () => {
    const info = resolveCollatorBuildInfo({} as NodeJS.ProcessEnv);
    const startedAt = new Date(info.started_at).getTime();

    expect(Number.isNaN(startedAt)).toBe(false);
    expect(startedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('不泄露任何凭据类环境变量', () => {
    const serialized = JSON.stringify(
      resolveCollatorBuildInfo({
        FEISHU_APP_SECRET: 'super-secret-value',
        COLLATOR_WEBHOOK_SECRET: 'webhook-secret-value',
        DIFY_WORKFLOW_API_KEY: 'dify-key-value',
        COLLATOR_BUILD_SHA: '3f9a1c2d4e5f6071',
      } as NodeJS.ProcessEnv),
    );

    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('webhook-secret-value');
    expect(serialized).not.toContain('dify-key-value');
    expect(serialized).toContain('3f9a1c2');
  });
});

describe('GET /buildinfo', () => {
  it('返回 200 与构建标识，且不改变 /healthz 既有契约', async () => {
    const app = Fastify({ logger: false });
    await app.register(healthRoutes, { requireSop: false });

    const buildinfo = await app.inject({ method: 'GET', url: '/buildinfo' });
    expect(buildinfo.statusCode).toBe(200);
    expect(buildinfo.json()).toMatchObject({ service: 'collator' });
    expect(buildinfo.json()).toHaveProperty('commit_sha');
    expect(buildinfo.json()).toHaveProperty('screenshot_ocr_engine');

    // 回归防护：/healthz 的响应体保持原样。
    const healthz = await app.inject({ method: 'GET', url: '/healthz' });
    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});
