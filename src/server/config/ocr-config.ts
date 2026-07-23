/**
 * Workstream B — OCR 专用配置
 *
 * 与 src/server/config.ts 解耦（不得修改 config.ts）。复用既有环境变量名
 * `SCREENSHOT_OCR_ENGINE`（与 config.ts 的 screenshotOcrEngine 字段对齐，
 * amendment：「不得拘泥于变量名；应遵循现有配置规范」），并补充 OCR 专属
 * 超时/重试/容量/Provider 参数。
 *
 * amendment 3（fail-closed）：
 * - `SCREENSHOT_OCR_ENGINE` 缺失或非法时 → 立即抛 OcrConfigError，绝不静默
 *   退化为 'mock'。测试必须显式设置 SCREENSHOT_OCR_ENGINE=mock。
 *
 * 注意：config.ts 仍保留 screenshotOcrEngine 的 .default('mock')，那是给
 * loadConfig() 的既有行为；本模块由 Workstream E 在装配真实引擎时单独调用，
 * 是 fail-closed 的真正执行点。
 */

/** OCR 引擎名（与 config.ts 的 screenshotOcrEngine 枚举一致）。 */
export type OcrEngineName = 'mock' | 'tesseract' | 'feishu';

const VALID_ENGINES: ReadonlySet<OcrEngineName> = new Set<OcrEngineName>([
  'mock',
  'tesseract',
  'feishu',
]);

/** OCR 配置错误（缺失/非法/不可用）。 */
export class OcrConfigError extends Error {
  public readonly code: 'OCR_CONFIG_MISSING' | 'OCR_CONFIG_INVALID';
  constructor(code: 'OCR_CONFIG_MISSING' | 'OCR_CONFIG_INVALID', message: string) {
    super(message);
    this.name = 'OcrConfigError';
    this.code = code;
  }
}

export interface OcrConfig {
  /** 选定的 OCR 引擎。 */
  engine: OcrEngineName;
  /** 单次 OCR 调用超时（ms）。默认 60000。 */
  timeoutMs: number;
  /** 可重试错误的最大重试次数（不含首次）。默认 2。 */
  maxRetries: number;
  /** 图片字节上限。默认 10MB（与 config.ts screenshotMaxFileSizeBytes 一致）。 */
  maxFileSizeBytes: number;
  /** 图片最大边长（px），超出 fail closed。默认 10000。 */
  maxDimension: number;
  /** Tesseract 专属配置。 */
  tesseract: {
    /** 识别语言。默认 'chi_sim+eng'（与现有 tesseract-adapter.js 一致）。 */
    lang: string;
  };
  /** 飞书 OCR 专属配置（lark-cli 自管鉴权，无需在此配置凭据）。 */
  feishu: {
    /** 单次 lark-cli 调用超时（ms）。默认 30000（与 feishu-ocr-adapter.js 一致）。 */
    timeoutMs: number;
  };
}

function parseInt32(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new OcrConfigError('OCR_CONFIG_INVALID', `${name} must be a positive integer, got: ${value}`);
  }
  return n;
}

function parseEngine(value: string | undefined): OcrEngineName {
  if (value === undefined || value === null || value === '') {
    // amendment 3：缺失 → fail closed（任何环境）。测试须显式设置 mock。
    throw new OcrConfigError(
      'OCR_CONFIG_MISSING',
      'SCREENSHOT_OCR_ENGINE is not set. Set SCREENSHOT_OCR_ENGINE to one of "mock" | "tesseract" | "feishu". ' +
        'Tests must set SCREENSHOT_OCR_ENGINE=mock explicitly; production must set tesseract|feishu. No silent fallback (amendment 3).',
    );
  }
  if (!VALID_ENGINES.has(value as OcrEngineName)) {
    throw new OcrConfigError(
      'OCR_CONFIG_INVALID',
      `Invalid SCREENSHOT_OCR_ENGINE="${value}". Must be one of "mock" | "tesseract" | "feishu". No silent fallback (amendment 3).`,
    );
  }
  return value as OcrEngineName;
}

/**
 * 从环境变量加载 OCR 配置。fail-closed（amendment 3）。
 * @param env 环境变量映射，默认 process.env
 */
export function loadOcrConfig(env: Record<string, string | undefined> = process.env): OcrConfig {
  const engine = parseEngine(env.SCREENSHOT_OCR_ENGINE);

  return {
    engine,
    timeoutMs: parseInt32(env.OCR_TIMEOUT_MS, 60000, 'OCR_TIMEOUT_MS'),
    maxRetries: parseInt32(env.OCR_MAX_RETRIES, 2, 'OCR_MAX_RETRIES'),
    maxFileSizeBytes: parseInt32(env.OCR_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024, 'OCR_MAX_FILE_SIZE_BYTES'),
    maxDimension: parseInt32(env.OCR_MAX_DIMENSION, 10000, 'OCR_MAX_DIMENSION'),
    tesseract: {
      lang: env.OCR_TESSERACT_LANG ?? 'chi_sim+eng',
    },
    feishu: {
      timeoutMs: parseInt32(env.OCR_FEISHU_TIMEOUT_MS, 30000, 'OCR_FEISHU_TIMEOUT_MS'),
    },
  };
}
