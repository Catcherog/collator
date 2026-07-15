class BaseWorkflow {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.writer = agent.writer;
    this.rollback = agent.rollback;
    this.linkage = agent.linkage;
    this.options = options;
  }

  get name() { return 'base'; }
  get description() { return '基础工作流'; }

  async execute(input, context = {}) {
    throw new Error('execute() must be implemented by subclass');
  }

  async parseAndValidate(text, schemaKey = 'customer') {
    const perception = require('../perception');
    const understanding = require('../understanding');
    
    const sceneResult = understanding.classifyScene(text);
    const schema = this.agent.schemas[schemaKey] || this.agent.schemas[sceneResult.primaryTable];
    
    if (!schema) {
      throw new Error(`Schema not found for key: ${schemaKey}`);
    }

    const extractResult = understanding.extractFields(text, schema);
    const confidenceResult = understanding.scoreOverallConfidence(extractResult.fields);
    const ambiguityResult = understanding.detectAmbiguities(extractResult, schema, {
      thresholds: this.agent.config.processing.confidenceThreshold
    });

    return {
      scene: sceneResult.scene,
      sceneConfidence: sceneResult.confidence,
      primaryTable: sceneResult.primaryTable,
      schemaKey,
      schema,
      fields: extractResult.fields,
      missing: extractResult.missing,
      raw: extractResult.raw,
      fieldScores: confidenceResult.fieldScores,
      overallScore: confidenceResult.overallScore,
      level: confidenceResult.level,
      ambiguities: ambiguityResult
    };
  }

  async writeRecord(tableKey, fields, snapshotId, options = {}) {
    const tableId = this.writer.getTableId(tableKey);
    if (!tableId) {
      throw new Error(`Table ID not found for key: ${tableKey}`);
    }

    const cleanFields = this.sanitizeFields(fields);
    const result = await this.writer.createRecord(tableId, { fields: cleanFields });

    if (!result || !result.success || !result.recordId) {
      const errorMsg = (result && result.error) || 'createRecord 返回未知失败';
      throw new Error(`写入失败 [${tableKey}]: ${errorMsg}`);
    }

    if (snapshotId) {
      this.rollback.recordCreation(snapshotId, tableId, result.recordId, {
        tableName: tableKey
      });
    }

    return {
      recordId: result.recordId,
      tableId,
      tableKey,
      fields: cleanFields
    };
  }

  sanitizeFields(fields) {
    const clean = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object' && !Array.isArray(value)) {
        if (value.value !== undefined) {
          clean[key] = value.value;
        } else {
          clean[key] = value;
        }
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  flatFields(fields) {
    const flat = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object' && !Array.isArray(value) && value.value !== undefined) {
        flat[key] = value.value;
      } else {
        flat[key] = value;
      }
    }
    return flat;
  }
}

module.exports = BaseWorkflow;
