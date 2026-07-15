const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.wma', '.amr'];
const DOC_EXTENSIONS = ['.docx', '.doc', '.pdf', '.txt', '.xlsx', '.xls', '.csv'];

const CHAT_PATTERNS = [
  /\[\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?\]/,
  /\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/,
  /^(客户|我|对方|老师|老板|小姐姐|小哥哥)[\-\s:：]/m
];

function isImagePath(input) {
  if (typeof input !== 'string') return false;
  const lower = input.toLowerCase().trim();
  if (lower.startsWith('http') &amp;&amp; /\.(png|jpg|jpeg|gif|webp)/.test(lower)) return true;
  try {
    if (fs.existsSync(input)) {
      const ext = path.extname(input).toLowerCase();
      return IMAGE_EXTENSIONS.includes(ext);
    }
  } catch (e) {}
  return false;
}

function isAudioPath(input) {
  if (typeof input !== 'string') return false;
  try {
    if (fs.existsSync(input)) {
      const ext = path.extname(input).toLowerCase();
      return AUDIO_EXTENSIONS.includes(ext);
    }
  } catch (e) {}
  return false;
}

function isDocumentPath(input) {
  if (typeof input !== 'string') return false;
  const lower = input.toLowerCase().trim();
  if (lower.startsWith('http') &amp;&amp; /\.(docx|pdf|xlsx|txt)/.test(lower)) return true;
  try {
    if (fs.existsSync(input)) {
      const ext = path.extname(input).toLowerCase();
      return DOC_EXTENSIONS.includes(ext);
    }
  } catch (e) {}
  return false;
}

function isChatLog(input) {
  if (typeof input !== 'string') return false;
  const matchCount = CHAT_PATTERNS.filter(p =&gt; p.test(input)).length;
  return matchCount &gt;= 1;
}

function isBatchData(input) {
  if (Array.isArray(input)) return true;
  if (typeof input === 'object' &amp;&amp; input !== null) {
    return Array.isArray(input.records) || Array.isArray(input.data);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[') &amp;&amp; trimmed.endsWith(']')) {
      try { JSON.parse(trimmed); return true; } catch (e) {}
    }
  }
  return false;
}

function classifyInput(input) {
  if (input === null || input === undefined) {
    return { type: 'unknown', confidence: 0, metadata: {} };
  }

  if (typeof input === 'object' &amp;&amp; !Array.isArray(input)) {
    if (input.type) {
      return { type: input.type, confidence: 0.95, metadata: input.metadata || {} };
    }
    if (input.filePath || input.imagePath || input.audioPath) {
      const p = input.filePath || input.imagePath || input.audioPath;
      return classifyInput(p);
    }
    if (input.text || input.content) {
      return classifyInput(input.text || input.content);
    }
  }

  if (Array.isArray(input) || (typeof input === 'string' &amp;&amp; isBatchData(input))) {
    return { type: 'batch', confidence: 0.9, metadata: { itemCount: Array.isArray(input) ? input.length : 'unknown' } };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();

    if (isImagePath(trimmed)) {
      return { type: 'image', confidence: 0.95, metadata: { path: trimmed } };
    }

    if (isAudioPath(trimmed)) {
      return { type: 'audio', confidence: 0.95, metadata: { path: trimmed } };
    }

    if (isDocumentPath(trimmed)) {
      return { type: 'document', confidence: 0.9, metadata: { path: trimmed } };
    }

    if (isChatLog(trimmed)) {
      return { type: 'chat_log', confidence: 0.85, metadata: { length: trimmed.length } };
    }

    return { type: 'text', confidence: 0.99, metadata: { length: trimmed.length } };
  }

  return { type: 'unknown', confidence: 0, metadata: { inputType: typeof input } };
}

module.exports = {
  classifyInput,
  isImagePath,
  isAudioPath,
  isDocumentPath,
  isChatLog,
  isBatchData
};
