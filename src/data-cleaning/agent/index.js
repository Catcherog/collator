const fs = require('fs');
const path = require('path');
const { createBitableWriter } = require('./execution/bitable-writer');
const { createRollbackManager } = require('./execution/rollback-manager');
const { createLinkageEngine } = require('./execution/linkage-engine');
const ui = require('./execution/confirmation-ui');
const perception = require('./perception');
const understanding = require('./understanding');
const workflows = require('./workflows');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'agent-config.json');

class ZehuaiIngestionAgent {
  constructor(config = {}) {
    this.config = {
      version: '2.0.0',
      ...config
    };
    
    if (!this.config.bitable &amp;&amp; fs.existsSync(DEFAULT_CONFIG_PATH)) {
      try {
        this.config = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
      } catch (e) {}
    }

    this.schemas = {};
    this.writer = null;
    this.rollback = null;
    this.linkage = null;
    this.ui = ui;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;

    this.writer = createBitableWriter(this.config.bitable);
    await this.writer.initialize();
    
    this.rollback = createRollbackManager(this.writer);
    this.linkage = createLinkageEngine(this.writer, this.rollback);

    await this.loadSchemas();
    this.initialized = true;
    return this;
  }

  async loadSchemas() {
    const schemaDir = path.join(__dirname, '..', 'schemas');
    const schemaFiles = ['customer.json', 'project.json', 'resource.json', 'material.json', 'product.json', 'research.json', 'sop.json'];

    for (const file of schemaFiles) {
      const filePath = path.join(schemaDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const schema = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const key = path.basename(file, '.json');
          this.schemas[key] = schema;
        } catch (e) {}
      }
    }
  }

  async ingest(input, options = {}) {
    if (!this.initialized) await this.initialize();

    const workflowName = options.workflow || this.detectWorkflow(input);
    const workflow = workflows.getWorkflow(workflowName, this, options);

    try {
      const result = await workflow.execute(input, options);
      return this.formatResult(result, workflowName);
    } catch (error) {
      return {
        status: 'error',
        error: {
          message: error.message || String(error),
          code: error.code,
          diagnosis: error.diagnosis,
          suggestion: error.suggestion,
          rollback: error.rollback
        },
        errorReport: ui.generateErrorReport(error)
      };
    }
  }

  async parseOnly(input, options = {}) {
    if (!this.initialized) await this.initialize();

    let text = input;
    if (typeof input !== 'string') {
      const p = await perception.processInput(input);
      text = p.text;
    }

    const sceneResult = understanding.classifyScene(text);
    const schemaKey = options.schemaKey || sceneResult.primaryTable || 'customer';
    const schema = this.schemas[schemaKey];

    if (!schema) {
      return { status: 'error', error: `Schema not found: ${schemaKey}` };
    }

    const extractResult = understanding.extractFields(text, schema);
    const confidenceResult = understanding.scoreOverallConfidence(extractResult.fields);
    const ambiguityResult = understanding.detectAmbiguities(extractResult, schema, {
      thresholds: this.config.processing?.confidenceThreshold
    });

    return {
      status: 'parsed',
      scene: sceneResult,
      fields: extractResult.fields,
      missing: extractResult.missing,
      confidence: confidenceResult,
      ambiguities: ambiguityResult,
      text,
      schemaKey
    };
  }

  detectWorkflow(input) {
    if (typeof input === 'object') {
      if (input.filePath || input.data) return 'batch_import';
      if (input.imagePath || (typeof input === 'string' &amp;&amp; /\.(png|jpg|jpeg)$/i.test(input))) {
        if (input.type === 'namecard' || (typeof input === 'string' &amp;&amp; input.includes('名片'))) {
          return 'namecard_ocr';
        }
        return 'customer_consultation';
      }
    }

    if (typeof input === 'string') {
      if (input.includes('名片') || /\.(png|jpg|jpeg)$/i.test(input)) return 'namecard_ocr';
      
      const sceneResult = understanding.classifyScene(input);
      const workflowMap = {
        customer_consultation: 'customer_consultation',
        order_creation: 'customer_consultation',
        resource_onboarding: 'resource_onboarding',
        material_archival: 'customer_consultation',
        product_publishing: 'customer_consultation'
      };
      return workflowMap[sceneResult.scene] || 'customer_consultation';
    }

    return 'customer_consultation';
  }

  formatResult(result, workflowName) {
    if (result.status === 'needs_confirmation' || result.status === 'preview') {
      return result;
    }

    if (result.status === 'success') {
      return {
        ...result,
        workflow: workflowName,
        successReport: ui.generateSuccessReport(result)
      };
    }

    return result;
  }

  getAvailableWorkflows() {
    return workflows.listWorkflows();
  }

  getConfig() {
    return { ...this.config };
  }

  getSchema(key) {
    return this.schemas[key] || null;
  }
}

function createAgent(config) {
  return new ZehuaiIngestionAgent(config);
}

module.exports = {
  ZehuaiIngestionAgent,
  createAgent,
  perception,
  understanding,
  workflows,
  ui,
  DEFAULT_CONFIG_PATH
};
