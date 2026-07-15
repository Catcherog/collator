const SCENE_NAMES = {
  customer_consultation: '客户咨询入库',
  order_creation: '订单创建',
  resource_onboarding: '资源入驻',
  material_archival: '素材归档',
  product_publishing: '成品发布',
  research: '调研录入',
  sop: 'SOP更新',
  unknown: '通用数据入库'
};

const CONFIDENCE_LEVELS = {
  high: { icon: '[HIGH]', label: '高置信度', color: 'green' },
  medium: { icon: '[MED]', label: '中等置信度', color: 'yellow' },
  low: { icon: '[LOW]', label: '低置信度', color: 'red' }
};

function formatConfidenceBar(score) {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return '[' + '='.repeat(filled) + '-'.repeat(empty) + ']';
}

function generateConfirmation(parsedResult) {
  let sceneKey, sceneConfVal, overallScoreVal, levelVal, primaryTableVal, fieldsObj, fieldScoresObj, ambiguitiesObj;

  if (parsedResult.scene && typeof parsedResult.scene === 'object') {
    sceneKey = parsedResult.scene.scene || 'unknown';
    sceneConfVal = parsedResult.scene.confidence || 0.8;
  } else {
    sceneKey = parsedResult.scene || 'unknown';
    sceneConfVal = parsedResult.sceneConfidence || 0.8;
  }

  fieldsObj = parsedResult.fields || {};
  fieldScoresObj = parsedResult.fieldScores || {};
  ambiguitiesObj = parsedResult.ambiguities || {};
  primaryTableVal = parsedResult.primaryTable || parsedResult.scene?.primaryTable || 'customer';

  overallScoreVal = parsedResult.overallScore;
  if (parsedResult.confidence && typeof parsedResult.confidence === 'object') {
    overallScoreVal = parsedResult.confidence.overallScore;
    levelVal = parsedResult.confidence.level;
  } else {
    levelVal = parsedResult.level;
  }

  if (overallScoreVal === undefined || overallScoreVal === null) {
    overallScoreVal = 0;
  }
  if (overallScoreVal <= 1) overallScoreVal = overallScoreVal * 100;
  if (!levelVal) {
    if (overallScoreVal >= 85) levelVal = 'high';
    else if (overallScoreVal >= 60) levelVal = 'medium';
    else levelVal = 'low';
  }

  const sceneName = SCENE_NAMES[sceneKey] || sceneKey;
  const confInfo = CONFIDENCE_LEVELS[levelVal] || CONFIDENCE_LEVELS.medium;
  const lines = [];

  lines.push('=== 数据入库确认 ===');
  lines.push('');
  lines.push(`[SCENE] 识别场景: ${sceneName} (置信度: ${Math.round(sceneConfVal * 100)}%)`);
  lines.push(`[QUALITY] 数据质量: ${confInfo.icon} ${confInfo.label} ${Math.round(overallScoreVal)}% ${formatConfidenceBar(overallScoreVal)}`);
  lines.push(`[TABLE] 目标表: ${primaryTableVal || 'customer'}`);
  lines.push('');
  
  if (fieldsObj && Object.keys(fieldsObj).length > 0) {
    lines.push('--- 提取字段 ---');
    for (const [fieldName, fieldData] of Object.entries(fieldsObj)) {
      if (!fieldData) continue;
      const value = Array.isArray(fieldData.value) ? fieldData.value.join(', ') : fieldData.value;
      const fScore = fieldScoresObj[fieldName]?.score || fieldData.confidence || 0.7;
      const scorePercent = Math.round(fScore * 100);
      const marker = scorePercent >= 85 ? '[OK]' : scorePercent >= 70 ? '[WARN]' : '[!]';
      lines.push(`  ${marker} ${fieldName}: ${value} (${scorePercent}%)`);
    }
    lines.push('');
  }

  if (ambiguitiesObj && ambiguitiesObj.issues && ambiguitiesObj.issues.length > 0) {
    lines.push('--- 需要注意的问题 ---');
    for (const issue of ambiguitiesObj.issues) {
      if (issue.type === 'enum_mismatch' && issue.availableOptions && issue.availableOptions.length === 0) continue;
      const icon = issue.severity === 'error' ? '[ERROR]' : issue.severity === 'warning' ? '[!]' : '[i]';
      lines.push(`  ${icon} ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`      建议: ${issue.suggestion}`);
      }
      if (issue.availableOptions && issue.availableOptions.length > 0) {
        lines.push(`      可选值: ${issue.availableOptions.join(' | ')}`);
      }
    }
    lines.push('');
  }

  const needsConfirm = ambiguitiesObj && ambiguitiesObj.needsUserConfirmation;
  if (needsConfirm) {
    lines.push('[ACTION] 需要您确认以上信息是否正确');
    lines.push('  - 回复"确认"或"yes"执行写入');
    lines.push('  - 回复"修改" + 字段名=新值 进行修正');
    lines.push('  - 回复"取消"放弃本次操作');
  } else {
    lines.push('[ACTION] 数据质量良好，可以自动执行');
    lines.push('  - 回复"确认"或等待自动执行');
    lines.push('  - 回复"取消"放弃本次操作');
  }

  return lines.join('\n');
}

function generateSuccessReport(result) {
  const lines = [];
  lines.push('=== 入库成功 ===');
  lines.push('');

  if (result.records && result.records.length > 0) {
    lines.push(`[OK] 成功写入 ${result.records.length} 条记录:`);
    for (const rec of result.records) {
      lines.push(`  - ${rec.tableName || rec.tableId}: ${rec.recordId}`);
    }
  }

  if (result.linkages && result.linkages.executed && result.linkages.executed.length > 0) {
    lines.push('');
    lines.push(`[LINK] 执行了 ${result.linkages.executed.length} 条跨表关联:`);
    for (const link of result.linkages.executed) {
      lines.push(`  - ${link.description || link.type}`);
    }
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push('');
    lines.push('[!] 警告:');
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  lines.push('');
  lines.push('[DONE] 数据入库完成');
  return lines.join('\n');
}

function generateErrorReport(error) {
  const lines = [];
  lines.push('=== 入库失败 ===');
  lines.push('');
  lines.push(`[ERROR] ${error.message || error}`);

  if (error.code) {
    lines.push(`[CODE] ${error.code}`);
  }

  if (error.diagnosis) {
    lines.push('');
    lines.push('[DIAGNOSIS] 诊断:');
    lines.push(`  ${error.diagnosis}`);
  }

  if (error.suggestion) {
    lines.push('');
    lines.push('[FIX] 建议:');
    if (Array.isArray(error.suggestion)) {
      for (const s of error.suggestion) {
        lines.push(`  - ${s}`);
      }
    } else {
      lines.push(`  ${error.suggestion}`);
    }
  }

  if (error.rollback) {
    lines.push('');
    lines.push('[ROLLBACK] 已回滚之前的写入操作');
  }

  lines.push('');
  lines.push('请修正问题后重试，或联系技术支持');
  return lines.join('\n');
}

function generateBatchPreview(batchResult) {
  const lines = [];
  lines.push('=== 批量导入预览 ===');
  lines.push('');
  lines.push(`[TOTAL] 共 ${batchResult.total} 条数据`);
  lines.push(`[VALID] ${batchResult.valid} 条有效`);
  lines.push(`[INVALID] ${batchResult.invalid} 条无效`);
  
  if (batchResult.errors && batchResult.errors.length > 0) {
    lines.push('');
    lines.push('[ERRORS] 问题数据:');
    for (const err of batchResult.errors.slice(0, 10)) {
      lines.push(`  第${err.row}行: ${err.message}`);
    }
    if (batchResult.errors.length > 10) {
      lines.push(`  ... 还有 ${batchResult.errors.length - 10} 条问题`);
    }
  }

  lines.push('');
  lines.push('[ACTION] 回复"确认导入"开始批量写入');
  return lines.join('\n');
}

module.exports = {
  generateConfirmation,
  generateSuccessReport,
  generateErrorReport,
  generateBatchPreview,
  SCENE_NAMES,
  CONFIDENCE_LEVELS
};
