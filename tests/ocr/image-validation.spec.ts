/**
 * Workstream B — 图片校验单元测试
 *
 * AC-B04：magic bytes 类型识别 + 尺寸/大小校验 + fail closed。
 */

import { describe, it, expect } from 'vitest';
import { detectImageType, validateImageBuffer } from '../../src/ocr/image-validation.js';
import { OcrError } from '../../src/ocr/ocr-errors.js';
import {
  makeMinimalPng,
  makePngHeaderWithDims,
  makeCorruptBytes,
} from './helpers/make-test-png.js';

const OPTS = { maxFileSizeBytes: 10 * 1024 * 1024, maxDimension: 10000 };

describe('detectImageType (magic bytes)', () => {
  it('detects PNG', () => {
    expect(detectImageType(makeMinimalPng())).toBe('png');
  });
  it('detects JPEG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageType(jpeg)).toBe('jpeg');
  });
  it('detects WEBP', () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageType(webp)).toBe('webp');
  });
  it('returns null for non-image / too-short buffers', () => {
    expect(detectImageType(makeCorruptBytes(32))).toBeNull();
    expect(detectImageType(Buffer.alloc(4))).toBeNull();
  });
});

describe('validateImageBuffer (AC-B04 fail closed)', () => {
  it('accepts a valid PNG and returns parsed dimensions', () => {
    const v = validateImageBuffer(makeMinimalPng(), OPTS);
    expect(v.type).toBe('png');
    expect(v.width).toBe(1);
    expect(v.height).toBe(1);
  });

  it('rejects empty buffer → OCR_INVALID_IMAGE', () => {
    expect(() => validateImageBuffer(Buffer.alloc(0), OPTS)).toThrow(OcrError);
    expect(() => validateImageBuffer(Buffer.alloc(0), OPTS)).toThrow(
      expect.objectContaining({ code: 'OCR_INVALID_IMAGE' }),
    );
  });

  it('rejects unsupported type → OCR_UNSUPPORTED_IMAGE_TYPE', () => {
    expect(() => validateImageBuffer(makeCorruptBytes(64), OPTS)).toThrow(
      expect.objectContaining({ code: 'OCR_UNSUPPORTED_IMAGE_TYPE' }),
    );
  });

  it('rejects oversized buffer → OCR_IMAGE_TOO_LARGE', () => {
    expect(() =>
      validateImageBuffer(makeMinimalPng(), { ...OPTS, maxFileSizeBytes: 50 }),
    ).toThrow(expect.objectContaining({ code: 'OCR_IMAGE_TOO_LARGE' }));
  });

  it('rejects PNG with dimensions over maxDimension → OCR_IMAGE_TOO_LARGE', () => {
    expect(() =>
      validateImageBuffer(makePngHeaderWithDims(99999, 1), { ...OPTS, maxDimension: 1000 }),
    ).toThrow(expect.objectContaining({ code: 'OCR_IMAGE_TOO_LARGE' }));
  });
});
