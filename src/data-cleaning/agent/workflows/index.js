const BaseWorkflow = require('./base-workflow');
const CustomerConsultationWorkflow = require('./customer-consultation');
const ResourceOnboardingWorkflow = require('./resource-onboarding');
const BatchImportWorkflow = require('./batch-import');
const NamecardOCRWorkflow = require('./namecard-ocr');

const WORKFLOW_REGISTRY = {
  customer_consultation: CustomerConsultationWorkflow,
  resource_onboarding: ResourceOnboardingWorkflow,
  batch_import: BatchImportWorkflow,
  namecard_ocr: NamecardOCRWorkflow
};

function getWorkflow(name, agent, options = {}) {
  const WorkflowClass = WORKFLOW_REGISTRY[name];
  if (!WorkflowClass) {
    throw new Error(`Workflow not found: ${name}. Available: ${Object.keys(WORKFLOW_REGISTRY).join(', ')}`);
  }
  return new WorkflowClass(agent, options);
}

const WORKFLOW_META = {
  customer_consultation: { name: '客户咨询入库', description: '客户咨询入库：客户表+项目表联动' },
  resource_onboarding: { name: '资源入驻', description: '资源入驻：模特/化妆师/场地等资源录入' },
  batch_import: { name: '批量导入', description: '批量导入：从CSV/JSON批量写入飞书多维表' },
  namecard_ocr: { name: '名片OCR', description: '名片OCR识别：从名片图片提取信息录入资源表' }
};

function listWorkflows() {
  return Object.entries(WORKFLOW_REGISTRY).map(([key, cls]) => ({
    key,
    name: WORKFLOW_META[key]?.name || key,
    description: WORKFLOW_META[key]?.description || ''
  }));
}

module.exports = {
  BaseWorkflow,
  CustomerConsultationWorkflow,
  ResourceOnboardingWorkflow,
  BatchImportWorkflow,
  NamecardOCRWorkflow,
  getWorkflow,
  listWorkflows,
  WORKFLOW_REGISTRY
};
