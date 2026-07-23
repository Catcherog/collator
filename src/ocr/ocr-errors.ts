/**
 * Workstream B — 真实 OCR Adapter：错误模型
 *
 * 将不同 Provider（tesseract.js / lark-cli 飞书 OCR）的底层错误统一映射为内部
 * 错误码，供上层（ScreenshotService / 路由）做幂等、重试与 fail-closed 决策。
 *
 * 设计原则（AC-B04）：
 * - 无效图片（空 buffer / 损坏 / 超大 / 不支持的类型）→ 非重试，立即 fail closed。
 * - 超时 / Provider 不可用（网络、WASM/lang 数据下载失败、lark-cli 缺失）→ 可重试。
 * - Provider 返回业务错误 → 默认非重试。
 * - 严禁为失败伪造文本：所有错误均抛出，绝不静默返回 raw_text='' 的成功结果。
 */

/** OCR 内部错误码 */
export type OcrErrorCode =
  | 'OCR_INVALID_IMAGE'
  | 'OCR_IMAGE_TOO_LARGE'
  | 'OCR_UNSUPPORTED_IMAGE_TYPE'
  | 'OCR_TIMEOUT'
  | 'OCR_PROVIDER_UNAVAILABLE'
  | 'OCR_PROVIDER_ERROR'
  | 'OCR_RETRY_EXHAUSTED';

/** 默认可重试的错误码集合 */
const RETRYABLE_CODES: ReadonlySet<OcrErrorCode> = new Set<OcrErrorCode>([
  'OCR_TIMEOUT',
  'OCR_PROVIDER_UNAVAILABLE',
]);

/**
 * OCR 运行时错误。`retryable` 标记是否值得重试（仅超时/Provider 不可用）。
 */
export class OcrError extends Error {
  public readonly code: OcrErrorCode;
  public readonly retryable: boolean;
  public readonly cause?: unknown;

  constructor(
    code: OcrErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE_CODES.has(code);
    this.cause = options?.cause;
  }
}

/** 判断错误是否可重试。 */
export function isRetryableOcrError(err: unknown): boolean {
  return err instanceof OcrError && err.retryable;
}

/**
 * 判断错误是否表示 Provider 不可用（用于测试 AC-B08 的 external-blocked 跳过判定）：
 * Provider 不可用、重试耗尽（通常因底层为不可用类错误）、或 tesseract 初始化失败。
 */
export function isOcrProviderUnavailable(err: unknown): boolean {
  if (err instanceof OcrError) {
    return (
      err.code === 'OCR_PROVIDER_UNAVAILABLE' ||
      err.code === 'OCR_RETRY_EXHAUSTED' ||
      err.code === 'OCR_TIMEOUT'
    );
  }
  return false;
}

/**
 * 将未知 cause 映射为 OcrError。仅识别超时与 Provider 不可用两类可重试错误，
 * 其余一律归为 OCR_PROVIDER_ERROR（非重试），避免对未知失败盲目重试。
 */
export function mapProviderError(provider: string, cause: unknown): OcrError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  const lower = msg.toLowerCase();

  // 超时特征
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ETIMEDOUT')
  ) {
    return new OcrError('OCR_TIMEOUT', `${provider} OCR timeout: ${truncate(msg)}`, { cause });
  }

  // Provider 不可用特征：模块缺失、WASM/lang 数据下载失败、lark-cli 缺失、网络/DNS 中断
  const errno = cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;
  const NETWORK_ERRNOS = new Set([
    'ENOTFOUND',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EHOSTUNREACH',
  ]);
  if (
    lower.includes('cannot find module') ||
    lower.includes('tesseract.js 未安装') ||
    lower.includes('lark-cli 未安装') ||
    lower.includes('not in path') ||
    lower.includes('enoent') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('dns') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('download') ||
    (errno !== undefined && NETWORK_ERRNOS.has(errno))
  ) {
    return new OcrError(
      'OCR_PROVIDER_UNAVAILABLE',
      `${provider} OCR provider unavailable: ${truncate(msg)}`,
      { cause },
    );
  }

  return new OcrError('OCR_PROVIDER_ERROR', `${provider} OCR provider error: ${truncate(msg)}`, {
    cause,
  });
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
