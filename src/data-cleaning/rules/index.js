const config = require('../config');
const utils = require('../utils');
const schemas = require('../schemas');

const SYSTEM_FIELD_TYPES = ['auto_number', 'relation', 'attachment', 'user', 'user(multi)'];

const STRING_MAX_LENGTH = 500;
const TEXT_MAX_LENGTH = 5000;

const BUDGET_RANGES = {
  '1000元以下': { min: 0, max: 1000 },
  '1000-2000元': { min: 1000, max: 2000 },
  '2000-3000元': { min: 2000, max: 3000 },
  '3000-5000元': { min: 3000, max: 5000 },
  '5000元以上': { min: 5000, max: Infinity }
};

function isEmpty(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function makeIssue(field, code, message, severity, suggestion) {
  return { field, code, message, severity, suggestion: suggestion || '' };
}

function validateStringType(fieldSchema, value) {
  const errors = [];
  const warnings = [];

  if (typeof value !== 'string') {
    errors.push(makeIssue(
      fieldSchema.fieldName,
      'TYPE_ERROR',
      `字段 ${fieldSchema.fieldName} 应为字符串类型`,
      'error',
      `请提供字符串格式的值`
    ));
    return { errors, warnings };
  }

  const maxLen = fieldSchema.type === 'text' ? TEXT_MAX_LENGTH : STRING_MAX_LENGTH;
  if (value.length > maxLen) {
    warnings.push(makeIssue(
      fieldSchema.fieldName,
      'LENGTH_WARNING',
      `字段 ${fieldSchema.fieldName} 长度为 ${value.length}，超过建议长度 ${maxLen}`,
      'warning',
      `建议缩短至 ${maxLen} 字符以内`
    ));
  }

  return { errors, warnings };
}

function validateNumberType(fieldSchema, value) {
  const errors = [];
  const warnings = [];

  const num = Number(value);
  if (isNaN(num)) {
    errors.push(makeIssue(
      fieldSchema.fieldName,
      'TYPE_ERROR',
      `字段 ${fieldSchema.fieldName} 应为数字类型`,
      'error',
      `请提供有效的数字`
    ));
    return { errors, warnings };
  }

  if (fieldSchema.type === 'number(rating)') {
    if (!Number.isInteger(num) || num < 1 || num > 5) {
      errors.push(makeIssue(
        fieldSchema.fieldName,
        'RANGE_ERROR',
        `字段 ${fieldSchema.fieldName} 评分必须是1-5之间的整数`,
        'error',
        `请输入1-5之间的整数评分`
      ));
    }
  }

  return { errors, warnings };
}

function validateDateType(fieldSchema, value) {
  const errors = [];
  const warnings = [];

  if (typeof value !== 'string') {
    errors.push(makeIssue(
      fieldSchema.fieldName,
      'TYPE_ERROR',
      `字段 ${fieldSchema.fieldName} 日期应为字符串类型`,
      'error',
      `请使用 YYYY-MM-DD 格式的日期字符串`
    ));
    return { errors, warnings };
  }

  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    errors.push(makeIssue(
      fieldSchema.fieldName,
      'FORMAT_ERROR',
      `字段 ${fieldSchema.fieldName} 日期格式不正确`,
      'error',
      `请使用 YYYY-MM-DD 格式，如 2025-06-26`
    ));
    return { errors, warnings };
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      errors.push(makeIssue(
        fieldSchema.fieldName,
        'INVALID_DATE',
        `字段 ${fieldSchema.fieldName} 日期不存在：${value}`,
        'error',
        `请检查年、月、日是否有效`
      ));
    }
  }

  return { errors, warnings };
}

function validateSingleSelect(fieldSchema, value) {
  const errors = [];
  const warnings = [];

  if (fieldSchema.enumValues && fieldSchema.enumValues.length > 0) {
    if (!fieldSchema.enumValues.includes(value)) {
      errors.push(makeIssue(
        fieldSchema.fieldName,
        'ENUM_MISMATCH',
        `字段 ${fieldSchema.fieldName} 的值 "${value}" 不在允许选项中`,
        'error',
        `允许的值：${fieldSchema.enumValues.join('、')}`
      ));
    }
  }

  return { errors, warnings };
}

function validateMultiSelect(fieldSchema, value) {
  const errors = [];
  const warnings = [];

  const values = Array.isArray(value) ? value : [value];
  const invalidValues = values.filter(v => v && fieldSchema.enumValues && !fieldSchema.enumValues.includes(v));

  if (invalidValues.length > 0) {
    errors.push(makeIssue(
      fieldSchema.fieldName,
      'ENUM_MISMATCH',
      `字段 ${fieldSchema.fieldName} 包含无效选项：${invalidValues.join('、')}`,
      'error',
      `允许的值：${fieldSchema.enumValues.join('、')}`
    ));
  }

  return { errors, warnings };
}

function validateField(fieldSchema, value) {
  let errors = [];
  let warnings = [];
  let sanitizedValue = value;

  if (isEmpty(value)) {
    if (fieldSchema.required) {
      errors.push(makeIssue(
        fieldSchema.fieldName,
        'REQUIRED_MISSING',
        `必填字段 ${fieldSchema.fieldName} 不能为空`,
        'error',
        `请补充该字段的值`
      ));
    }
    return { valid: errors.length === 0, errors, warnings, sanitizedValue };
  }

  try {
    const fieldType = fieldSchema.type;

    if (fieldType === 'text(phone)') {
      sanitizedValue = utils.sanitizePhone(value);
      if (!utils.isValidPhone(sanitizedValue)) {
        if (utils.isValidWechat(value)) {
          warnings.push(makeIssue(
            fieldSchema.fieldName,
            'FORMAT_WARNING',
            `字段 ${fieldSchema.fieldName} 看起来是微信号而非手机号，已保留原值`,
            'warning',
            `建议补充手机号以便电话联系`
          ));
          sanitizedValue = value;
        } else {
          const rule = config.getFieldFormatRule('phone');
          errors.push(makeIssue(
            fieldSchema.fieldName,
            'FORMAT_ERROR',
            rule ? rule.errorMessage : '联系方式格式不正确',
            'error',
            `请输入11位中国手机号或微信号`
          ));
        }
      }
      const strCheck = validateStringType(fieldSchema, sanitizedValue);
      errors = errors.concat(strCheck.errors);
      warnings = warnings.concat(strCheck.warnings);
    } else if (fieldType === 'text(date)' || fieldType === 'datetime' || fieldType === 'date') {
      if (typeof value === 'string') {
        const parsedDate = utils.parseDate(value);
        if (parsedDate) {
          sanitizedValue = parsedDate;
        }
        const dateCheck = validateDateType(fieldSchema, sanitizedValue);
        errors = errors.concat(dateCheck.errors);
        warnings = warnings.concat(dateCheck.warnings);
      } else {
        const dateCheck = validateDateType(fieldSchema, value);
        errors = errors.concat(dateCheck.errors);
        warnings = warnings.concat(dateCheck.warnings);
      }
    } else if (fieldType === 'text(budget)') {
      if (typeof value === 'string') {
        const budgetResult = utils.normalizeBudget(value);
        if (budgetResult && budgetResult.interval) {
          sanitizedValue = budgetResult.interval;
          if (budgetResult.confidence < 0.7) {
            warnings.push(makeIssue(
              fieldSchema.fieldName,
              'LOW_CONFIDENCE',
              `字段 ${fieldSchema.fieldName} 预算区间置信度较低（${budgetResult.confidence}）`,
              'warning',
              `建议确认预算区间是否正确`
            ));
          }
        }
      }
    } else if (fieldType === 'text(url)') {
      sanitizedValue = utils.sanitizeUrl(value);
      if (!utils.isValidUrl(sanitizedValue)) {
        const rule = config.getFieldFormatRule('url');
        errors.push(makeIssue(
          fieldSchema.fieldName,
          'FORMAT_ERROR',
          rule ? rule.errorMessage : 'URL格式不正确',
          'error',
          `URL应以 http:// 或 https:// 开头`
        ));
      }
      const strCheck = validateStringType(fieldSchema, sanitizedValue);
      errors = errors.concat(strCheck.errors);
      warnings = warnings.concat(strCheck.warnings);
    } else if (fieldType === 'number(rating)') {
      const numCheck = validateNumberType(fieldSchema, value);
      errors = errors.concat(numCheck.errors);
      warnings = warnings.concat(numCheck.warnings);
    } else if (fieldType === 'multi-select') {
      if (Array.isArray(value)) {
        sanitizedValue = value.map(v => typeof v === 'string' ? utils.sanitizeText(v) : v);
      }
      const multiCheck = validateMultiSelect(fieldSchema, sanitizedValue);
      errors = errors.concat(multiCheck.errors);
      warnings = warnings.concat(multiCheck.warnings);
    } else if (fieldType === 'select') {
      if (typeof value === 'string') {
        sanitizedValue = utils.sanitizeText(value);
      }
      const selectCheck = validateSingleSelect(fieldSchema, sanitizedValue);
      errors = errors.concat(selectCheck.errors);
      warnings = warnings.concat(selectCheck.warnings);
    } else if (fieldType === 'text') {
      if (typeof value === 'string') {
        sanitizedValue = utils.sanitizeText(value);
        const strCheck = validateStringType(fieldSchema, sanitizedValue);
        errors = errors.concat(strCheck.errors);
        warnings = warnings.concat(strCheck.warnings);
      } else {
        errors.push(makeIssue(
          fieldSchema.fieldName,
          'TYPE_ERROR',
          `字段 ${fieldSchema.fieldName} 应为字符串类型`,
          'error',
          `请提供字符串格式的值`
        ));
      }
    } else if (fieldType === 'number') {
      const numCheck = validateNumberType(fieldSchema, value);
      errors = errors.concat(numCheck.errors);
      warnings = warnings.concat(numCheck.warnings);
    } else if (SYSTEM_FIELD_TYPES.includes(fieldType)) {
      // skip validation for system fields
    } else {
      if (fieldSchema.enumValues && fieldSchema.enumValues.length > 0) {
        if (Array.isArray(value)) {
          const multiCheck = validateMultiSelect(fieldSchema, value);
          errors = errors.concat(multiCheck.errors);
          warnings = warnings.concat(multiCheck.warnings);
        } else {
          const selectCheck = validateSingleSelect(fieldSchema, value);
          errors = errors.concat(selectCheck.errors);
          warnings = warnings.concat(selectCheck.warnings);
        }
      }
    }
  } catch (err) {
    warnings.push(makeIssue(
      fieldSchema.fieldName,
      'VALIDATION_EXCEPTION',
      `字段 ${fieldSchema.fieldName} 校验时发生异常：${err.message}`,
      'warning',
      `请检查字段值是否正确`
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedValue
  };
}

function validateRequiredFields(schemaKey, data) {
  const allRequiredFields = schemas.getRequiredFields(schemaKey);
  const skipRequiredTypes = ['auto_number', 'relation', 'user', 'user(multi)'];
  const requiredFields = allRequiredFields.filter(f => !skipRequiredTypes.includes(f.type));
  const errors = [];
  const missingFields = [];

  for (const field of requiredFields) {
    if (isEmpty(data[field.fieldName])) {
      errors.push(makeIssue(
        field.fieldName,
        'REQUIRED_MISSING',
        `缺少必填字段：${field.fieldName}`,
        'error',
        `请补充必填字段 ${field.fieldName}`
      ));
      missingFields.push(field.fieldName);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingFields
  };
}

function parseDateForCompare(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  return null;
}

function parseBudgetRange(interval) {
  if (!interval) return null;
  return BUDGET_RANGES[interval] || null;
}

function parseDealAmount(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value.replace(/[^\d.]/g, ''));
    return isNaN(num) ? null : num;
  }
  return null;
}

function validateLogicConsistency(data, schemaKey) {
  const errors = [];
  const warnings = [];

  const STATE_INITIAL = {
    '项目状态': '待立项',
    '发布状态': '待制作',
    '合作状态': '待沟通'
  };

  for (const [stateField, initialState] of Object.entries(STATE_INITIAL)) {
    const stateValue = data[stateField];
    if (stateValue && stateValue !== initialState) {
      warnings.push(makeIssue(
        stateField,
        'STATE_NOT_INITIAL',
        `新建记录建议从初始状态"${initialState}"开始，当前为"${stateValue}"`,
        'warning',
        `如需导入历史数据可忽略，否则建议先设为"${initialState}"后通过状态流转更新`
      ));
    }
  }

  const shootDate = parseDateForCompare(data['拍摄日期']);
  const consultDate = parseDateForCompare(data['咨询时间']);
  const dealDate = parseDateForCompare(data['成交日期']);

  if (shootDate && consultDate && shootDate < consultDate) {
    errors.push(makeIssue(
      '拍摄日期',
      'DATE_CONFLICT',
      '拍摄日期不能早于咨询日期',
      'error',
      `拍摄日期 ${data['拍摄日期']} 早于咨询日期 ${data['咨询时间']}，请检查日期是否正确`
    ));
  }

  if (dealDate && consultDate && dealDate < consultDate) {
    errors.push(makeIssue(
      '成交日期',
      'DATE_CONFLICT',
      '成交日期不能早于咨询日期',
      'error',
      `成交日期 ${data['成交日期']} 早于咨询日期 ${data['咨询时间']}，请检查日期是否正确`
    ));
  }

  const projectStatus = data['项目状态'];
  const dealStatusValues = ['已成交', '已交付', '已归档'];
  const customerFields = ['客户姓名', '关联客户 ID', '联系方式', '客户 ID'];
  const hasCustomer = customerFields.some(f => !isEmpty(data[f]));

  if (projectStatus && dealStatusValues.includes(projectStatus) && !hasCustomer) {
    errors.push(makeIssue(
      '关联客户 ID',
      'MISSING_RELATION',
      `项目状态为"${projectStatus}"时必须关联客户`,
      'error',
      `请先关联客户信息后再标记为${projectStatus}`
    ));
  }

  const budgetInterval = data['预算区间'];
  const dealAmount = parseDealAmount(data['成交金额']);
  if (budgetInterval && dealAmount !== null) {
    const range = parseBudgetRange(budgetInterval);
    if (range) {
      const tolerance = range.max * 0.3;
      if (dealAmount < range.min - tolerance) {
        warnings.push(makeIssue(
          '成交金额',
          'BUDGET_MISMATCH',
          `成交金额 ${dealAmount}元 明显低于预算区间 ${budgetInterval}`,
          'warning',
          `请确认成交金额或预算区间是否正确`
        ));
      } else if (dealAmount > range.max + tolerance && range.max !== Infinity) {
        warnings.push(makeIssue(
          '成交金额',
          'BUDGET_MISMATCH',
          `成交金额 ${dealAmount}元 明显高于预算区间 ${budgetInterval}`,
          'warning',
          `请确认成交金额或预算区间是否正确`
        ));
      }
    }
  }

  if (data['拍摄类型'] === '亲子' && Array.isArray(data['意向风格'])) {
    if (data['意向风格'].includes('暗调情绪')) {
      warnings.push(makeIssue(
        '意向风格',
        'STYLE_WARNING',
        '亲子类型拍摄通常不建议选择"暗调情绪"风格',
        'warning',
        `亲子拍摄建议选择更明亮温馨的风格，如日系清新、韩系唯美`
      ));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function calculateScore(schemaKey, data, errors, warnings) {
  const schema = schemas.getSchema(schemaKey);
  if (!schema || !schema.fields) return 100;

  const fields = schema.fields.filter(f => !SYSTEM_FIELD_TYPES.includes(f.type));
  const totalFields = fields.length;
  const requiredFields = fields.filter(f => f.required);

  let score = 100;

  score -= errors.length * 15;
  score -= warnings.length * 5;

  const missingRequired = requiredFields.filter(f => isEmpty(data[f.fieldName])).length;
  score -= missingRequired * 10;

  const filledFields = fields.filter(f => !isEmpty(data[f.fieldName])).length;
  const completionRate = filledFields / totalFields;
  score = score * (0.7 + 0.3 * completionRate);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function validateRecord(schemaKey, data) {
  const errors = [];
  const warnings = [];
  const sanitizedData = { ...data };

  const schema = schemas.getSchema(schemaKey);
  if (!schema) {
    return {
      status: 'failed',
      errors: [makeIssue(
        '_schema',
        'SCHEMA_NOT_FOUND',
        `未找到schema: ${schemaKey}`,
        'error',
        `请检查schemaKey是否正确，可用值：customer, project`
      )],
      warnings: [],
      score: 0,
      sanitizedData: data
    };
  }

  const requiredResult = validateRequiredFields(schemaKey, data);
  errors.push(...requiredResult.errors);

  const fields = schema.fields.filter(f => !SYSTEM_FIELD_TYPES.includes(f.type));
  for (const field of fields) {
    const value = data[field.fieldName];
    if (isEmpty(value) && !field.required) continue;

    const fieldResult = validateField(field, value);
    errors.push(...fieldResult.errors);
    warnings.push(...fieldResult.warnings);
    if (fieldResult.sanitizedValue !== undefined) {
      sanitizedData[field.fieldName] = fieldResult.sanitizedValue;
    }
  }

  const logicResult = validateLogicConsistency(sanitizedData, schemaKey);
  errors.push(...logicResult.errors);
  warnings.push(...logicResult.warnings);

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  let status;
  if (hasErrors) {
    status = 'failed';
  } else if (hasWarnings) {
    status = 'warning';
  } else {
    status = 'passed';
  }

  const score = calculateScore(schemaKey, sanitizedData, errors, warnings);

  return {
    status,
    errors,
    warnings,
    score,
    sanitizedData
  };
}

function validateStateTransition(machineName, fromState, toState) {
  const stateMachine = config.getStateMachine(machineName);
  if (!stateMachine) {
    return { valid: false, error: `状态机 ${machineName} 不存在` };
  }

  if (!fromState) {
    return { valid: toState === stateMachine.initial, error: toState !== stateMachine.initial ? `初始状态必须是 ${stateMachine.initial}` : null };
  }

  const allowedTransitions = stateMachine.transitions[fromState] || [];
  if (!allowedTransitions.includes(toState)) {
    return {
      valid: false,
      error: `不允许从状态 "${fromState}" 转换到 "${toState}"，允许的下一状态：${allowedTransitions.join('、') || '无'}`
    };
  }

  return { valid: true };
}

module.exports = {
  validateField,
  validateRequiredFields,
  validateStateTransition,
  validateLogicConsistency,
  validateRecord,
  makeIssue,
  isEmpty
};
