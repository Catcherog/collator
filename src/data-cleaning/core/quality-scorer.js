const config = require('../config');
const schemas = require('../schemas');

const SYSTEM_FIELD_TYPES = ['auto_number', 'relation', 'attachment', 'user', 'user(multi)'];

const DEFAULT_WEIGHTS = {
  requiredFieldsComplete: 40,
  formatValid: 25,
  enumValid: 20,
  logicConsistent: 10,
  confidenceWeighted: 5
};

const ERROR_POINTS = {
  REQUIRED_MISSING: null,
  TYPE_ERROR: 10,
  FORMAT_ERROR: 8,
  ENUM_MISMATCH: 5,
  RANGE_ERROR: 10,
  INVALID_DATE: 10,
  DATE_CONFLICT: 10,
  MISSING_RELATION: 8,
  BUDGET_MISMATCH: 5,
  STYLE_WARNING: 3,
  LOW_CONFIDENCE: 3,
  LENGTH_WARNING: 2,
  VALIDATION_EXCEPTION: 5
};

const WARNING_POINTS = {
  STYLE_WARNING: 2,
  LOW_CONFIDENCE: 3,
  LENGTH_WARNING: 2,
  BUDGET_MISMATCH: 2,
  VALIDATION_EXCEPTION: 3
};

const FIELD_SUGGESTIONS = {
  '手机号': '请输入11位中国手机号，如 13800138000',
  '联系方式': '请补充客户联系方式（手机号或微信号）',
  '客户姓名': '请填写客户姓名',
  '微信号': '请输入正确的微信号（6-20位，字母开头）或手机号',
  '拍摄日期': '请使用 YYYY-MM-DD 格式，如 2025-06-26',
  '咨询时间': '请使用 YYYY-MM-DD 格式填写咨询日期',
  '成交日期': '请使用 YYYY-MM-DD 格式填写成交日期',
  'URL': 'URL应以 http:// 或 https:// 开头',
  '预算区间': '请选择正确的预算区间',
  '成交金额': '请确认成交金额是否正确',
  '意向风格': '请选择合适的拍摄风格',
  '拍摄类型': '请选择正确的拍摄类型',
  '项目状态': '请选择正确的项目状态'
};

class QualityScorer {
  constructor(weights) {
    this.weights = { ...DEFAULT_WEIGHTS };
    if (weights) {
      if (weights.requiredFieldsComplete !== undefined) this.weights.requiredFieldsComplete = weights.requiredFieldsComplete;
      if (weights.formatValid !== undefined) this.weights.formatValid = weights.formatValid;
      if (weights.enumValid !== undefined) this.weights.enumValid = weights.enumValid;
      if (weights.logicConsistent !== undefined) this.weights.logicConsistent = weights.logicConsistent;
      if (weights.confidenceWeighted !== undefined) this.weights.confidenceWeighted = weights.confidenceWeighted;
    }
  }

  _getWeights() {
    const cleaningRules = config.getCleaningRules();
    if (cleaningRules && cleaningRules.scoringWeights && cleaningRules.scoringWeights.dataQuality) {
      const dq = cleaningRules.scoringWeights.dataQuality;
      return {
        requiredFieldsComplete: dq.requiredFieldsComplete ? dq.requiredFieldsComplete * 100 : this.weights.requiredFieldsComplete,
        formatValid: dq.formatValid ? dq.formatValid * 100 : this.weights.formatValid,
        enumValid: this.weights.enumValid,
        logicConsistent: this.weights.logicConsistent,
        confidenceWeighted: this.weights.confidenceWeighted
      };
    }
    return this.weights;
  }

  _getGrade(score) {
    if (score >= 90) return '优秀';
    if (score >= 70) return '良好';
    if (score >= 50) return '中等';
    return '较差';
  }

  _getSuggestion(field, code, message, existingSuggestion) {
    if (existingSuggestion) return existingSuggestion;
    if (FIELD_SUGGESTIONS[field]) {
      return FIELD_SUGGESTIONS[field];
    }
    if (code === 'FORMAT_ERROR' && field) {
      return `请检查${field}格式是否正确`;
    }
    if (code === 'ENUM_MISMATCH' && field) {
      return `请选择${field}的有效选项`;
    }
    if (code === 'REQUIRED_MISSING' && field) {
      return `请补充${field}`;
    }
    if (field && code) {
      return `请检查${field}：${message}`;
    }
    return message || '请检查相关字段';
  }

  _getDeductionPoints(code, severity) {
    if (severity === 'error') {
      return ERROR_POINTS[code] || 7;
    }
    if (severity === 'warning') {
      return WARNING_POINTS[code] || 2;
    }
    return 1;
  }

  score(schemaKey, cleanedData, validationResult) {
    const weights = this._getWeights();
    const deductions = [];

    const schema = schemas.getSchema(schemaKey);
    let requiredFields = [];
    if (schema && schema.fields) {
      requiredFields = schema.fields.filter(f => f.required && !SYSTEM_FIELD_TYPES.includes(f.type));
    }

    const errors = validationResult.errors || [];
    const warnings = validationResult.warnings || [];

    const seenRequiredFields = new Set();
    const requiredMissing = errors.filter(e => {
      if (e.code !== 'REQUIRED_MISSING') return false;
      if (seenRequiredFields.has(e.field)) return false;
      seenRequiredFields.add(e.field);
      return true;
    });
    const requiredMissingCount = requiredMissing.length;
    const requiredTotalCount = requiredFields.length;
    const requiredFillRate = requiredTotalCount > 0 ? (requiredTotalCount - requiredMissingCount) / requiredTotalCount : 1;
    const requiredScore = weights.requiredFieldsComplete * requiredFillRate;

    const pointsPerRequired = requiredTotalCount > 0 ? weights.requiredFieldsComplete / requiredTotalCount : 0;
    for (const err of requiredMissing) {
      const points = pointsPerRequired;
      deductions.push({
        field: err.field,
        reason: err.message || `必填字段 ${err.field} 缺失`,
        points: Math.round(points * 10) / 10,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }

    const formatErrors = errors.filter(e => e.code === 'FORMAT_ERROR' || e.code === 'TYPE_ERROR' || e.code === 'INVALID_DATE' || e.code === 'RANGE_ERROR');
    let formatDeduction = 0;
    for (const err of formatErrors) {
      const points = this._getDeductionPoints(err.code, 'error');
      formatDeduction += points;
      deductions.push({
        field: err.field,
        reason: err.message,
        points: points,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }
    const formatScore = Math.max(0, weights.formatValid - formatDeduction) * requiredFillRate;

    const enumErrors = errors.filter(e => e.code === 'ENUM_MISMATCH');
    let enumDeduction = 0;
    for (const err of enumErrors) {
      const points = this._getDeductionPoints(err.code, 'error');
      enumDeduction += points;
      deductions.push({
        field: err.field,
        reason: err.message,
        points: points,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }
    const enumScore = Math.max(0, weights.enumValid - enumDeduction) * requiredFillRate;

    const logicErrors = errors.filter(e => e.code === 'DATE_CONFLICT' || e.code === 'MISSING_RELATION');
    const logicBudgetErrors = errors.filter(e => e.code === 'BUDGET_MISMATCH');
    const logicWarnings = warnings.filter(w => w.code === 'BUDGET_MISMATCH' || w.code === 'STYLE_WARNING');
    let logicDeduction = 0;
    for (const err of logicErrors) {
      const points = this._getDeductionPoints(err.code, 'error');
      logicDeduction += points;
      deductions.push({
        field: err.field,
        reason: err.message,
        points: points,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }
    for (const err of logicBudgetErrors) {
      const points = this._getDeductionPoints(err.code, 'error');
      logicDeduction += points;
      deductions.push({
        field: err.field,
        reason: err.message,
        points: points,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }
    for (const warn of logicWarnings) {
      const points = this._getDeductionPoints(warn.code, 'warning');
      logicDeduction += points;
      deductions.push({
        field: warn.field,
        reason: warn.message,
        points: points,
        suggestion: this._getSuggestion(warn.field, warn.code, warn.message, warn.suggestion)
      });
    }
    const logicScore = Math.max(0, weights.logicConsistent - logicDeduction) * requiredFillRate;

    const lowConfidenceWarnings = warnings.filter(w => w.code === 'LOW_CONFIDENCE');
    let confidenceDeduction = 0;
    for (const warn of lowConfidenceWarnings) {
      const points = this._getDeductionPoints(warn.code, 'warning');
      confidenceDeduction += points;
      deductions.push({
        field: warn.field,
        reason: warn.message,
        points: points,
        suggestion: this._getSuggestion(warn.field, warn.code, warn.message, warn.suggestion)
      });
    }
    const confidenceScore = Math.max(0, weights.confidenceWeighted - confidenceDeduction) * requiredFillRate;

    const otherErrorCodes = ['REQUIRED_MISSING', 'FORMAT_ERROR', 'TYPE_ERROR', 'INVALID_DATE', 'RANGE_ERROR', 'ENUM_MISMATCH', 'DATE_CONFLICT', 'MISSING_RELATION', 'BUDGET_MISMATCH'];
    const otherErrors = errors.filter(e => !otherErrorCodes.includes(e.code));
    let otherDeduction = 0;
    for (const err of otherErrors) {
      const points = this._getDeductionPoints(err.code, 'error');
      otherDeduction += points;
      deductions.push({
        field: err.field,
        reason: err.message,
        points: points,
        suggestion: this._getSuggestion(err.field, err.code, err.message, err.suggestion)
      });
    }

    const otherWarningCodes = ['BUDGET_MISMATCH', 'STYLE_WARNING', 'LOW_CONFIDENCE', 'LENGTH_WARNING'];
    const otherWarnings = warnings.filter(w => !otherWarningCodes.includes(w.code));
    for (const warn of otherWarnings) {
      const points = this._getDeductionPoints(warn.code, 'warning');
      otherDeduction += points;
      deductions.push({
        field: warn.field,
        reason: warn.message,
        points: points,
        suggestion: this._getSuggestion(warn.field, warn.code, warn.message, warn.suggestion)
      });
    }

    const lengthWarnings = warnings.filter(w => w.code === 'LENGTH_WARNING');
    for (const warn of lengthWarnings) {
      const points = this._getDeductionPoints(warn.code, 'warning');
      otherDeduction += points;
      deductions.push({
        field: warn.field,
        reason: warn.message,
        points: points,
        suggestion: this._getSuggestion(warn.field, warn.code, warn.message, warn.suggestion)
      });
    }

    let score = requiredScore + formatScore + enumScore + logicScore + confidenceScore - otherDeduction;

    if (requiredFillRate === 0) {
      score = Math.max(0, Math.min(10, score));
    }

    score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
    const grade = this._getGrade(score);

    const suggestions = [...new Set(deductions.map(d => d.suggestion).filter(s => s))];

    let summary;
    const issueCount = deductions.length;
    if (score >= 90) {
      summary = `数据质量优秀，共${issueCount}个小问题可进一步完善`;
    } else if (score >= 70) {
      summary = `数据质量良好，存在${issueCount}个问题需要关注`;
    } else if (score >= 50) {
      summary = `数据质量中等，存在${issueCount}个问题需要修正`;
    } else {
      summary = `数据质量较差，存在${issueCount}个严重问题必须修正`;
    }

    return {
      score,
      grade,
      deductions,
      suggestions,
      summary
    };
  }
}

function createQualityScorer(weights) {
  return new QualityScorer(weights);
}

module.exports = {
  QualityScorer,
  createQualityScorer
};
