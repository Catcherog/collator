const fs = require('fs');
const path = require('path');
const { OperationLogger } = require('./operation-logger');

class RuleLearner {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(__dirname, '..', 'config');
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.synonymsPath = options.synonymsPath || path.join(this.configDir, 'synonyms.json');
    this.versionsDir = options.versionsDir || path.join(this.configDir, 'versions');
    this.feedbackPath = options.feedbackPath || path.join(this.dataDir, 'feedback.jsonl');
    this.logger = options.logger || new OperationLogger();
    
    this.synonyms = null;
    this._ensureDirectories();
    this.load();
  }

  _ensureDirectories() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.versionsDir)) {
        fs.mkdirSync(this.versionsDir, { recursive: true });
      }
    } catch (err) {
      console.error('创建目录失败:', err.message);
    }
  }

  _atomicWrite(filePath, content) {
    const tempPath = filePath + '.tmp';
    const backupPath = filePath + '.bak';
    
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
      }
      
      fs.writeFileSync(tempPath, content, 'utf8');
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tempPath, filePath);
      
      return true;
    } catch (err) {
      console.error('原子写入失败:', err.message);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      throw err;
    }
  }

  _createVersionBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionFile = `synonyms-${timestamp}.json`;
    const versionPath = path.join(this.versionsDir, versionFile);
    
    try {
      fs.writeFileSync(versionPath, JSON.stringify(this.synonyms, null, 2), 'utf8');
      return versionFile;
    } catch (err) {
      console.error('创建版本备份失败:', err.message);
      return null;
    }
  }

  load() {
    try {
      if (fs.existsSync(this.synonymsPath)) {
        const content = fs.readFileSync(this.synonymsPath, 'utf8');
        this.synonyms = JSON.parse(content);
      } else {
        this.synonyms = this._createDefaultSynonyms();
      }
      return true;
    } catch (err) {
      console.error('加载同义词库失败:', err.message);
      this.synonyms = this._createDefaultSynonyms();
      return false;
    }
  }

  _createDefaultSynonyms() {
    return {
      version: '1.0.0',
      description: '同义词库，用于自然语言到系统枚举值的映射',
      lastUpdated: new Date().toISOString().split('T')[0],
      styleSynonyms: {},
      shootTypeMapping: {},
      sourceChannelMapping: {},
      budgetRangeMapping: {},
      timeExpressionMapping: {}
    };
  }

  reload() {
    return this.load();
  }

  save() {
    try {
      this.synonyms.lastUpdated = new Date().toISOString().split('T')[0];
      const content = JSON.stringify(this.synonyms, null, 2);
      this._atomicWrite(this.synonymsPath, content);
      const versionFile = this._createVersionBackup();
      return { success: true, versionFile };
    } catch (err) {
      console.error('保存同义词库失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  getSynonymLibrary() {
    return JSON.parse(JSON.stringify(this.synonyms));
  }

  recordFeedback(feedback) {
    const entry = {
      timestamp: feedback.timestamp || new Date().toISOString(),
      category: feedback.category,
      originalValue: feedback.originalValue,
      correctedValue: feedback.correctedValue,
      tableName: feedback.tableName || '',
      fieldName: feedback.fieldName || '',
      operator: feedback.operator || 'user',
      accepted: feedback.accepted !== undefined ? feedback.accepted : true
    };

    try {
      fs.appendFileSync(this.feedbackPath, JSON.stringify(entry) + '\n', 'utf8');
      return { success: true };
    } catch (err) {
      console.error('记录反馈失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  addSynonym(category, standardValue, synonym, autoApply = false) {
    const originalConfig = JSON.parse(JSON.stringify(this.synonyms));
    
    if (!this.synonyms[category]) {
      if (category === 'shootTypeMapping' || category === 'budgetRangeMapping') {
        this.synonyms[category] = {};
      } else {
        this.synonyms[category] = {};
      }
    }

    let added = false;

    if (category === 'shootTypeMapping') {
      if (!this.synonyms[category][standardValue]) {
        this.synonyms[category][standardValue] = {
          synonyms: [],
          confidence: 0.8
        };
      }
      if (!this.synonyms[category][standardValue].synonyms.includes(synonym)) {
        this.synonyms[category][standardValue].synonyms.push(synonym);
        added = true;
      }
    } else if (category === 'budgetRangeMapping') {
      if (!this.synonyms[category][standardValue]) {
        this.synonyms[category][standardValue] = {
          keywords: [],
          range: [0, 0]
        };
      }
      if (!this.synonyms[category][standardValue].keywords.includes(synonym)) {
        this.synonyms[category][standardValue].keywords.push(synonym);
        added = true;
      }
    } else {
      if (!this.synonyms[category][standardValue]) {
        this.synonyms[category][standardValue] = [];
      }
      if (Array.isArray(this.synonyms[category][standardValue])) {
        if (!this.synonyms[category][standardValue].includes(synonym)) {
          this.synonyms[category][standardValue].push(synonym);
          added = true;
        }
      }
    }

    if (added) {
      const result = this.save();
      if (result.success) {
        this.logger.logRuleUpdate(
          `synonym:${category}`,
          originalConfig,
          this.synonyms,
          `添加同义词: ${synonym} -> ${standardValue}`
        );
      }
      return { success: true, added, versionFile: result.versionFile };
    }

    return { success: true, added: false };
  }

  _readAllFeedback() {
    const entries = [];
    try {
      if (!fs.existsSync(this.feedbackPath)) {
        return entries;
      }
      const content = fs.readFileSync(this.feedbackPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch (e) {}
      }
    } catch (err) {
      console.error('读取反馈文件失败:', err.message);
    }
    return entries;
  }

  getSuggestedRules(minCount = 3) {
    const feedbackEntries = this._readAllFeedback();
    const counts = {};

    for (const entry of feedbackEntries) {
      if (!entry.accepted) continue;
      
      const key = `${entry.category}||${entry.originalValue}||${entry.correctedValue}`;
      if (!counts[key]) {
        counts[key] = {
          category: entry.category,
          originalValue: entry.originalValue,
          suggestedValue: entry.correctedValue,
          count: 0,
          fieldNames: new Set()
        };
      }
      counts[key].count++;
      if (entry.fieldName) {
        counts[key].fieldNames.add(entry.fieldName);
      }
    }

    const suggestions = [];
    for (const key in counts) {
      const item = counts[key];
      if (item.count >= minCount) {
        const confidence = Math.min(0.95, 0.5 + item.count * 0.1);
        suggestions.push({
          category: item.category,
          originalValue: item.originalValue,
          suggestedValue: item.suggestedValue,
          count: item.count,
          confidence: Math.round(confidence * 100) / 100,
          fieldNames: Array.from(item.fieldNames)
        });
      }
    }

    return suggestions.sort((a, b) => b.count - a.count);
  }

  applySuggestion(suggestion) {
    const categoryMap = {
      'style_synonym': 'styleSynonyms',
      'shoot_type': 'shootTypeMapping',
      'source_channel': 'sourceChannelMapping',
      'budget_mapping': 'budgetRangeMapping',
      'time_expression': 'timeExpressionMapping'
    };

    const category = categoryMap[suggestion.category] || suggestion.category;
    
    let synonymValue = suggestion.originalValue;
    if (category === 'shootTypeMapping') {
      synonymValue = suggestion.originalValue;
    }

    return this.addSynonym(category, suggestion.suggestedValue, synonymValue, true);
  }

  getVersionHistory() {
    const versions = [];
    try {
      if (!fs.existsSync(this.versionsDir)) {
        return versions;
      }
      const files = fs.readdirSync(this.versionsDir);
      for (const file of files) {
        if (file.startsWith('synonyms-') && file.endsWith('.json')) {
          const filePath = path.join(this.versionsDir, file);
          const stats = fs.statSync(filePath);
          versions.push({
            filename: file,
            path: filePath,
            createdAt: stats.mtime.toISOString(),
            size: stats.size
          });
        }
      }
    } catch (err) {
      console.error('获取版本历史失败:', err.message);
    }
    return versions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  rollback(versionFile) {
    const versionPath = path.join(this.versionsDir, versionFile);
    
    try {
      if (!fs.existsSync(versionPath)) {
        return { success: false, error: '版本文件不存在' };
      }

      const originalConfig = JSON.parse(JSON.stringify(this.synonyms));
      const content = fs.readFileSync(versionPath, 'utf8');
      const previousVersion = JSON.parse(content);
      
      this.synonyms = previousVersion;
      const result = this.save();
      
      if (result.success) {
        this.logger.logRuleUpdate(
          'rollback',
          originalConfig,
          this.synonyms,
          `回滚到版本: ${versionFile}`
        );
      }
      
      return { success: true, versionFile: result.versionFile };
    } catch (err) {
      console.error('回滚失败:', err.message);
      return { success: false, error: err.message };
    }
  }
}

function createInstance(options = {}) {
  return new RuleLearner(options);
}

module.exports = {
  RuleLearner,
  createInstance
};
