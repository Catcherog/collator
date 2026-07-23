/**
 * Workstream B — OCR 引擎工厂
 *
 * 根据配置选择真实 OCR 引擎（tesseract / feishu）或复用既有 MockOcrEngine。
 * 输出 ScreenshotOcrEngine 契约，供 Workstream E 在 app.ts 装配时替换
 * `new MockOcrEngine()`（见 INTEGRATION.md）。
 *
 * amendment 3：缺配置 / 未知引擎 → fail closed（抛 OcrConfigError）。
 */

import type { ScreenshotOcrEngine } from '../server/services/screenshot-ocr-adapter.js';
import { MockOcrEngine } from '../server/services/screenshot-ocr-adapter.js';
import {
  loadOcrConfig,
  type OcrConfig,
  type OcrEngineName,
  OcrConfigError,
} from '../server/config/ocr-config.js';
import { TesseractOcrEngine } from './tesseract-ocr-engine.js';
import { FeishuOcrEngine } from './feishu-ocr-engine.js';
import type { OcrLogger } from './ocr-logger.js';

const VALID_ENGINES: ReadonlySet<OcrEngineName> = new Set<OcrEngineName>([
  'mock',
  'tesseract',
  'feishu',
]);

export interface CreateOcrEngineOptions {
  logger?: OcrLogger;
}

/**
 * 根据引擎名 + 配置创建 OCR 引擎。
 *
 * @throws OcrConfigError 配置缺失（amendment 3 fail-closed）
 * @throws OcrConfigError 未知引擎名
 */
export function createOcrEngine(
  engine: OcrEngineName,
  config: OcrConfig,
  opts?: CreateOcrEngineOptions,
): ScreenshotOcrEngine {
  if (config == null) {
    throw new OcrConfigError(
      'OCR_CONFIG_MISSING',
      'createOcrEngine requires an OcrConfig (fail-closed, amendment 3).',
    );
  }
  if (!engine || !VALID_ENGINES.has(engine)) {
    throw new OcrConfigError(
      'OCR_CONFIG_INVALID',
      `Unknown OCR engine: ${String(engine)}. Must be one of "mock" | "tesseract" | "feishu".`,
    );
  }

  switch (engine) {
    case 'mock':
      // 复用既有 MockOcrEngine，不重复实现
      return new MockOcrEngine();
    case 'tesseract':
      return new TesseractOcrEngine({
        lang: config.tesseract.lang,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        maxFileSizeBytes: config.maxFileSizeBytes,
        maxDimension: config.maxDimension,
        logger: opts?.logger,
      });
    case 'feishu':
      return new FeishuOcrEngine({
        timeoutMs: config.feishu.timeoutMs,
        maxRetries: config.maxRetries,
        maxFileSizeBytes: config.maxFileSizeBytes,
        maxDimension: config.maxDimension,
        logger: opts?.logger,
      });
    default: {
      // 穷尽性兜底（理论上不可达）
      const _exhaustive: never = engine;
      throw new OcrConfigError('OCR_CONFIG_INVALID', `Unreachable engine: ${String(_exhaustive)}`);
    }
  }
}

/**
 * 从环境变量一站式装配：loadOcrConfig → createOcrEngine。
 * 供 Workstream E 在 app.ts 调用：`createOcrEngineFromEnv(process.env)`。
 *
 * @throws OcrConfigError SCREENSHOT_OCR_ENGINE 缺失/非法（amendment 3）
 */
export function createOcrEngineFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts?: CreateOcrEngineOptions,
): ScreenshotOcrEngine {
  const config = loadOcrConfig(env);
  return createOcrEngine(config.engine, config, opts);
}
