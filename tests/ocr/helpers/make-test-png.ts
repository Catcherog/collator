/**
 * Workstream B — 测试用 PNG 生成器（无第三方依赖）
 *
 * AC-B08：需要一个含已知字符的微型 PNG，验证 TesseractOcrEngine 跑的是真实 OCR
 * 而非预设文本。项目无 pngjs/jimp/sharp/canvas，故用 node:zlib + 手写 CRC32
 * 构造合法灰度 PNG：手绘一个粗体大写 "T"（仅横竖笔画，便于 tesseract eng 识别）。
 */

import { deflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 由灰度像素（0=黑,255=白）构造合法 8-bit 灰度 PNG。 */
function buildGrayscalePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type = grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowLen = width + 1; // 每行前置 1 字节 filter (0=None)
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < width; x++) {
      raw[y * rowLen + 1 + x] = pixels[y * width + x];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 生成一张含粗体大写 "T" 的灰度 PNG（黑字白底，留白充足）。
 * 供 TesseractOcrEngine 真实识别测试使用。
 */
export function makeLetterTPng(): Buffer {
  const width = 120;
  const height = 140;
  const px = new Uint8Array(width * height).fill(255);

  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          px[y * width + x] = 0;
        }
      }
    }
  };

  // 横梁：行 30-55，列 30-90
  fill(30, 30, 90, 55);
  // 竖梁：行 30-120，列 57-73
  fill(57, 30, 73, 120);

  return buildGrayscalePng(width, height, px);
}

/** 生成一张 1x1 白色 PNG（最小合法 PNG，用于 feishu/校验测试）。 */
export function makeMinimalPng(): Buffer {
  return buildGrayscalePng(1, 1, new Uint8Array([255]));
}

/**
 * 仅含签名 + IHDR 的 PNG（声称给定尺寸，无 IDAT）。
 * 用于尺寸超限测试：validateImageBuffer 只读魔数与 IHDR 维度，不解码 IDAT，
 * 故可在不分配巨量像素的前提下触发 OCR_IMAGE_TOO_LARGE。
 */
export function makePngHeaderWithDims(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr)]);
}

/** 构造一个非图片字节流（用于不支持类型测试）。 */
export function makeCorruptBytes(length = 32): Buffer {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) buf[i] = (i * 37 + 11) & 0xff;
  return buf;
}
