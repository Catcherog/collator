const agent = require('./agent');
const core = require('./core');
const rules = require('./rules');
const config = require('./config');

// init 函数：懒加载初始化配置与 schema（benchmark 期望调用）
let _initialized = false;
function init(options = {}) {
  if (_initialized && !options.forceRefresh) return;
  // 触发配置与 schema 的懒加载
  require('./config');
  require('./schemas');
  _initialized = true;
}

module.exports = {
  // 模块聚合导出
  agent,
  core,
  rules,
  config,
  // benchmark 期望的统一 API
  init,
  createCleaner: core.createCleaner,
  createQualityScorer: core.createQualityScorer,
  createBatchProcessor: core.createBatchProcessor,
  createDataScanner: core.createDataScanner,
  createLogger: core.createLogger,
  validateRecord: rules.validateRecord,
  // agent 层便捷导出
  createAgent: agent.createAgent,
  ZehuaiIngestionAgent: agent.ZehuaiIngestionAgent,
  // 向后兼容：保留旧字段名（指向 core 的对应模块）
  cleaner: core,
  batchProcessor: core.createBatchProcessor ? { BatchProcessor: core.BatchProcessor } : undefined
};
