function detectAmbiguities(parsedData, schema, options = {}) {
  const issues = [];
  const { fields, missing } = parsedData;
  const thresholds = options.thresholds || { autoExecute: 0.9, suggestConfirm: 0.7, mustConfirm: 0.5 };

  if (missing && missing.length > 0) {
    for (const fieldName of missing) {
      issues.push({
        type: 'missing_required',
        field: fieldName,
        message: `缺少必填字段: ${fieldName}`,
        severity: 'error',
        blocking: true
      });
    }
  }

  if (fields) {
    for (const [fieldName, fieldData] of Object.entries(fields)) {
      if (!fieldData) continue;

      const confidence = fieldData.confidence || 0;
      const value = fieldData.value;

      if (confidence > 0 && confidence < thresholds.suggestConfirm) {
        issues.push({
          type: 'low_confidence',
          field: fieldName,
          value,
          confidence,
          message: `字段"${fieldName}"置信度较低(${Math.round(confidence*100)}%)，建议确认`,
          severity: 'warning',
          blocking: confidence < thresholds.mustConfirm
        });
      }

      if (fieldData.fieldMeta && Array.isArray(fieldData.fieldMeta.enumValues) && fieldData.fieldMeta.enumValues.length > 0) {
        const enumValues = fieldData.fieldMeta.enumValues;
        const values = Array.isArray(value) ? value : [value];
        
        for (const v of values) {
          if (v && !enumValues.includes(v)) {
            let suggestion = null;
            let bestScore = 0;
            for (const ev of enumValues) {
              const score = stringSimilarity(String(v), ev);
              if (score > bestScore) {
                bestScore = score;
                suggestion = ev;
              }
            }

            issues.push({
              type: 'enum_mismatch',
              field: fieldName,
              value: v,
              message: `值"${v}"不在枚举选项中`,
              suggestion: bestScore > 0.5 ? suggestion : null,
              suggestionScore: bestScore,
              severity: 'warning',
              blocking: false,
              availableOptions: enumValues
            });
          }
        }
      }

      if (fieldData.fieldMeta && fieldData.fieldMeta.type && fieldData.fieldMeta.type.includes('phone')) {
        const phoneDigits = String(value).replace(/\D/g, '');
        if (phoneDigits.length !== 11) {
          issues.push({
            type: 'invalid_format',
            field: fieldName,
            value,
            message: `手机号格式不正确（应为11位数字）`,
            severity: 'error',
            blocking: true
          });
        }
      }
    }
  }

  if (fields && fields['联系方式'] && fields['联系方式'].value) {
    issues.push({
      type: 'duplicate_check_needed',
      field: '联系方式',
      value: fields['联系方式'].value,
      message: '需要检查手机号是否已存在',
      severity: 'info',
      blocking: false,
      action: 'check_duplicate_phone'
    });
  }

  if (fields && fields['拍摄日期'] && fields['咨询时间']) {
    try {
      const shoot = new Date(fields['拍摄日期'].value);
      const consult = new Date(fields['咨询时间'].value);
      if (shoot < consult) {
        issues.push({
          type: 'logic_conflict',
          message: '拍摄日期早于咨询时间，可能存在逻辑问题',
          severity: 'warning',
          blocking: false
        });
      }
    } catch (e) {}
  }

  const blockingIssues = issues.filter(i => i.blocking);
  const warnings = issues.filter(i => i.severity === 'warning');
  const errors = issues.filter(i => i.severity === 'error');

  return {
    issues,
    blockingIssues,
    warnings,
    errors,
    needsUserConfirmation: blockingIssues.length > 0 || warnings.some(w => w.type === 'low_confidence'),
    totalIssues: issues.length,
    canAutoExecute: blockingIssues.length === 0 && !warnings.some(w => w.type === 'low_confidence' && w.confidence < thresholds.mustConfirm)
  };
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const s1 = String(a).toLowerCase();
  const s2 = String(b).toLowerCase();
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  let matches = 0;
  for (const char of s1) {
    if (s2.includes(char)) matches++;
  }
  return matches / Math.max(s1.length, s2.length);
}

module.exports = {
  detectAmbiguities,
  stringSimilarity
};
