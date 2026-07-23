/**
 * Workstream B — Tesseract OCR 引擎（真实实现）
 *
 * 实现 ScreenshotOcrEngine（Buffer 输入 → OcrResult 输出），底层调用
 * tesseract.js（本地 WASM，无需凭据 → amendment 4 默认 Provider）。
 *
 * 说明（架构决策）：现有 src/data-cleaning/multimodal/ocr/tesseract-adapter.js
 * 为 CJS 模块，但 import-ban 测试（tests/unit/cleaning/import-ban.test.ts）禁止
 * 从 src/ 直接 import/require data-cleaning，且 legacy-module-loader 拒绝裸 npm
 * 包（tesseract.js）。为同时满足 AC-B09（import-ban）与 B3（真实 OCR），
 * 本引擎以该 CJS 适配器为参考，在 ESM TypeScript 中等价重写：直接调用
 * tesseract.js 的 createWorker/recognize，算法与超时/语言参数对齐既有实现。
 *
 * tesseract.js recognize 直接接受 Buffer，因此无需落临时文件（比 CJS 适配器更简）。
 *
 * AC-B04：空/损坏/超大/不支持类型 → fail closed（抛 OcrError，不伪造文本）。
 * AC-B07：仅记录安全摘要（引擎名/置信度/块数/耗时/错误码），绝不记录原文或图片字节。
 */

import Tesseract from 'tesseract.js';
import type { ScreenshotOcrEngine, OcrResult, OcrOptions } from '../server/services/screenshot-ocr-adapter.js';
import { validateImageBuffer } from './image-validation.js';
import { OcrError, mapProviderError, isOcrProviderUnavailable } from './ocr-errors.js';
import { buildOcrResult } from './ocr-result-mapper.js';
import { getOcrLogger, safeResultSummary, type OcrLogger } from './ocr-logger.js';

/** Tesseract recognize 返回的最小子集（屏蔽 tesseract.js 完整 Page 类型，便于测试注入）。 */
export interface TesseractPageLike {
  text: string;
  /** 0-100 区间置信度。 */
  confidence: number;
  version?: string;
}

/** 可注入的识别函数（测试可替换为确定性 fake，无需网络）。 */
export type TesseractRecognizeFn = (
  image: Buffer,
  lang: string | string[],
  timeoutMs: number,
) => Promise<TesseractPageLike>;

export interface TesseractOcrEngineOptions {
  lang?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxFileSizeBytes?: number;
  maxDimension?: number;
  logger?: OcrLogger;
  /** 测试钩子：注入确定性识别函数。 */
  recognizeFn?: TesseractRecognizeFn;
}

/** 默认识别函数：调用真实 tesseract.js，含 createWorker 超时与 terminate 清理。 */
async function recognizeWithTesseract(
  image: Buffer,
  lang: string | string[],
  timeoutMs: number,
): Promise<TesseractPageLike> {
  // createWorker 下载 WASM core + 语言数据（首次需网络）
  const worker = await withTimeout(
    Tesseract.createWorker(lang),
    timeoutMs,
    'Tesseract createWorker',
  );
  try {
    const result = await withTimeout(worker.recognize(image), timeoutMs, 'Tesseract recognize');
    const data = result.data;
    return {
      text: data.text ?? '',
      confidence: data.confidence ?? 0,
      version: data.version,
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export class TesseractOcrEngine implements ScreenshotOcrEngine {
  readonly engine = 'tesseract';
  readonly ocr_version = 'tesseract-7.x';

  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxFileSizeBytes: number;
  private readonly maxDimension: number;
  private readonly logger: OcrLogger;
  private readonly recognizeFn: TesseractRecognizeFn;

  constructor(opts: TesseractOcrEngineOptions = {}) {
    this.lang = opts.lang ?? 'chi_sim+eng';
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxFileSizeBytes = opts.maxFileSizeBytes ?? 10 * 1024 * 1024;
    this.maxDimension = opts.maxDimension ?? 10000;
    this.logger = opts.logger ?? getOcrLogger();
    this.recognizeFn = opts.recognizeFn ?? recognizeWithTesseract;
  }

  async extract(buffer: Buffer, _options?: OcrOptions): Promise<OcrResult> {
    // AC-B04：先校验输入（非重试类，立即 fail closed）
    validateImageBuffer(buffer, {
      maxFileSizeBytes: this.maxFileSizeBytes,
      maxDimension: this.maxDimension,
    });

    const langArg: string | string[] = this.lang.includes('+')
      ? this.lang.split('+').filter(Boolean)
      : this.lang;
    const startedAt = Date.now();
    const duration = () => Date.now() - startedAt;

    let attempt = 0;
    while (true) {
      try {
        const page = await this.recognizeFn(buffer, langArg, this.timeoutMs);
        const result = buildOcrResult({
          engine: this.engine,
          ocrVersion: `tesseract-${page.version ?? '7.x'}`,
          rawText: page.text.trim(),
          confidence: page.confidence / 100,
        });
        this.logger.info('Tesseract OCR succeeded', {
          ...safeResultSummary(result),
          durationMs: duration(),
        });
        return result;
      } catch (err) {
        const mapped = err instanceof OcrError ? err : mapProviderError('Tesseract', err);

        // 非重试类错误：立即 fail closed
        if (!mapped.retryable) {
          this.logger.error('Tesseract OCR failed (non-retryable)', {
            code: mapped.code,
            durationMs: duration(),
          });
          throw mapped;
        }

        attempt++;
        if (attempt > this.maxRetries) {
          const exhausted = new OcrError(
            'OCR_RETRY_EXHAUSTED',
            `Tesseract OCR failed after ${this.maxRetries + 1} attempts: ${mapped.message}`,
            { cause: mapped },
          );
          this.logger.error('Tesseract OCR retries exhausted', {
            code: exhausted.code,
            durationMs: duration(),
          });
          throw exhausted;
        }

        this.logger.warn('Tesseract OCR retryable error, retrying', {
          attempt,
          code: mapped.code,
        });
        await sleep(200 * attempt);
      }
    }
  }
}

/** 供测试探测 Provider 是否可用（如 tesseract 无法初始化返回 true）。 */
export function isTesseractUnavailableError(err: unknown): boolean {
  return isOcrProviderUnavailable(err);
}

/** Promise 超时竞速。超时抛 OCR_TIMEOUT（可重试）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OcrError('OCR_TIMEOUT', `${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
