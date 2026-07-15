/**
 * 基准测试指标计算工具
 * 提供准确率、召回率、F1、WER 等多模态验证常用指标
 */

function isEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  return String(a) === String(b);
}

function accuracy(correct, total) {
  return total === 0 ? 0 : Math.round((correct / total) * 10000) / 100;
}

function computeFieldAccuracy(expectedData, actualData) {
  if (!expectedData || typeof expectedData !== 'object') return { rate: 0, correct: 0, total: 0, details: [] };
  const keys = Object.keys(expectedData).filter(k => k !== undefined);
  if (keys.length === 0) return { rate: 0, correct: 0, total: 0, details: [] };

  let correct = 0;
  const details = [];
  const safeActual = actualData || {};
  for (const key of keys) {
    const matched = isEqual(expectedData[key], safeActual[key]);
    if (matched) correct++;
    details.push({
      field: key,
      expected: expectedData[key],
      actual: actualData[key],
      matched
    });
  }
  return { rate: accuracy(correct, keys.length), correct, total: keys.length, details };
}

function computeCorrectionsAccuracy(expectedCorrections, actualCorrections) {
  if (!expectedCorrections || expectedCorrections.length === 0) {
    return { rate: 100, correct: 0, total: 0, details: [] };
  }
  let correct = 0;
  const details = [];
  for (const expected of expectedCorrections) {
    const actual = actualCorrections.find(
      c => c.field === expected.field && isEqual(c.original, expected.original)
    );
    const matched = actual && isEqual(actual.corrected, expected.corrected);
    if (matched) correct++;
    details.push({ field: expected.field, expected, actual, matched });
  }
  return { rate: accuracy(correct, expectedCorrections.length), correct, total: expectedCorrections.length, details };
}

// 根据 rules/index.js 中 makeIssue 的 message 模式反查错误码
// 兼容 data-cleaner.js 通过 toMessage() 将 issue 对象转为字符串后的反向解析
function extractCodeFromMessage(message) {
  if (typeof message !== 'string' || message.length === 0) return null;
  // error 级
  // 必填缺失：兼容两种格式
  //   - validateRequiredFields: "缺少必填字段：xxx"
  //   - validateField 必填分支: "必填字段 xxx 不能为空"
  if (message.includes('必填字段')) return 'REQUIRED_MISSING';
  if (message.includes('评分必须是1-5')) return 'RANGE_ERROR';
  if (message.includes('不在允许选项中') || message.includes('包含无效选项')) return 'ENUM_MISMATCH';
  if (message.includes('日期不存在')) return 'INVALID_DATE';
  if (message.includes('应为字符串类型') || message.includes('应为数字类型') || message.includes('日期应为字符串类型')) return 'TYPE_ERROR';
  if ((message.includes('拍摄日期') || message.includes('成交日期')) && message.includes('不能早于')) return 'DATE_CONFLICT';
  if (message.includes('必须关联客户')) return 'MISSING_RELATION';
  if (message.startsWith('未找到schema')) return 'SCHEMA_NOT_FOUND';
  if (message.includes('格式不正确')) return 'FORMAT_ERROR';
  // warning 级
  if (message.includes('看起来是微信号而非手机号')) return 'FORMAT_WARNING';
  if (message.includes('超过建议长度')) return 'LENGTH_WARNING';
  if (message.includes('预算区间置信度较低')) return 'LOW_CONFIDENCE';
  if (message.includes('明显高于预算区间') || message.includes('明显低于预算区间')) return 'BUDGET_MISMATCH';
  if (message.includes('亲子类型拍摄')) return 'STYLE_WARNING';
  if (message.includes('新建记录建议从初始状态')) return 'STATE_NOT_INITIAL';
  if (message.includes('校验时发生异常')) return 'VALIDATION_EXCEPTION';
  return null;
}

// 从单个错误元素中提取错误码
// 兼容两种格式：issue 对象（含 code 字段）/ message 字符串（需反查）
function extractErrorCode(error) {
  if (!error) return null;
  if (typeof error === 'object') return error.code || null;
  if (typeof error === 'string') return extractCodeFromMessage(error);
  return null;
}

function computeStatusMatch(expectedStatus, actualSuccess, expectedErrorCodes, actualErrors) {
  const actualStatus = actualSuccess ? 'passed' : 'failed';
  const statusMatched = expectedStatus === actualStatus;

  // 失效点1 修复：原代码仅识别对象格式（typeof e === 'object'）
  // 但 data-cleaner.js 通过 toMessage() 已将 issue 转为字符串，导致 actualCodes 永远为空
  // 现兼容字符串（反查 message 模式）和对象（直接取 code）两种格式
  const safeErrors = Array.isArray(actualErrors) ? actualErrors : [];
  const actualCodes = safeErrors.map(extractErrorCode).filter(Boolean);

  // 计算 codesMatched：
  // - 边界：expectedErrorCodes 为空时视为通过（无期望错误码要求）
  // - 边界：actualErrors 为空但 expectedErrorCodes 非空时视为失败
  // - 否则采用 any-of 匹配：expectedErrorCodes 任一 code 出现在 actualCodes 中即通过
  let codesMatched = true;
  if (expectedErrorCodes && expectedErrorCodes.length > 0) {
    codesMatched = actualCodes.length > 0 &&
      expectedErrorCodes.some(code => actualCodes.includes(code));
  }

  return { statusMatched, codesMatched, actualStatus, actualCodes };
}

// 综合判定单条用例是否通过
// 失效点2 修复：将 codesMatched 纳入 casePassed 判断
// - 状态必须匹配
// - 质量分必须达标
// - 若声明了 expectedErrorCodes，错误码也必须匹配
function computeCasePassed(statusMatch, scoreOk, expectedErrorCodes) {
  if (!statusMatch.statusMatched || !scoreOk) return false;
  if (expectedErrorCodes && expectedErrorCodes.length > 0 && !statusMatch.codesMatched) {
    return false;
  }
  return true;
}

function computeSynonymRecall(cases) {
  const synonymCases = cases.filter(c => {
    const desc = c.description || '';
    return desc.includes('同义词') || desc.includes('同义') || desc.includes('映射');
  });
  if (synonymCases.length === 0) return { rate: 100, correct: 0, total: 0 };

  let correct = 0;
  for (const c of synonymCases) {
    if (c.result && c.result.casePassed) {
      correct++;
    }
  }
  return { rate: accuracy(correct, synonymCases.length), correct, total: synonymCases.length };
}

function computeRequiredInterception(cases) {
  const requiredCases = cases.filter(c =>
    c.expected.expectedErrorCodes && c.expected.expectedErrorCodes.includes('REQUIRED_MISSING')
  );
  if (requiredCases.length === 0) return { rate: 100, correct: 0, total: 0 };

  let correct = 0;
  for (const c of requiredCases) {
    if (c.result && !c.result.actualSuccess) correct++;
  }
  return { rate: accuracy(correct, requiredCases.length), correct, total: requiredCases.length };
}

function scoreWithinRange(actualScore, minScore) {
  return actualScore >= minScore - 5;
}

/**
 * 计算词错误率（Word Error Rate）
 * @param {string} reference 参考文本（真值）
 * @param {string} hypothesis 假设文本（ASR 结果）
 */
function computeWER(reference, hypothesis) {
  const refWords = String(reference).trim().split(/\s+/).filter(Boolean);
  const hypWords = String(hypothesis).trim().split(/\s+/).filter(Boolean);

  const n = refWords.length;
  if (n === 0) return hypWords.length === 0 ? 0 : 100;

  // 动态规划计算最小编辑距离
  const dp = Array.from({ length: n + 1 }, () => Array(hypWords.length + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= hypWords.length; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const edits = dp[n][hypWords.length];
  return Math.round((edits / n) * 10000) / 100;
}

/**
 * 计算字符准确率（Character Recognition Accuracy）
 * @param {string} reference 参考文本（真值）
 * @param {string} hypothesis 假设文本（OCR 结果）
 */
function computeCRA(reference, hypothesis) {
  const refChars = String(reference).split('');
  const hypChars = String(hypothesis).split('');
  const n = refChars.length;
  if (n === 0) return hypChars.length === 0 ? 100 : 0;

  const dp = Array.from({ length: n + 1 }, () => Array(hypChars.length + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= hypChars.length; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= hypChars.length; j++) {
      const cost = refChars[i - 1] === hypChars[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const correct = n - dp[n][hypChars.length];
  return Math.max(0, accuracy(correct, n));
}

module.exports = {
  isEqual,
  accuracy,
  computeFieldAccuracy,
  computeCorrectionsAccuracy,
  computeStatusMatch,
  computeCasePassed,
  computeSynonymRecall,
  computeRequiredInterception,
  scoreWithinRange,
  computeWER,
  computeCRA
};
