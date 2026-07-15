const { validateRecord } = require('../rules');
const { QualityScorer, createQualityScorer } = require('./quality-scorer');
const { OperationLogger } = require('./operation-logger');
const { createCleaner } = require('./data-cleaner');
const schemas = require('../schemas');

function generateBatchId() {
  return 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

class BatchProcessor {
  constructor(options = {}) {
    this.options = options;
    this.cleaner = options.cleaner || createCleaner(options);
    this.qualityScorer = options.qualityScorer || createQualityScorer(options.weights);
    this.logger = options.logger || new OperationLogger(options.loggerOptions);
  }

  setLogger(logger) {
    this.logger = logger;
    this.cleaner.setLogger(logger);
    return this;
  }

  async processBatch(schemaKey, records, options = {}) {
    const {
      batchSize = 200,
      onProgress,
      autoCorrect = false
    } = options;

    const batchId = generateBatchId();
    const processedAt = new Date().toISOString();
    const totalRecords = records.length;
    const actualBatchSize = Math.min(batchSize, 200);

    const schema = schemas.getSchema(schemaKey);
    const tableName = schema ? (schema.tableName || schemaKey) : schemaKey;

    this.logger.logBatchStart(batchId, tableName, totalRecords);

    const results = [];
    let passed = 0;
    let withWarnings = 0;
    let failed = 0;
    let totalScore = 0;
    const issueByField = {};
    const issueByType = {};
    let correctionsCount = 0;

    for (let i = 0; i < totalRecords; i += actualBatchSize) {
      const batch = records.slice(i, i + actualBatchSize);
      const batchStartIndex = i;

      for (let j = 0; j < batch.length; j++) {
        const index = batchStartIndex + j;
        const record = batch[j];

        try {
          const cleanResult = this.cleaner.cleanRecord(schemaKey, record, {
            tableName,
            recordId: `#${index + 1}`,
            operator: 'batch_processor'
          });

          const validationResult = validateRecord(schemaKey, cleanResult.data);
          const qualityResult = this.qualityScorer.score(schemaKey, cleanResult.data, validationResult);

          let status;
          if (validationResult.status === 'failed' || cleanResult.errors.length > 0) {
            status = 'failed';
            failed++;
            qualityResult.score = Math.min(qualityResult.score, 49);
            qualityResult.grade = '较差';
          } else if (validationResult.status === 'warning' || cleanResult.warnings.length > 0 || qualityResult.deductions.length > 0) {
            status = 'warning';
            withWarnings++;
          } else {
            status = 'passed';
            passed++;
          }

          totalScore += qualityResult.score;
          correctionsCount += cleanResult.corrections.length;

          const allIssues = [...validationResult.errors, ...validationResult.warnings];
          for (const issue of allIssues) {
            if (issue.field) {
              issueByField[issue.field] = (issueByField[issue.field] || 0) + 1;
            }
            if (issue.code) {
              issueByType[issue.code] = (issueByType[issue.code] || 0) + 1;
            }
          }

          for (const corr of cleanResult.corrections) {
            if (corr.field) {
              issueByField[corr.field] = (issueByField[corr.field] || 0) + 1;
            }
            issueByType['AUTO_CORRECTED'] = (issueByType['AUTO_CORRECTED'] || 0) + 1;
          }

          results.push({
            index,
            data: cleanResult.data,
            originalData: record,
            validation: {
              status: validationResult.status,
              errors: validationResult.errors,
              warnings: validationResult.warnings,
              cleanErrors: cleanResult.errors,
              cleanWarnings: cleanResult.warnings
            },
            quality: qualityResult,
            corrections: cleanResult.corrections,
            status
          });
        } catch (err) {
          failed++;
          results.push({
            index,
            data: record,
            originalData: record,
            validation: {
              status: 'failed',
              errors: [{ field: '_system', code: 'PROCESS_ERROR', message: err.message, severity: 'error' }],
              warnings: [],
              cleanErrors: [err.message],
              cleanWarnings: []
            },
            quality: { score: 0, grade: '较差', deductions: [], suggestions: [err.message], summary: '处理失败' },
            corrections: [],
            status: 'failed'
          });
          issueByField['_system'] = (issueByField['_system'] || 0) + 1;
          issueByType['PROCESS_ERROR'] = (issueByType['PROCESS_ERROR'] || 0) + 1;
        }

        if (onProgress) {
          onProgress({
            batchId,
            processed: index + 1,
            total: totalRecords,
            current: results[results.length - 1],
            percent: Math.round(((index + 1) / totalRecords) * 100)
          });
        }
      }
    }

    const passRate = totalRecords > 0 ? Math.round((passed / totalRecords) * 100) : 0;
    const averageScore = totalRecords > 0 ? Math.round((totalScore / totalRecords) * 10) / 10 : 0;

    const summary = {
      passed,
      withWarnings,
      failed,
      passRate,
      averageScore,
      issueByField,
      issueByType,
      correctionsCount
    };

    this.logger.log({
      operationType: 'batch_import',
      tableName,
      recordId: '',
      field: '',
      originalValue: null,
      newValue: { summary },
      reason: `批量处理完成: ${passed}通过, ${withWarnings}警告, ${failed}失败, 通过率${passRate}%, 平均分${averageScore}`,
      operator: 'batch_processor',
      batchId
    });

    return {
      batchId,
      schemaKey,
      tableName,
      processedAt,
      totalRecords,
      results,
      summary
    };
  }

  generateReport(batchResult, format = 'text') {
    if (format !== 'text') {
      throw new Error(`Unsupported format: ${format}`);
    }

    const { totalRecords, tableName, summary, results } = batchResult;
    const { passed, withWarnings, failed, passRate, averageScore, issueByField, issueByType, correctionsCount } = summary;
    const warnRate = totalRecords > 0 ? Math.round((withWarnings / totalRecords) * 100) : 0;
    const failRate = totalRecords > 0 ? Math.round((failed / totalRecords) * 100) : 0;

    const gradeDistribution = { '优秀': 0, '良好': 0, '中等': 0, '较差': 0 };
    for (const r of results) {
      const grade = r.quality.grade;
      if (gradeDistribution[grade] !== undefined) {
        gradeDistribution[grade]++;
      }
    }

    const previewCount = Math.min(5, results.length);

    let report = `📦 **批量导入预览**

📊 **数据概览**
- 总记录数: ${totalRecords}条
- 目标表: ${tableName}
- 操作类型: 批量创建
- 平均质量分: ${averageScore}
- 自动修正: ${correctionsCount}处

✅ **验证通过**: ${passed}条 (${passRate}%)
⚠️ **需要确认**: ${withWarnings}条 (${warnRate}%)
❌ **无法处理**: ${failed}条 (${failRate}%)

🏆 **质量等级分布**
- 优秀 (≥90分): ${gradeDistribution['优秀']}条
- 良好 (70-89分): ${gradeDistribution['良好']}条
- 中等 (50-69分): ${gradeDistribution['中等']}条
- 较差 (<50分): ${gradeDistribution['较差']}条

---
**前${previewCount}条预览**:\n`;

    for (let i = 0; i < previewCount; i++) {
      const r = results[i];
      const fields = Object.entries(r.data).slice(0, 4);
      const fieldValues = fields.map(([k, v]) => {
        if (v === null || v === undefined || v === '') return '-';
        if (Array.isArray(v)) return v.join('、');
        return String(v).substring(0, 15);
      }).join(' / ');

      let statusIcon;
      if (r.status === 'passed') statusIcon = '✅';
      else if (r.status === 'warning') statusIcon = '⚠️';
      else statusIcon = '❌';

      report += `#${r.index + 1} ${fieldValues} / ${statusIcon}\n`;
    }

    const fieldIssueEntries = Object.entries(issueByField).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const typeIssueEntries = Object.entries(issueByType).sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (fieldIssueEntries.length > 0) {
      report += `\n---\n📈 **问题字段统计 (Top 5)**\n`;
      for (const [field, count] of fieldIssueEntries) {
        report += `- ${field}: ${count}次\n`;
      }
    }

    if (typeIssueEntries.length > 0) {
      report += `\n📋 **问题类型统计**\n`;
      for (const [type, count] of typeIssueEntries) {
        const typeName = this._getIssueTypeName(type);
        report += `- ${typeName}: ${count}次\n`;
      }
    }

    if (failed > 0) {
      report += `\n---\n❌ **无法处理的记录**:\n`;
      const failedRecords = results.filter(r => r.status === 'failed').slice(0, 3);
      for (const r of failedRecords) {
        const firstError = r.validation.errors[0];
        const errorMsg = firstError ? firstError.message : '未知错误';
        report += `#${r.index + 1}: ${errorMsg}\n`;
      }
      if (failed > 3) {
        report += `... 还有${failed - 3}条失败记录\n`;
      }
    }

    report += `\n---\n**预计耗时**: 约${Math.ceil(totalRecords / 10) * 2}秒\n`;

    return report;
  }

  _getIssueTypeName(code) {
    const typeNames = {
      'REQUIRED_MISSING': '必填字段缺失',
      'TYPE_ERROR': '类型错误',
      'FORMAT_ERROR': '格式错误',
      'ENUM_MISMATCH': '枚举值不匹配',
      'RANGE_ERROR': '取值范围错误',
      'INVALID_DATE': '日期无效',
      'DATE_CONFLICT': '日期冲突',
      'MISSING_RELATION': '关联缺失',
      'BUDGET_MISMATCH': '预算不匹配',
      'STYLE_WARNING': '风格建议',
      'LOW_CONFIDENCE': '低置信度',
      'LENGTH_WARNING': '长度警告',
      'VALIDATION_EXCEPTION': '校验异常',
      'AUTO_CORRECTED': '自动修正',
      'PROCESS_ERROR': '处理异常'
    };
    return typeNames[code] || code;
  }

  getWritableRecords(batchResult, includeWarnings = false) {
    return batchResult.results
      .filter(r => r.status === 'passed' || (includeWarnings && r.status === 'warning'))
      .map(r => ({
        index: r.index,
        data: r.data,
        status: r.status,
        quality: r.quality
      }));
  }

  getFailedRecords(batchResult) {
    return batchResult.results
      .filter(r => r.status === 'failed')
      .map(r => ({
        index: r.index,
        data: r.originalData,
        errors: [
          ...r.validation.errors,
          ...r.validation.cleanErrors.map(msg => ({ field: '_clean', code: 'CLEAN_ERROR', message: msg, severity: 'error' }))
        ],
        corrections: r.corrections
      }));
  }

  partitionForWriting(batchResult, includeWarnings = false, chunkSize = 200) {
    const writable = this.getWritableRecords(batchResult, includeWarnings);
    const actualChunkSize = Math.min(chunkSize, 200);
    const chunks = [];

    for (let i = 0; i < writable.length; i += actualChunkSize) {
      chunks.push(writable.slice(i, i + actualChunkSize));
    }

    return {
      totalWritable: writable.length,
      chunks,
      chunkSize: actualChunkSize
    };
  }
}

function createBatchProcessor(options) {
  return new BatchProcessor(options);
}

module.exports = {
  BatchProcessor,
  createBatchProcessor
};
