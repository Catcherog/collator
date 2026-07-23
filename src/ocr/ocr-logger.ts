/**
 * Workstream B — 真实 OCR Adapter：脱敏日志
 *
 * AC-B07：日志中绝不输出原始图片字节或完整 OCR 原文（可能含 PII）。
 * 引擎只记录安全摘要字段（引擎名、置信度、文本块数量、耗时、错误码）。
 * 即便误传敏感字段，pino redact 兜底替换为 [REDACTED]。
 */

import pino, { type Logger } from 'pino';

/** OCR 引擎使用的最小日志接口（便于测试注入 spy）。 */
export interface OcrLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** 兜底脱敏路径：覆盖图片字节、原始 OCR 文本、Provider 原始响应等。 */
const REDACT_PATHS = [
  'imageBuffer',
  'buffer',
  'raw_text',
  'rawText',
  'rawResponse',
  'raw_response',
  'text_blocks',
  'textBlocks',
  'words',
  'blocks',
  '*.imageBuffer',
  '*.raw_text',
  '*.rawResponse',
  '*.text_blocks',
  'image.base64',
  'image.data',
];

/** 进程级单例 OCR logger（避免每个引擎各建一个 pino 实例）。 */
let singleton: OcrLogger | undefined;

/**
 * 创建默认的脱敏 OCR logger（基于 pino，级别由 LOG_LEVEL / OCR_LOG_LEVEL 控制）。
 */
export function createOcrLogger(level?: string): OcrLogger {
  const pinoLogger: Logger = pino({
    name: 'ocr',
    level: level ?? process.env.OCR_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  });
  return wrapPino(pinoLogger);
}

function wrapPino(log: Logger): OcrLogger {
  return {
    debug: (msg, data) => log.debug(data ?? {}, msg),
    info: (msg, data) => log.info(data ?? {}, msg),
    warn: (msg, data) => log.warn(data ?? {}, msg),
    error: (msg, data) => log.error(data ?? {}, msg),
  };
}

/** 获取单例 OCR logger。 */
export function getOcrLogger(): OcrLogger {
  if (!singleton) {
    singleton = createOcrLogger();
  }
  return singleton;
}

/** 静默 logger（测试默认注入，避免 pino 噪音）。 */
export const silentOcrLogger: OcrLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * 构造 OCR 结果的安全摘要字段（仅这些字段进入日志）。
 * 严禁在此返回 raw_text 或图片字节。
 */
export function safeResultSummary(result: {
  engine: string;
  confidence: number;
  text_blocks: unknown[];
  processed_at: string;
}): Record<string, unknown> {
  return {
    engine: result.engine,
    confidence: result.confidence,
    text_blocks_count: result.text_blocks.length,
    processed_at: result.processed_at,
  };
}
