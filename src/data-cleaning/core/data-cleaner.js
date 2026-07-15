const rules = require('../rules');
const schemas = require('../schemas');
const config = require('../config');
const utils = require('../utils');
const { OperationLogger } = require('./operation-logger');
const ocr = require('../multimodal/ocr');
const asr = require('../multimodal/asr');
const clip = require('../multimodal/clip');

function toMessage(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item.message === 'string') return item.message;
  return String(item);
}

class CleaningPipeline {
  constructor() {
    this.cleaners = [];
  }

  addCleaner(cleaner) {
    this.cleaners.push(cleaner);
    return this;
  }

  run(context) {
    const result = {
      data: { ...(context.data || {}) },
      errors: [...(context.errors || [])],
      warnings: [...(context.warnings || [])],
      corrections: [...(context.corrections || [])]
    };

    const meta = {
      schemaKey: context.schemaKey,
      schema: context.schema,
      originalData: context.originalData
    };

    for (const cleaner of this.cleaners) {
      try {
        const cleanerResult = cleaner.clean(result, meta);
        if (cleanerResult) {
          if (cleanerResult.data) result.data = { ...result.data, ...cleanerResult.data };
          if (cleanerResult.errors) result.errors.push(...cleanerResult.errors);
          if (cleanerResult.warnings) result.warnings.push(...cleanerResult.warnings);
          if (cleanerResult.corrections) result.corrections.push(...cleanerResult.corrections);
        }
      } catch (err) {
        result.warnings.push(`清洗器 ${cleaner.name || 'unknown'} 执行异常：${err.message}`);
      }
    }

    return result;
  }
}

class FormatCleaner {
  constructor() {
    this.name = 'FormatCleaner';
  }

  clean(result, meta) {
    const { schemaKey } = meta;
    const corrections = [];
    const warnings = [];
    const cleanedData = { ...result.data };

    for (const [fieldName, value] of Object.entries(cleanedData)) {
      if (value === null || value === undefined || value === '') continue;

      const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
      if (!fieldSchema) continue;

      try {
        let sanitizedValue = value;
        const fieldType = fieldSchema.type;

        if (fieldType === 'text(phone)') {
          sanitizedValue = utils.sanitizePhone(String(value));
        } else if (fieldType === 'text(date)' || fieldType === 'datetime' || fieldType === 'date') {
          if (typeof value === 'string') {
            const parsed = utils.parseDate(value);
            if (parsed) {
              sanitizedValue = parsed;
            }
          }
        } else if (fieldType === 'text(budget)' || (fieldSchema.enumValues && fieldSchema.enumValues.some(v => v.includes('元')))) {
          if (typeof value === 'string' && !fieldSchema.enumValues.includes(value)) {
            const budgetResult = utils.normalizeBudget(value);
            if (budgetResult && budgetResult.interval && fieldSchema.enumValues.includes(budgetResult.interval)) {
              sanitizedValue = budgetResult.interval;
            }
          }
        } else if (fieldType === 'text' && typeof value === 'string') {
          sanitizedValue = utils.sanitizeText(value);
        }

        if (sanitizedValue !== value) {
          corrections.push({
            field: fieldName,
            original: value,
            corrected: sanitizedValue,
            reason: '格式清洗'
          });
          cleanedData[fieldName] = sanitizedValue;
        }
      } catch (err) {
        warnings.push(`字段 ${fieldName} 格式化失败：${err.message}`);
      }
    }

    return { data: cleanedData, corrections, warnings };
  }
}

class EnumMappingCleaner {
  constructor(confidenceThreshold = 0.85) {
    this.name = 'EnumMappingCleaner';
    this.confidenceThreshold = confidenceThreshold;
  }

  matchEnumValue(fieldSchema, input) {
    if (!fieldSchema || !fieldSchema.enumValues || !input) {
      return { matched: null, confidence: 0 };
    }

    const synonyms = config.getSynonyms();
    const lowerInput = String(input).toLowerCase();

    for (const enumValue of fieldSchema.enumValues) {
      if (enumValue.toLowerCase() === lowerInput) {
        return { matched: enumValue, confidence: 1.0 };
      }
      if (enumValue.toLowerCase().includes(lowerInput) || lowerInput.includes(enumValue.toLowerCase())) {
        return { matched: enumValue, confidence: 0.9 };
      }

      const styleSynonyms = synonyms.styleSynonyms && synonyms.styleSynonyms[enumValue];
      if (styleSynonyms) {
        for (const syn of styleSynonyms) {
          if (lowerInput.includes(syn.toLowerCase())) {
            return { matched: enumValue, confidence: 0.85, source: 'styleSynonyms' };
          }
        }
      }

      const sourceMapping = synonyms.sourceChannelMapping && synonyms.sourceChannelMapping[enumValue];
      if (sourceMapping) {
        for (const syn of sourceMapping) {
          if (lowerInput.includes(syn.toLowerCase())) {
            return { matched: enumValue, confidence: 0.85, source: 'sourceChannelMapping' };
          }
        }
      }
    }

    if (fieldSchema.fieldName.includes('风格') || fieldSchema.fieldName.includes('类型')) {
      const styleMatch = utils.findMatchingStyle(input, synonyms.styleSynonyms);
      if (styleMatch) {
        return { matched: styleMatch.style, confidence: styleMatch.confidence, source: 'fuzzyMatch' };
      }

      const shootMatch = utils.findMatchingShootType(input, synonyms.shootTypeMapping);
      if (shootMatch) {
        return { matched: shootMatch.type, confidence: shootMatch.confidence, needsConfirmation: shootMatch.needsConfirmation, source: 'shootTypeMapping' };
      }
    }

    return { matched: null, confidence: 0 };
  }

  clean(result, meta) {
    const { schemaKey } = meta;
    const corrections = [];
    const warnings = [];
    const cleanedData = { ...result.data };

    for (const [fieldName, value] of Object.entries(cleanedData)) {
      if (value === null || value === undefined || value === '') continue;

      const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
      if (!fieldSchema || !fieldSchema.enumValues || fieldSchema.enumValues.length === 0) continue;

      try {
        const values = Array.isArray(value) ? value : [value];
        const mappedValues = [];
        let hasMapping = false;

        for (const v of values) {
          if (fieldSchema.enumValues.includes(v)) {
            mappedValues.push(v);
            continue;
          }

          const matchResult = this.matchEnumValue(fieldSchema, v);
          if (matchResult.matched && matchResult.confidence >= this.confidenceThreshold) {
            mappedValues.push(matchResult.matched);
            hasMapping = true;
            corrections.push({
              field: fieldName,
              original: v,
              corrected: matchResult.matched,
              confidence: matchResult.confidence,
              reason: '枚举同义词映射',
              source: matchResult.source || 'directMatch'
            });
          } else if (matchResult.matched && matchResult.confidence >= 0.5) {
            warnings.push(`字段 ${fieldName} 的值 "${v}" 可能映射到 "${matchResult.matched}"（置信度 ${matchResult.confidence}），建议确认`);
            mappedValues.push(v);
          } else {
            mappedValues.push(v);
          }
        }

        if (hasMapping) {
          const wasArray = Array.isArray(value);
          cleanedData[fieldName] = wasArray ? mappedValues : mappedValues[0];
        }
      } catch (err) {
        warnings.push(`字段 ${fieldName} 枚举映射失败：${err.message}`);
      }
    }

    return { data: cleanedData, corrections, warnings };
  }
}

class DefaultValueCleaner {
  constructor(defaults = {}) {
    this.name = 'DefaultValueCleaner';
    this.defaults = {
      '合作状态': '待沟通',
      '项目状态': '待立项',
      ...defaults
    };
  }

  clean(result, meta) {
    const { schemaKey } = meta;
    const corrections = [];
    const cleanedData = { ...result.data };

    for (const [fieldName, defaultValue] of Object.entries(this.defaults)) {
      const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
      if (!fieldSchema) continue;

      if (cleanedData[fieldName] === undefined || cleanedData[fieldName] === null || cleanedData[fieldName] === '') {
        cleanedData[fieldName] = defaultValue;
        corrections.push({
          field: fieldName,
          original: null,
          corrected: defaultValue,
          reason: '默认值填充'
        });
      }
    }

    return { data: cleanedData, corrections };
  }
}

class NullToEmptyCleaner {
  constructor() {
    this.name = 'NullToEmptyCleaner';
  }

  clean(result, meta) {
    const cleanedData = { ...result.data };

    for (const [fieldName, value] of Object.entries(cleanedData)) {
      if (value === null || value === undefined) {
        cleanedData[fieldName] = '';
      }
    }

    return { data: cleanedData };
  }
}

class DataCleaner {
  constructor(options = {}) {
    this.options = options;
    this.pipeline = new CleaningPipeline();
    this.logger = options.logger || new OperationLogger(options.loggerOptions);
    this._setupDefaultPipeline();
  }

  setLogger(logger) {
    this.logger = logger;
    return this;
  }

  _setupDefaultPipeline() {
    this.pipeline
      .addCleaner(new NullToEmptyCleaner())
      .addCleaner(new FormatCleaner())
      .addCleaner(new EnumMappingCleaner(0.85))
      .addCleaner(new DefaultValueCleaner(this.options.defaults));
  }

  addCleaner(cleaner) {
    this.pipeline.addCleaner(cleaner);
    return this;
  }

  _findMultimodalTextField(schemaKey) {
    const candidates = ['备注', '跟进记录', '发布文案', '客户姓名', '资源名称'];
    for (const field of candidates) {
      if (schemas.getFieldSchema(schemaKey, field)) return field;
    }
    return null;
  }

  async preprocessMultimodal(schemaKey, data, options = {}) {
    const warnings = [];
    const corrections = [];
    const multimodal = { ocr: null, asr: null, clip: null };
    const extractedData = {};

    const imagePath = data.imagePath || options.imagePath;
    const audioPath = data.audioPath || options.audioPath;

    if (imagePath && ocr.isImage(imagePath)) {
      try {
        const ocrResult = await ocr.extractText(imagePath, {
          engine: options.ocrEngine || 'mock',
          fallback: true,
          mockText: options.mockOcrText,
          mockConfidence: options.mockOcrConfidence
        });
        multimodal.ocr = {
          text: ocrResult.text,
          confidence: ocrResult.confidence,
          engine: ocrResult.engine
        };

        const textField = this._findMultimodalTextField(schemaKey);
        if (textField) {
          const existing = data[textField] || '';
          const newText = (existing + ' ' + ocrResult.text).trim();
          extractedData[textField] = newText;
          corrections.push({
            field: textField,
            original: existing,
            corrected: newText,
            reason: 'OCR文本提取',
            confidence: ocrResult.confidence
          });
        }
      } catch (err) {
        warnings.push(`OCR 预处理失败：${err.message}`);
        multimodal.ocr = { error: err.message };
      }
    }

    if (audioPath) {
      try {
        const asrResult = await asr.transcribe(audioPath, {
          engine: options.asrEngine || 'mock',
          fallback: true,
          mockText: options.mockAsrText,
          mockConfidence: options.mockAsrConfidence
        });
        multimodal.asr = {
          text: asrResult.text,
          confidence: asrResult.confidence,
          engine: asrResult.engine
        };

        const textField = this._findMultimodalTextField(schemaKey);
        if (textField) {
          const existing = extractedData[textField] || data[textField] || '';
          const newText = (existing + ' ' + asrResult.text).trim();
          extractedData[textField] = newText;
          corrections.push({
            field: textField,
            original: existing,
            corrected: newText,
            reason: 'ASR语音转写',
            confidence: asrResult.confidence
          });
        }
      } catch (err) {
        warnings.push(`ASR 预处理失败：${err.message}`);
        multimodal.asr = { error: err.message };
      }
    }

    if (options.enableClip !== false && imagePath && (schemaKey === 'product' || data['发布标题'] || data['发布文案'])) {
      try {
        const clipResult = await clip.checkImageTextMatch(
          imagePath,
          data['发布标题'] || '',
          data['发布文案'] || '',
          {
            engine: options.clipEngine || 'mock',
            threshold: options.clipThreshold || 0.6,
            mockMatched: options.mockClipMatched,
            mockScore: options.mockClipScore
          }
        );
        multimodal.clip = {
          matched: clipResult.matched,
          score: clipResult.score,
          engine: clipResult.engine
        };
        if (!clipResult.matched) {
          warnings.push(`CLIP 图文一致性校验未通过（score=${clipResult.score.toFixed(3)}），请检查图片与标题/文案是否匹配`);
        }
      } catch (err) {
        warnings.push(`CLIP 一致性校验失败：${err.message}`);
        multimodal.clip = { error: err.message };
      }
    }

    return { data: extractedData, warnings, corrections, multimodal };
  }

  cleanRecord(schemaKey, data, meta = {}, options = {}) {
    if (options.enableMultimodal) {
      throw new Error('多模态清洗请使用 cleanRecordAsync');
    }
    return this._cleanRecordInternal(schemaKey, data, meta, options, null);
  }

  async cleanRecordAsync(schemaKey, data, meta = {}, options = {}) {
    let multimodalResult = null;
    if (options.enableMultimodal) {
      multimodalResult = await this.preprocessMultimodal(schemaKey, data, options);
    }
    return this._cleanRecordInternal(schemaKey, data, meta, options, multimodalResult);
  }

  _cleanRecordInternal(schemaKey, data, meta, options, multimodalResult) {
    const startTime = Date.now();
    const schema = schemas.getSchema(schemaKey);
    if (!schema) {
      return { success: false, error: `Schema ${schemaKey} 不存在`, multimodal: null };
    }

    const { tableName = schemaKey, recordId = '', operator = 'auto' } = meta;
    const errors = [];
    const warnings = [...(multimodalResult ? multimodalResult.warnings : [])];
    const corrections = [...(multimodalResult ? multimodalResult.corrections : [])];
    const cleanedData = {};

    try {
      for (const [fieldName, value] of Object.entries(data)) {
        const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
        if (!fieldSchema) {
          warnings.push(`未知字段 ${fieldName}，已忽略`);
          continue;
        }
        cleanedData[fieldName] = value;
      }

      if (multimodalResult && multimodalResult.data) {
        for (const [fieldName, value] of Object.entries(multimodalResult.data)) {
          const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
          if (!fieldSchema) {
            warnings.push(`多模态提取字段 ${fieldName} 不在 schema 中，已忽略`);
            continue;
          }
          cleanedData[fieldName] = value;
        }
      }

      this.logger.log({
        operationType: 'clean',
        tableName,
        recordId,
        field: '',
        originalValue: data,
        newValue: null,
        reason: '开始清洗记录',
        operator
      });

      const pipelineResult = this.pipeline.run({
        data: cleanedData,
        errors,
        warnings,
        corrections,
        schemaKey,
        schema,
        originalData: data
      });

      const finalData = { ...pipelineResult.data };

      for (const [fieldName, value] of Object.entries(finalData)) {
        const fieldSchema = schemas.getFieldSchema(schemaKey, fieldName);
        if (!fieldSchema) continue;

        try {
          const validationResult = rules.validateField(fieldSchema, value);
          if (validationResult.errors.length > 0) {
            pipelineResult.errors.push(...validationResult.errors.map(toMessage));
          }
          if (validationResult.warnings.length > 0) {
            pipelineResult.warnings.push(...validationResult.warnings.map(toMessage));
          }
          finalData[fieldName] = validationResult.sanitizedValue;
        } catch (err) {
          pipelineResult.warnings.push(`字段 ${fieldName} 校验失败：${err.message}`);
        }
      }

      const requiredCheck = rules.validateRequiredFields(schemaKey, finalData);
      if (!requiredCheck.valid) {
        pipelineResult.errors.push(...requiredCheck.errors.map(toMessage));
      }

      const logicCheck = rules.validateLogicConsistency(finalData);
      if (logicCheck.errors.length > 0) {
        pipelineResult.errors.push(...logicCheck.errors.map(toMessage));
      }
      if (logicCheck.warnings.length > 0) {
        pipelineResult.warnings.push(...logicCheck.warnings.map(toMessage));
      }

      for (const correction of pipelineResult.corrections) {
        this.logger.logCorrection(tableName, recordId, correction, operator);
      }

      const elapsed = Date.now() - startTime;

      return {
        success: pipelineResult.errors.length === 0,
        data: finalData,
        errors: pipelineResult.errors,
        warnings: pipelineResult.warnings,
        corrections: pipelineResult.corrections,
        missingFields: requiredCheck.missingFields,
        performance: { elapsedMs: elapsed },
        multimodal: multimodalResult ? multimodalResult.multimodal : null
      };
    } catch (err) {
      return {
        success: false,
        data: cleanedData,
        errors: [`清洗过程发生异常：${err.message}`],
        warnings,
        corrections,
        missingFields: [],
        multimodal: multimodalResult ? multimodalResult.multimodal : null
      };
    }
  }

  matchEnumValue(fieldSchema, input) {
    const mapper = new EnumMappingCleaner();
    return mapper.matchEnumValue(fieldSchema, input);
  }

  deduplicate(schemaKey, records, existingRecords) {
    const cleaningRules = config.getCleaningRules();
    const dedupRules = cleaningRules && cleaningRules.deduplicationRules[schemaKey];

    if (!dedupRules) {
      return { duplicates: [], unique: records };
    }

    const duplicates = [];
    const unique = [];

    for (const record of records) {
      let isDuplicate = false;
      const matchConfidence = {};

      for (const existing of existingRecords) {
        let totalScore = 0;
        let fieldCount = 0;

        for (const field of dedupRules.fuzzyMatchFields || []) {
          if (record[field] && existing[field]) {
            const similarity = this.calculateStringSimilarity(
              String(record[field]),
              String(existing[field])
            );
            matchConfidence[field] = similarity;
            totalScore += similarity;
            fieldCount++;
          }
        }

        for (const field of dedupRules.uniqueFields || []) {
          if (record[field] && existing[field] && record[field] === existing[field]) {
            totalScore += 1;
            fieldCount++;
          }
        }

        const avgScore = fieldCount > 0 ? totalScore / fieldCount : 0;
        if (avgScore >= dedupRules.matchThreshold) {
          isDuplicate = true;
          duplicates.push({
            newRecord: record,
            existingRecord: existing,
            confidence: avgScore,
            fieldMatches: matchConfidence,
            suggestedAction: dedupRules.action,
            options: dedupRules.promptOptions
          });
          break;
        }
      }

      if (!isDuplicate) {
        unique.push(record);
      }
    }

    return { duplicates, unique };
  }

  calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    if (str1.includes(str2) || str2.includes(str1)) return 0.9;

    const s1 = String(str1).toLowerCase();
    const s2 = String(str2).toLowerCase();

    // 短字符串（长度<2）退化为字符级 Jaccard，避免 bigram 为空集
    if (s1.length < 2 || s2.length < 2) {
      const set1 = new Set([...s1]);
      const set2 = new Set([...s2]);
      let intersection = 0;
      for (const c of set1) {
        if (set2.has(c)) intersection++;
      }
      const union = set1.size + set2.size - intersection;
      return union === 0 ? 0 : intersection / union;
    }

    // bigram 双字组 Jaccard 相似度
    const grams1 = new Set();
    const grams2 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
      grams1.add(s1.substr(i, 2));
    }
    for (let i = 0; i < s2.length - 1; i++) {
      grams2.add(s2.substr(i, 2));
    }

    let intersection = 0;
    for (const g of grams1) {
      if (grams2.has(g)) intersection++;
    }
    const union = grams1.size + grams2.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}

function createCleaner(options) {
  return new DataCleaner(options);
}

module.exports = {
  DataCleaner,
  CleaningPipeline,
  FormatCleaner,
  EnumMappingCleaner,
  DefaultValueCleaner,
  NullToEmptyCleaner,
  createCleaner
};
