/**
 * Workstream B — 图片输入校验
 *
 * AC-B04：空 / 损坏 / 超大 / 不支持类型的图片 → fail closed（抛 OcrError，绝不伪造文本）。
 * 类型判定基于魔数（magic bytes），而非扩展名。
 * PNG 读取 IHDR 校验尺寸；JPEG/WEBP 仅校验类型与字节大小（尺寸解析留作后续增强）。
 */

import { OcrError } from './ocr-errors.js';

export type ImageType = 'png' | 'jpeg' | 'webp';

export interface ImageValidationOptions {
  maxFileSizeBytes: number;
  maxDimension: number;
}

export interface ValidatedImage {
  type: ImageType;
  width?: number;
  height?: number;
}

/** 检测图片类型（魔数）。无法识别返回 null。 */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

/** 从 PNG IHDR 读取宽高。返回 undefined 表示无法解析。 */
function readPngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  // IHDR 数据位于：8（签名）+ 4（长度）+ 4（"IHDR"）= 16 起；宽 @16，高 @20。
  if (buffer.length < 24) return undefined;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
    return undefined;
  }
  return { width, height };
}

/**
 * 校验图片 buffer。失败抛 OcrError（fail closed）。
 *
 * @throws OcrError OCR_INVALID_IMAGE（空/损坏）
 * @throws OcrError OCR_UNSUPPORTED_IMAGE_TYPE（非 PNG/JPEG/WEBP）
 * @throws OcrError OCR_IMAGE_TOO_LARGE（字节或尺寸超限）
 */
export function validateImageBuffer(buffer: Buffer, opts: ImageValidationOptions): ValidatedImage {
  if (!buffer || buffer.length === 0) {
    throw new OcrError('OCR_INVALID_IMAGE', 'Image buffer is empty');
  }

  if (buffer.length > opts.maxFileSizeBytes) {
    throw new OcrError(
      'OCR_IMAGE_TOO_LARGE',
      `Image size ${buffer.length} bytes exceeds limit ${opts.maxFileSizeBytes} bytes`,
    );
  }

  const type = detectImageType(buffer);
  if (!type) {
    throw new OcrError(
      'OCR_UNSUPPORTED_IMAGE_TYPE',
      'Unsupported image type: must be PNG, JPEG, or WEBP (magic bytes check failed)',
    );
  }

  if (type === 'png') {
    const dims = readPngDimensions(buffer);
    if (!dims) {
      throw new OcrError('OCR_INVALID_IMAGE', 'PNG IHDR could not be parsed (corrupt header)');
    }
    if (dims.width > opts.maxDimension || dims.height > opts.maxDimension) {
      throw new OcrError(
        'OCR_IMAGE_TOO_LARGE',
        `PNG dimensions ${dims.width}x${dims.height} exceed max dimension ${opts.maxDimension}px`,
      );
    }
    return { type, width: dims.width, height: dims.height };
  }

  // JPEG / WEBP：仅校验类型与字节大小；尺寸解析留作后续增强。
  return { type };
}
