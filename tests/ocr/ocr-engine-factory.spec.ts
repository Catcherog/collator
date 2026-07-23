/**
 * Workstream B — OCR 引擎工厂测试
 *
 * AC-B01: 工厂按配置选择正确引擎。
 * amendment 3: 缺配置 / 未知引擎 / 缺 SCREENSHOT_OCR_ENGINE → fail closed。
 */

import { describe, it, expect } from 'vitest';
import { createOcrEngine, createOcrEngineFromEnv } from '../../src/ocr/ocr-engine-factory.js';
import { loadOcrConfig, OcrConfigError } from '../../src/server/config/ocr-config.js';
import { MockOcrEngine } from '../../src/server/services/screenshot-ocr-adapter.js';
import { TesseractOcrEngine } from '../../src/ocr/tesseract-ocr-engine.js';
import { FeishuOcrEngine } from '../../src/ocr/feishu-ocr-engine.js';
import { silentOcrLogger } from '../../src/ocr/ocr-logger.js';

function validConfig() {
  return loadOcrConfig({ SCREENSHOT_OCR_ENGINE: 'mock' });
}

describe('createOcrEngine', () => {
  it('selects MockOcrEngine for "mock" (reuses existing, not duplicated)', () => {
    const engine = createOcrEngine('mock', validConfig(), { logger: silentOcrLogger });
    expect(engine).toBeInstanceOf(MockOcrEngine);
    expect((engine as MockOcrEngine).engine).toBe('mock');
  });

  it('selects TesseractOcrEngine for "tesseract"', () => {
    const engine = createOcrEngine('tesseract', validConfig(), { logger: silentOcrLogger });
    expect(engine).toBeInstanceOf(TesseractOcrEngine);
    expect((engine as TesseractOcrEngine).engine).toBe('tesseract');
  });

  it('selects FeishuOcrEngine for "feishu"', () => {
    const engine = createOcrEngine('feishu', validConfig(), { logger: silentOcrLogger });
    expect(engine).toBeInstanceOf(FeishuOcrEngine);
    expect((engine as FeishuOcrEngine).engine).toBe('feishu');
  });

  it('amendment 3: missing config → fail closed (OcrConfigError)', () => {
    expect(() => createOcrEngine('mock', undefined as unknown as ReturnType<typeof validConfig>)).toThrow(
      OcrConfigError,
    );
  });

  it('amendment 3: unknown engine name → fail closed (OcrConfigError)', () => {
    expect(() =>
      createOcrEngine('unknown' as never, validConfig(), { logger: silentOcrLogger }),
    ).toThrow(OcrConfigError);
  });
});

describe('createOcrEngineFromEnv', () => {
  it('wires env → config → engine (mock)', () => {
    const engine = createOcrEngineFromEnv(
      { SCREENSHOT_OCR_ENGINE: 'tesseract' },
      { logger: silentOcrLogger },
    );
    expect(engine).toBeInstanceOf(TesseractOcrEngine);
  });

  it('amendment 3: missing SCREENSHOT_OCR_ENGINE → fail closed, NO silent mock default', () => {
    expect(() => createOcrEngineFromEnv({})).toThrow(OcrConfigError);
    // 即便显式传 undefined / 空串也 fail closed
    expect(() => createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: undefined })).toThrow(OcrConfigError);
    expect(() => createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: '' })).toThrow(OcrConfigError);
  });

  it('amendment 3: invalid value → fail closed', () => {
    expect(() => createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: 'azure' })).toThrow(OcrConfigError);
  });

  it('tests must explicitly set mock (no silent fallback when set)', () => {
    const engine = createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: 'mock' });
    expect(engine).toBeInstanceOf(MockOcrEngine);
  });
});
