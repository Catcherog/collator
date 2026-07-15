/**
 * OCR 模块入口
 * 统一封装本地 Tesseract 与飞书 OCR API，供清洗引擎调用
 */

const tesseractAdapter = require('./tesseract-adapter');
const feishuAdapter = require('./feishu-ocr-adapter');

const DEFAULT_OPTIONS = {
  engine: 'tesseract', // 'tesseract' | 'feishu' | 'mock'
  confidenceThreshold: 0.7,
  fallback: true
};

/**
 * 从图片中提取文字
 * @param {string} imagePath 图片绝对或相对路径
 * @param {object} options 配置项
 * @returns {Promise<{text: string, confidence: number, engine: string, words: array}>}
 */
async function extractText(imagePath, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.engine === 'mock') {
    return {
      text: opts.mockText || '',
      confidence: opts.mockConfidence || 0.99,
      engine: 'mock',
      words: []
    };
  }

  if (opts.engine === 'feishu') {
    return feishuAdapter.extractText(imagePath, opts);
  }

  // 默认尝试 Tesseract
  try {
    const result = await tesseractAdapter.extractText(imagePath, opts);
    if (opts.fallback && result.confidence < opts.confidenceThreshold) {
      console.warn(`[OCR] Tesseract 置信度 ${result.confidence} 低于阈值，尝试飞书 OCR`);
      try {
        return await feishuAdapter.extractText(imagePath, opts);
      } catch (err) {
        console.warn(`[OCR] 飞书 OCR 降级失败：${err.message}`);
      }
    }
    return result;
  } catch (err) {
    if (opts.fallback) {
      console.warn(`[OCR] Tesseract 失败，尝试飞书 OCR：${err.message}`);
      return feishuAdapter.extractText(imagePath, opts);
    }
    throw err;
  }
}

function isImage(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = filePath.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'].includes(ext);
}

module.exports = {
  extractText,
  isImage,
  tesseractAdapter,
  feishuAdapter
};
