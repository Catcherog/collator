const { OperationLogger } = require('./operation-logger');
const { DataScanner, createDataScanner } = require('./data-scanner');
const {
  DataCleaner,
  CleaningPipeline,
  FormatCleaner,
  EnumMappingCleaner,
  DefaultValueCleaner,
  NullToEmptyCleaner,
  createCleaner
} = require('./data-cleaner');
const { QualityScorer, createQualityScorer } = require('./quality-scorer');
const { RuleLearner, createInstance } = require('./rule-learning');
const { BatchProcessor, createBatchProcessor } = require('./batch-processor');

function createRuleLearner(options) {
  return createInstance(options);
}

module.exports = {
  DataCleaner,
  CleaningPipeline,
  FormatCleaner,
  EnumMappingCleaner,
  DefaultValueCleaner,
  NullToEmptyCleaner,
  OperationLogger,
  DataScanner,
  QualityScorer,
  RuleLearner,
  BatchProcessor,
  createCleaner,
  createDataScanner,
  createQualityScorer,
  createRuleLearner,
  createLogger: (options) => new OperationLogger(options),
  createBatchProcessor
};
