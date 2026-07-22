/**
 * 主线 A1: 截图 OCR 适配器
 *
 * 为 ScreenshotService 提供 OCR 接口。第一阶段仅实现 mock engine，返回预设的
 * 聊天截图文本和结构化文本块。真实飞书 OCR / Tesseract 留接口。
 *
 * 设计原则：
 * - 输入为 Buffer（来自 base64 解码），不耦合本地文件路径
 * - 输出包含 text_blocks（带类型/置信度/行号）+ raw_text + confidence
 * - mock engine 返回确定性结果（相同 buffer 内容 → 相同文本）
 * - 真实 OCR 失败时 fail closed（抛错，不静默返回空文本）
 */

/** 文本块类型 */
export type TextBlockType = 'text' | 'date' | 'phone' | 'email' | 'price' | 'name';

/** OCR 文本块 */
export interface OcrTextBlock {
  type: TextBlockType;
  text: string;
  line?: number;
  confidence?: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

/** OCR 结果 */
export interface OcrResult {
  engine: string;
  ocr_version: string;
  text_blocks: OcrTextBlock[];
  raw_text: string;
  confidence: number;
  processed_at: string;
}

/** OCR 引擎接口 */
export interface ScreenshotOcrEngine {
  extract(buffer: Buffer, options?: OcrOptions): Promise<OcrResult>;
}

export interface OcrOptions {
  /** 用于 mock 引擎的预设文本（测试用） */
  mockTextBlocks?: OcrTextBlock[];
  /** 用于 mock 引擎的预设置信度 */
  mockConfidence?: number;
}

/**
 * Mock OCR 引擎 — 返回预设的聊天截图文本块。
 *
 * 如果调用方提供 mockTextBlocks，则原样返回；否则根据 buffer 内容哈希生成
 * 确定性的预设文本（模拟客户咨询聊天的典型内容）。
 *
 * 真实场景中，这里会调用飞书 OCR 或 Tesseract API。
 */
export class MockOcrEngine implements ScreenshotOcrEngine {
  readonly engine = 'mock';
  readonly ocr_version = 'mock-1.0.0';

  async extract(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    // 确定性：buffer 内容用于未来真实 OCR 引擎；mock 引擎返回固定预设文本。
    void buffer;

    if (options?.mockTextBlocks && options.mockTextBlocks.length > 0) {
      return {
        engine: this.engine,
        ocr_version: this.ocr_version,
        text_blocks: options.mockTextBlocks,
        raw_text: options.mockTextBlocks.map((b) => b.text).join('\n'),
        confidence: options.mockConfidence ?? 0.95,
        processed_at: new Date().toISOString(),
      };
    }

    // 默认 mock：模拟客户咨询聊天的典型内容
    const text_blocks: OcrTextBlock[] = [
      { type: 'name', text: '李女士', line: 1, confidence: 0.92 },
      { type: 'text', text: '你好，我想咨询一下拍摄套餐', line: 2, confidence: 0.95 },
      { type: 'date', text: '2026年8月15日', line: 3, confidence: 0.88 },
      { type: 'price', text: '预算5000-8000元', line: 4, confidence: 0.90 },
      { type: 'phone', text: '138****8888', line: 5, confidence: 0.85 },
      { type: 'text', text: '风格：复古旗袍', line: 6, confidence: 0.93 },
    ];

    return {
      engine: this.engine,
      ocr_version: this.ocr_version,
      text_blocks,
      raw_text: text_blocks.map((b) => b.text).join('\n'),
      confidence: options?.mockConfidence ?? 0.91,
      processed_at: new Date().toISOString(),
    };
  }
}

/**
 * 从字段名推断文本块类型（用于将 OCR 文本映射到结构化字段）。
 */
export function inferTextBlockType(text: string): TextBlockType {
  // 手机号模式
  if (/1[3-9]\d{9}/.test(text) || /\d{3}\s?\*+\s?\d{4}/.test(text)) {
    return 'phone';
  }
  // 邮箱
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return 'email';
  }
  // 日期
  if (/\d{4}年\d{1,2}月\d{1,2}日/.test(text) || /\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
    return 'date';
  }
  // 价格
  if (/预算|元|￥|\$\d+/.test(text)) {
    return 'price';
  }
  // 姓名（称呼）
  if (/先生|女士|小姐|老师/.test(text) && text.length <= 10) {
    return 'name';
  }
  return 'text';
}
