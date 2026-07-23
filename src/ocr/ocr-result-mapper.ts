/**
 * Workstream B — OCR 结果映射
 *
 * 将不同 Provider 的原始文本/置信度统一映射为 OcrResult（与
 * screenshot-ocr-adapter.ts 定义的契约一致）。复用既有 inferTextBlockType
 * 对每行做类型推断，使真实 OCR 引擎可作为 MockOcrEngine 的可替换实现，
 * 下游 Candidate 构建逻辑（extractCustomerName/date/price 等）无需改动。
 */

import {
  inferTextBlockType,
  type OcrResult,
  type OcrTextBlock,
} from '../server/services/screenshot-ocr-adapter.js';

/** 把原始文本按行拆为带类型推断的文本块。 */
export function linesToTextBlocks(rawText: string, confidence: number): OcrTextBlock[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((line, i) => ({
    type: inferTextBlockType(line),
    text: line,
    line: i + 1,
    confidence,
  }));
}

export interface BuildOcrResultInput {
  engine: string;
  ocrVersion: string;
  rawText: string;
  /** 0-1 区间的置信度。 */
  confidence: number;
  /** 可选：直接提供预构建文本块（如 Provider 已返回结构化块）。 */
  textBlocks?: OcrTextBlock[];
}

/** 构建 OcrResult（processed_at 取当前时间）。 */
export function buildOcrResult(input: BuildOcrResultInput): OcrResult {
  const rawText = input.rawText;
  const textBlocks = input.textBlocks ?? linesToTextBlocks(rawText, input.confidence);
  return {
    engine: input.engine,
    ocr_version: input.ocrVersion,
    text_blocks: textBlocks,
    raw_text: rawText,
    confidence: clamp01(input.confidence),
    processed_at: new Date().toISOString(),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
