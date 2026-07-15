/**
 * ASR 模块入口
 * 统一封装本地 Whisper 与飞书妙记 API
 */

const whisperAdapter = require('./local-whisper-adapter');
const feishuAdapter = require('./feishu-minutes-adapter');

const DEFAULT_OPTIONS = {
  engine: 'whisper', // 'whisper' | 'feishu' | 'mock'
  language: 'zh',
  fallback: true
};

async function transcribe(audioPath, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.engine === 'mock') {
    return {
      text: opts.mockText || '',
      confidence: opts.mockConfidence || 0.99,
      engine: 'mock',
      duration: opts.mockDuration || 0
    };
  }

  if (opts.engine === 'feishu') {
    return feishuAdapter.transcribe(audioPath, opts);
  }

  try {
    return await whisperAdapter.transcribe(audioPath, opts);
  } catch (err) {
    if (opts.fallback) {
      console.warn(`[ASR] Whisper 失败，尝试飞书妙记：${err.message}`);
      return feishuAdapter.transcribe(audioPath, opts);
    }
    throw err;
  }
}

module.exports = {
  transcribe,
  whisperAdapter,
  feishuAdapter
};
