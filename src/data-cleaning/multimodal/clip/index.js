/**
 * CLIP 模块入口
 * 统一封装本地 Python CLIP 与 mock 降级
 */

const pythonBridge = require('./python-bridge');

const DEFAULT_OPTIONS = {
  engine: 'python', // 'python' | 'mock'
  threshold: 0.6
};

async function checkImageTextMatch(imagePath, title, copy, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.engine === 'mock') {
    return {
      matched: opts.mockMatched !== undefined ? opts.mockMatched : true,
      score: opts.mockScore !== undefined ? opts.mockScore : 0.85,
      bestText: title || copy || '',
      similarities: [],
      texts: [title, copy].filter(Boolean),
      engine: 'mock'
    };
  }

  return pythonBridge.checkImageTextMatch(imagePath, title, copy, opts);
}

module.exports = {
  checkImageTextMatch
};
