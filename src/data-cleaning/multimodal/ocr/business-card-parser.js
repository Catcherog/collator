/**
 * 名片/合同/订单 OCR 文本解析器
 * 基于正则从 OCR 文本中提取结构化字段
 */

function parsePhone(text) {
  const matches = text.match(/1[3-9]\d{9}/g);
  return matches ? matches[0] : null;
}

function parseWechat(text) {
  const patterns = [
    /微信[：:]?\s*([a-zA-Z][a-zA-Z0-9_-]{5,19})/i,
    /微信号[：:]?\s*([a-zA-Z][a-zA-Z0-9_-]{5,19})/i,
    /微[信讯][：:]?\s*([a-zA-Z][a-zA-Z0-9_-]{5,19})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseName(text) {
  // 简单策略：取第一个 2-4 个中文的连续词组
  const m = text.match(/[\u4e00-\u9fa5]{2,4}/);
  return m ? m[0] : null;
}

function parseAmount(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*[万元]?/);
  return m ? parseFloat(m[1]) : null;
}

function parseDate(text) {
  const m = text.match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/);
  if (m) {
    const pad = n => String(n).padStart(2, '0');
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  }
  return null;
}

function parseBusinessCard(text) {
  return {
    资源名称: parseName(text),
    联系方式: parsePhone(text) || parseWechat(text),
    备注: `微信 ${parseWechat(text) || '未知'}`
  };
}

function parseContract(text) {
  return {
    成交金额: parseAmount(text),
    成交日期: parseDate(text)
  };
}

module.exports = {
  parseBusinessCard,
  parseContract,
  parsePhone,
  parseWechat,
  parseName,
  parseAmount,
  parseDate
};
