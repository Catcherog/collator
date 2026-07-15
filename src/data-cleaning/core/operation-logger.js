const fs = require('fs');
const path = require('path');

class OperationLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
    this._ensureLogDir();
  }

  _ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('创建日志目录失败:', err.message);
    }
  }

  _getLogFilePath(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0];
    return path.join(this.logDir, `cleaning-${dateStr}.jsonl`);
  }

  _getRuleChangesPath() {
    return path.join(this.logDir, 'rule-changes.jsonl');
  }

  _generateTimestamp() {
    return new Date().toISOString();
  }

  _appendToFile(filePath, data) {
    try {
      fs.appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf8');
      return true;
    } catch (err) {
      console.error('写入日志失败:', err.message);
      return false;
    }
  }

  log(entry) {
    const logEntry = {
      timestamp: entry.timestamp || this._generateTimestamp(),
      operationType: entry.operationType || 'clean',
      tableName: entry.tableName || '',
      recordId: entry.recordId || '',
      field: entry.field || '',
      originalValue: entry.originalValue,
      newValue: entry.newValue,
      reason: entry.reason || '',
      operator: entry.operator || 'auto',
      confidence: entry.confidence !== undefined ? entry.confidence : 1.0,
      batchId: entry.batchId || ''
    };
    return this._appendToFile(this._getLogFilePath(), logEntry);
  }

  logCorrection(tableName, recordId, correction, operator = 'auto') {
    return this.log({
      operationType: 'correct',
      tableName,
      recordId,
      field: correction.field,
      originalValue: correction.original,
      newValue: correction.corrected,
      reason: correction.reason || '',
      operator,
      confidence: correction.confidence || 1.0
    });
  }

  logBatchStart(batchId, tableName, totalCount) {
    return this.log({
      operationType: 'batch_import',
      tableName,
      recordId: '',
      field: '',
      originalValue: null,
      newValue: { totalCount },
      reason: `批量导入开始，共 ${totalCount} 条记录`,
      operator: 'auto',
      batchId
    });
  }

  logRuleUpdate(ruleType, originalConfig, newConfig, reason) {
    const entry = {
      timestamp: this._generateTimestamp(),
      operationType: 'rule_update',
      tableName: '',
      recordId: '',
      field: ruleType,
      originalValue: originalConfig,
      newValue: newConfig,
      reason: reason || '',
      operator: 'user',
      confidence: 1.0,
      batchId: ''
    };
    return this._appendToFile(this._getRuleChangesPath(), entry);
  }

  _readLogFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(entry => entry !== null);
    } catch (err) {
      console.error('读取日志文件失败:', err.message);
      return [];
    }
  }

  query(filter = {}) {
    let allEntries = [];

    try {
      const files = fs.readdirSync(this.logDir);
      const jsonlFiles = files.filter(f => f.startsWith('cleaning-') && f.endsWith('.jsonl'));
      
      for (const file of jsonlFiles) {
        const entries = this._readLogFile(path.join(this.logDir, file));
        allEntries = allEntries.concat(entries);
      }
    } catch (err) {
      console.error('查询日志失败:', err.message);
    }

    return allEntries.filter(entry => {
      if (filter.tableName && entry.tableName !== filter.tableName) return false;
      if (filter.recordId && entry.recordId !== filter.recordId) return false;
      if (filter.operationType && entry.operationType !== filter.operationType) return false;
      if (filter.batchId && entry.batchId !== filter.batchId) return false;
      
      if (filter.startTime) {
        const entryTime = new Date(entry.timestamp).getTime();
        const startTime = new Date(filter.startTime).getTime();
        if (entryTime < startTime) return false;
      }
      if (filter.endTime) {
        const entryTime = new Date(entry.timestamp).getTime();
        const endTime = new Date(filter.endTime).getTime();
        if (entryTime > endTime) return false;
      }
      
      return true;
    });
  }
}

module.exports = {
  OperationLogger,
  createLogger: (options) => new OperationLogger(options)
};
