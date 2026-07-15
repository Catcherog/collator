/**
 * Tesseract OCR 本地适配器
 * 优先使用 tesseract.js npm 包；未安装时返回友好提示
 */

const fs = require('fs');
const path = require('path');

let tesseractLib = null;

try {
  tesseractLib = require('tesseract.js');
} catch (err) {
  // tesseract.js 未安装
}

function checkTesseractAvailable() {
  if (!tesseractLib) {
    return {
      available: false,
      message: 'tesseract.js 未安装。请运行：npm install tesseract.js'
    };
  }
  return { available: true };
}

async function extractText(imagePath, options = {}) {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`图片文件不存在：${absPath}`);
  }

  const check = checkTesseractAvailable();
  if (!check.available) {
    throw new Error(check.message);
  }

  const lang = options.lang || 'chi_sim+eng';
  const result = await tesseractLib.recognize(absPath, lang, {
    logger: options.logger || (() => {})
  });

  const text = result.data.text || '';
  const confidence = result.data.confidence ? result.data.confidence / 100 : 0;
  const words = (result.data.words || []).map(w => ({
    text: w.text,
    confidence: w.confidence ? w.confidence / 100 : 0,
    bbox: w.bbox
  }));

  return {
    text: text.trim(),
    confidence,
    engine: 'tesseract',
    words
  };
}

module.exports = {
  extractText,
  checkTesseractAvailable
};
