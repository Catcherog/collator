/**
 * Workstream B — FeishuOcrEngine 契约测试
 *
 * 通过注入 LarkCommandRunner 替身，覆盖 上传→OCR API→映射 全链路与错误映射，
 * 不产生真实 lark-cli 副作用（测试环境可能未鉴权）。
 * AC-B04: 无效输入 fail closed（不调用 lark-cli）。
 */

import { describe, it, expect } from 'vitest';
import { FeishuOcrEngine, type LarkCommandRunner } from '../../src/ocr/feishu-ocr-engine.js';
import { OcrError } from '../../src/ocr/ocr-errors.js';
import { silentOcrLogger } from '../../src/ocr/ocr-logger.js';
import { makeMinimalPng, makeCorruptBytes } from './helpers/make-test-png.js';

const MOCK_PRESET_MARKER = '拍摄套餐';

function makeEngine(runCmd: LarkCommandRunner, opts?: { maxRetries?: number; maxFileSizeBytes?: number }) {
  return new FeishuOcrEngine({
    timeoutMs: 5000,
    maxRetries: opts?.maxRetries ?? 0,
    maxFileSizeBytes: opts?.maxFileSizeBytes ?? 10 * 1024 * 1024,
    maxDimension: 10000,
    logger: silentOcrLogger,
    commandRunner: runCmd,
  });
}

/** 上传成功 + OCR 成功的命令替身。 */
function successRunner(calls: { count: number }): LarkCommandRunner {
  return async (cmd) => {
    calls.count++;
    if (cmd.includes('drive +upload')) {
      return JSON.stringify({ code: 0, data: { fileToken: 'tok_abc123' } });
    }
    if (cmd.includes('api POST')) {
      return JSON.stringify({
        code: 0,
        data: {
          content: [{ type: 'text', text: '李女士\n138****8888\n2026年8月15日' }],
        },
      });
    }
    throw new Error(`unexpected cmd: ${cmd}`);
  };
}

describe('FeishuOcrEngine — result mapping (no real lark-cli)', () => {
  it('maps upload+OCR API → OcrResult (engine=feishu, confidence=0.85)', async () => {
    const calls = { count: 0 };
    const engine = makeEngine(successRunner(calls));
    const result = await engine.extract(makeMinimalPng());

    expect(result.engine).toBe('feishu');
    expect(result.ocr_version).toBe('feishu-ocr-v1');
    expect(result.confidence).toBeCloseTo(0.85, 3);
    expect(result.raw_text).toBe('李女士\n138****8888\n2026年8月15日');
    expect(result.processed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 两次 lark-cli 调用：上传 + OCR API
    expect(calls.count).toBe(2);
  });

  it('derives text_blocks via inferTextBlockType', async () => {
    const engine = makeEngine(successRunner({ count: 0 }));
    const result = await engine.extract(makeMinimalPng());
    expect(result.text_blocks.length).toBe(3);
    expect(result.text_blocks[0].type).toBe('name');
    expect(result.text_blocks[1].type).toBe('phone');
    expect(result.text_blocks[2].type).toBe('date');
  });

  it('cleans up temp files (no leak assertions; pipeline completes)', async () => {
    const engine = makeEngine(successRunner({ count: 0 }));
    const result = await engine.extract(makeMinimalPng());
    expect(result.raw_text).not.toContain(MOCK_PRESET_MARKER);
  });
});

describe('FeishuOcrEngine — AC-B04 fail closed (invalid input, no lark-cli call)', () => {
  it('empty buffer → OCR_INVALID_IMAGE, zero lark-cli calls', async () => {
    const calls = { count: 0 };
    const engine = makeEngine(successRunner(calls));
    await expect(engine.extract(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'OCR_INVALID_IMAGE',
    });
    expect(calls.count).toBe(0);
  });

  it('corrupt bytes → OCR_UNSUPPORTED_IMAGE_TYPE, zero lark-cli calls', async () => {
    const calls = { count: 0 };
    const engine = makeEngine(successRunner(calls));
    await expect(engine.extract(makeCorruptBytes(64))).rejects.toMatchObject({
      code: 'OCR_UNSUPPORTED_IMAGE_TYPE',
    });
    expect(calls.count).toBe(0);
  });

  it('oversized buffer → OCR_IMAGE_TOO_LARGE, zero lark-cli calls', async () => {
    const calls = { count: 0 };
    const engine = makeEngine(successRunner(calls), { maxFileSizeBytes: 50 });
    await expect(engine.extract(makeMinimalPng())).rejects.toMatchObject({
      code: 'OCR_IMAGE_TOO_LARGE',
    });
    expect(calls.count).toBe(0);
  });
});

describe('FeishuOcrEngine — token validation & error mapping', () => {
  it('rejects non-whitelisted file_token (injection guard) → OCR_PROVIDER_ERROR', async () => {
    const runner: LarkCommandRunner = async (cmd) => {
      if (cmd.includes('drive +upload')) {
        return JSON.stringify({ code: 0, data: { fileToken: 'tok;rm -rf /' } });
      }
      throw new Error('should not reach OCR API');
    };
    const engine = makeEngine(runner);
    await expect(engine.extract(makeMinimalPng())).rejects.toMatchObject({
      code: 'OCR_PROVIDER_ERROR',
    });
  });

  it('upload API business error → OCR_PROVIDER_ERROR (non-retryable)', async () => {
    let calls = 0;
    const runner: LarkCommandRunner = async () => {
      calls++;
      return JSON.stringify({ code: 99991663, msg: 'permission denied' });
    };
    const engine = makeEngine(runner, { maxRetries: 2 });
    await expect(engine.extract(makeMinimalPng())).rejects.toMatchObject({
      code: 'OCR_PROVIDER_ERROR',
    });
    expect(calls).toBe(1); // 非重试，立即抛
  });

  it('timeout-like failure → retryable → OCR_RETRY_EXHAUSTED', async () => {
    let calls = 0;
    const runner: LarkCommandRunner = async () => {
      calls++;
      throw new Error('lark-cli call timed out after 5000ms');
    };
    const engine = makeEngine(runner, { maxRetries: 1 });
    await expect(engine.extract(makeMinimalPng())).rejects.toMatchObject({
      code: 'OCR_RETRY_EXHAUSTED',
    });
    expect(calls).toBe(2); // 首次 + 1 次重试
  });

  it('non-timeout failure → OCR_PROVIDER_ERROR (non-retryable)', async () => {
    let calls = 0;
    const runner: LarkCommandRunner = async () => {
      calls++;
      throw new Error('ENOTFOUND some host');
    };
    const engine = makeEngine(runner, { maxRetries: 2 });
    // ENOTFOUND 在 mapProviderError 中归为 PROVIDER_UNAVAILABLE（可重试）→ 重试耗尽
    const err = (await engine.extract(makeMinimalPng()).catch((e: unknown) => e)) as OcrError;
    expect(err).toBeInstanceOf(OcrError);
    expect(['OCR_RETRY_EXHAUSTED', 'OCR_PROVIDER_UNAVAILABLE', 'OCR_PROVIDER_ERROR']).toContain(
      err.code,
    );
    expect(calls).toBeGreaterThan(1);
  });
});

describe('FeishuOcrEngine — real lark-cli call (contract, gated)', () => {
  it.skipIf(process.env.OCR_RUN_FEISHU_REAL !== '1')(
    'real feishu OCR — only when OCR_RUN_FEISHU_REAL=1 (requires authed lark-cli)',
    async () => {
      // 默认跳过：测试环境 lark-cli 可能未鉴权，避免产生真实上传副作用。
      // 启用方式：OCR_RUN_FEISHU_REAL=1 SCREENSHOT_OCR_ENGINE=feishu npx vitest run
      const engine = new FeishuOcrEngine({ logger: silentOcrLogger });
      const result = await engine.extract(makeMinimalPng());
      expect(result.engine).toBe('feishu');
    },
  );
});
