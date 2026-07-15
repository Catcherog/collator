function scoreFieldConfidence(value, fieldMeta, sourceText) {
  if (value === null || value === undefined || value === '') {
    return { score: 0, reason: 'empty' };
  }

  if (!fieldMeta) {
    return { score: 0.5, reason: 'no_field_meta' };
  }

  let score = 0.7;
  const reasons = [];

  if (fieldMeta.enumValues &amp;&amp; fieldMeta.enumValues.length &gt; 0) {
    if (fieldMeta.enumValues.includes(value)) {
      score = 0.95;
      reasons.push('exact_enum_match');
    } else {
      let bestMatch = 0;
      for (const enumVal of fieldMeta.enumValues) {
        if (String(value).includes(enumVal) || enumVal.includes(String(value))) {
          bestMatch = Math.max(bestMatch, 0.75);
        }
      }
      score = bestMatch || 0.4;
      if (bestMatch &gt; 0) reasons.push('partial_enum_match');
    }
  } else {
    if (sourceText &amp;&amp; sourceText.includes(String(value))) {
      score = Math.min(score + 0.2, 0.95);
      reasons.push('exact_source_match');
    }
  }

  if (fieldMeta.type &amp;&amp; fieldMeta.type.includes('phone')) {
    const phoneDigits = String(value).replace(/\D/g, '');
    if (phoneDigits.length === 11) {
      score = 0.99;
      reasons.push('valid_phone_format');
    } else {
      score = Math.min(score, 0.5);
      reasons.push('invalid_phone_length');
    }
  }

  if (fieldMeta.type === 'datetime' || fieldMeta.type === 'date') {
    if (value instanceof Date || !isNaN(Date.parse(value))) {
      score = 0.9;
      reasons.push('valid_date');
    }
  }

  return { score: Math.round(score * 100) / 100, reasons };
}

function scoreOverallConfidence(fields) {
  const fieldScores = {};
  let totalScore = 0;
  let fieldCount = 0;
  let requiredCount = 0;
  let requiredScore = 0;

  for (const [fieldName, fieldData] of Object.entries(fields)) {
    if (fieldData === null || fieldData === undefined) continue;
    
    const value = fieldData.value !== undefined ? fieldData.value : fieldData;
    const meta = fieldData.meta || fieldData.fieldMeta || null;
    const sourceText = fieldData.sourceText || fieldData.source || '';

    const scoreResult = scoreFieldConfidence(value, meta, sourceText);
    fieldScores[fieldName] = scoreResult;
    totalScore += scoreResult.score;
    fieldCount++;

    if (meta &amp;&amp; meta.required) {
      requiredCount++;
      requiredScore += scoreResult.score;
    }
  }

  const avgScore = fieldCount &gt; 0 ? totalScore / fieldCount : 0;
  const reqScore = requiredCount &gt; 0 ? requiredScore / requiredCount : avgScore;
  const overallScore = Math.round((avgScore * 0.4 + reqScore * 0.6) * 100);

  let level;
  if (overallScore &gt;= 85) level = 'high';
  else if (overallScore &gt;= 60) level = 'medium';
  else level = 'low';

  return {
    fieldScores,
    overallScore,
    level,
    averageFieldScore: Math.round(avgScore * 100) / 100,
    requiredFieldScore: Math.round(reqScore * 100) / 100,
    totalFields: fieldCount,
    requiredFields: requiredCount
  };
}

module.exports = {
  scoreFieldConfidence,
  scoreOverallConfidence
};
