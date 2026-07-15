const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { DataCleaner } = require('./data-cleaner');
const rules = require('../rules');
const schemas = require('../schemas');
const utils = require('../utils');
const { QualityScorer } = require('./quality-scorer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCAN_STATE_FILE = path.join(DATA_DIR, 'scan-state.json');
// TEMP_DIR 必须指向项目根目录（向上2层：core/ → data-cleaning/ → 项目根）
const TEMP_DIR = path.join(__dirname, '..', '..');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class DataScanner {
  constructor(options = {}) {
    this.options = options;
    this.appToken = options.appToken || process.env.FEISHU_APP_TOKEN || null;
    this.cleaner = options.cleaner || new DataCleaner();
    this.qualityScorer = options.qualityScorer || new QualityScorer();
    this.mockFetchRecords = options.mockFetchRecords || null;
    ensureDir(DATA_DIR);
  }

  _getLarkCliCommand() {
    if (process.platform === 'win32') {
      return 'npx lark-cli.cmd';
    }
    return 'npx lark-cli';
  }

  _writeTempJsonFile(data) {
    const tempName = `lark-temp-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.json`;
    const tempPath = path.join(TEMP_DIR, tempName);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    return tempName;
  }

  _cleanupTempFile(tempName) {
    try {
      const tempPath = path.join(TEMP_DIR, tempName);
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
    }
  }

  _callLarkApi(method, urlPath, params = {}) {
    if (!this.appToken) {
      throw new Error('FEISHU_APP_TOKEN 未配置：请在环境变量或 options.appToken 中设置飞书多维表 appToken');
    }

    const larkCmd = this._getLarkCliCommand();
    const tempName = this._writeTempJsonFile(params);
    let tempFileCleaned = false;

    try {
      const cmd = `${larkCmd} api ${method} "${urlPath}" --as user --data @"${tempName}"`;

      const apiTimeout = this.options.apiTimeout || 30000;
      let stdout;
      try {
        stdout = execSync(cmd, {
          encoding: 'utf-8',
          cwd: TEMP_DIR,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: apiTimeout,
          killSignal: 'SIGTERM'
        });
      } catch (err) {
        if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
          throw new Error(`lark-cli 调用超时（${apiTimeout}ms）：${method} ${urlPath}`);
        }
        throw err;
      }

      this._cleanupTempFile(tempName);
      tempFileCleaned = true;

      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch (parseErr) {
        const match = stdout.match(/\{[\s\S]*\}/);
        if (match) {
          result = JSON.parse(match[0]);
        } else {
          throw new Error(`无法解析API响应: ${stdout.substring(0, 200)}`);
        }
      }

      if (result.code !== undefined && result.code !== 0) {
        throw new Error(`飞书API错误: code=${result.code}, msg=${result.msg || 'unknown'}`);
      }

      return result.data || result;
    } catch (err) {
      if (!tempFileCleaned) {
        this._cleanupTempFile(tempName);
      }
      if (err.stderr) {
        throw new Error(`API调用失败: ${err.message}, stderr: ${err.stderr.substring(0, 500)}`);
      }
      throw err;
    }
  }

  fetchRecords(tableId, options = {}) {
    if (this.mockFetchRecords) {
      return this.mockFetchRecords(tableId, options);
    }

    const { viewId, pageSize = 100, filter } = options;
    const allRecords = [];
    let pageToken = null;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const queryParams = {
        page_size: pageSize
      };
      if (pageToken) {
        queryParams.page_token = pageToken;
      }
      if (viewId) {
        queryParams.view_id = viewId;
      }
      if (filter) {
        queryParams.filter = filter;
      }

      const urlPath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`;
      const data = this._callLarkApi('GET', urlPath, queryParams);

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          allRecords.push({
            recordId: item.record_id,
            fields: item.fields || {},
            lastModifiedTime: item.last_modified_time
          });
        }
      }

      total = data.total || allRecords.length;
      hasMore = data.has_more || false;
      pageToken = data.page_token || null;
    }

    return {
      records: allRecords,
      total,
      hasMore: false
    };
  }

  _getScanState() {
    try {
      if (fs.existsSync(SCAN_STATE_FILE)) {
        const content = fs.readFileSync(SCAN_STATE_FILE, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
    }
    return { lastScanTime: null, scans: {} };
  }

  _saveScanState(state) {
    fs.writeFileSync(SCAN_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }

  _generateSuggestedFixes(schemaKey, record, errors, warnings, cleanedData) {
    const suggestions = {};
    const schema = schemas.getSchema(schemaKey);
    if (!schema) return suggestions;

    const allIssues = [...errors, ...warnings];

    for (const issue of allIssues) {
      const fieldName = issue.field;
      if (!fieldName || suggestions[fieldName]) continue;

      const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
      if (!fieldSchema) continue;

      const originalValue = record.fields[fieldName];

      if (issue.code === 'REQUIRED_MISSING') {
        suggestions[fieldName] = '需补充';
        continue;
      }

      if (issue.code === 'FORMAT_ERROR') {
        if (fieldSchema.type === 'text(phone)' && originalValue) {
          const cleaned = utils.sanitizePhone(String(originalValue));
          if (utils.isValidPhone(cleaned)) {
            suggestions[fieldName] = cleaned;
            continue;
          }
        }
        if (fieldSchema.type === 'text(url)' && originalValue) {
          let url = String(originalValue).trim();
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          if (utils.isValidUrl(url)) {
            suggestions[fieldName] = url;
            continue;
          }
        }
        if ((fieldSchema.type === 'date' || fieldSchema.type === 'datetime' || fieldSchema.type === 'text(date)') && originalValue) {
          const parsed = utils.parseDate(String(originalValue));
          if (parsed) {
            suggestions[fieldName] = parsed;
            continue;
          }
        }
        suggestions[fieldName] = issue.suggestion || `请检查${fieldName}格式`;
        continue;
      }

      if (issue.code === 'ENUM_MISMATCH' && fieldSchema.enumValues && originalValue) {
        const inputVal = Array.isArray(originalValue) ? originalValue[0] : String(originalValue);
        const matchResult = this.cleaner.matchEnumValue(fieldSchema, inputVal);
        if (matchResult && matchResult.matched && matchResult.confidence >= 0.7) {
          suggestions[fieldName] = matchResult.matched;
          continue;
        }
        suggestions[fieldName] = `请选择：${fieldSchema.enumValues.join('、')}`;
        continue;
      }

      if (issue.suggestion) {
        suggestions[fieldName] = issue.suggestion;
      }
    }

    return suggestions;
  }

  scanTable(schemaKey, options = {}) {
    const { incremental = false, onProgress = null } = options;
    const schema = schemas.getSchema(schemaKey);
    if (!schema) {
      throw new Error(`Schema ${schemaKey} 不存在`);
    }

    const tableId = schema.tableId;
    if (!tableId) {
      throw new Error(`Schema ${schemaKey} 没有配置tableId`);
    }

    const scanState = this._getScanState();
    const lastScanTime = incremental ? (scanState.scans[schemaKey] || scanState.lastScanTime || 0) : 0;

    const startTime = Date.now();
    const fetchResult = this.fetchRecords(tableId, options);
    let records = fetchResult.records;

    if (incremental && lastScanTime > 0) {
      records = records.filter(r => {
        const recordTime = r.lastModifiedTime || 0;
        return recordTime > lastScanTime;
      });
    }

    const issues = [];
    let passed = 0;
    let withWarnings = 0;
    let withErrors = 0;
    let totalScore = 0;
    const issueByField = {};
    const issueByType = {};

    const totalRecords = records.length;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const fields = record.fields || {};

      const cleanResult = this.cleaner.cleanRecord(schemaKey, fields, {
        recordId: record.recordId
      });

      const validationResult = rules.validateRecord(schemaKey, cleanResult.data);

      const correctionIssues = [];
      const correctionFixes = {};
      for (const corr of cleanResult.corrections || []) {
        correctionIssues.push({
          field: corr.field,
          code: 'FORMAT_AUTO_CORRECTED',
          message: `字段 ${corr.field} 格式不规范（${corr.reason}），建议修正`,
          severity: 'warning',
          suggestion: `建议改为: ${corr.corrected}`
        });
        correctionFixes[corr.field] = corr.corrected;
      }

      const allErrors = validationResult.errors;
      const allWarnings = [...validationResult.warnings, ...cleanResult.warnings.map(w => ({
        field: '',
        code: 'CLEAN_WARNING',
        message: w,
        severity: 'warning'
      })), ...correctionIssues];

      const scoreResult = this.qualityScorer.score(schemaKey, cleanResult.data, {
        errors: allErrors,
        warnings: allWarnings
      });

      const hasErrors = allErrors.length > 0;
      const hasWarnings = allWarnings.length > 0;

      if (hasErrors) {
        withErrors++;
      } else if (hasWarnings) {
        withWarnings++;
      } else {
        passed++;
      }

      totalScore += scoreResult.score;

      const allIssues = [...allErrors, ...allWarnings];
      for (const issue of allIssues) {
        if (issue.field) {
          issueByField[issue.field] = (issueByField[issue.field] || 0) + 1;
        }
        issueByType[issue.code] = (issueByType[issue.code] || 0) + 1;
      }

      if (hasErrors || hasWarnings) {
        const generatedFixes = this._generateSuggestedFixes(
          schemaKey,
          record,
          allErrors,
          allWarnings.filter(w => w.code !== 'FORMAT_AUTO_CORRECTED' && w.code !== 'CLEAN_WARNING'),
          cleanResult.data
        );

        const suggestedFixes = {
          ...generatedFixes,
          ...correctionFixes
        };

        issues.push({
          recordId: record.recordId,
          issues: allIssues.map(iss => ({
            field: iss.field,
            code: iss.code,
            message: iss.message,
            severity: iss.severity
          })),
          qualityScore: scoreResult.score,
          qualityGrade: scoreResult.grade,
          suggestedFixes
        });
      }

      if (onProgress && typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: totalRecords,
          recordId: record.recordId,
          hasErrors,
          hasWarnings,
          score: scoreResult.score
        });
      }
    }

    const scannedAt = Date.now();
    const averageScore = totalRecords > 0 ? Math.round((totalScore / totalRecords) * 10) / 10 : 100;

    scanState.lastScanTime = scannedAt;
    scanState.scans = scanState.scans || {};
    scanState.scans[schemaKey] = scannedAt;
    this._saveScanState(scanState);

    return {
      schemaKey,
      tableId,
      scannedAt,
      totalRecords,
      issues,
      summary: {
        passed,
        withWarnings,
        withErrors,
        averageScore,
        issueByField,
        issueByType
      }
    };
  }
}

function createDataScanner(options) {
  return new DataScanner(options);
}

module.exports = {
  DataScanner,
  createDataScanner
};
