const path = require('path');
const dc = require('./index');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    errors.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function assertExists(obj, prop, message) {
  assert(obj && obj[prop] !== undefined && obj[prop] !== null, message || `${prop} 应该存在`);
}

function assertType(obj, prop, type, message) {
  const actual = typeof obj[prop];
  assert(actual === type, message || `${prop} 应该是 ${type} 类型，实际是 ${actual}`);
}

console.log('=== 数据清洗模块集成测试 ===\n');

dc.init();

console.log('1. 验证模块API导出...');

assertExists(dc, 'init', 'init 函数存在');
assertExists(dc, 'config', 'config 对象存在');
assertExists(dc, 'schemas', 'schemas 对象存在');
assertExists(dc, 'rules', 'rules 对象存在');
assertExists(dc, 'utils', 'utils 对象存在');
assertType(dc, 'version', 'string', 'version 是字符串');

assertExists(dc, 'DataCleaner', 'DataCleaner 类存在');
assertExists(dc, 'createCleaner', 'createCleaner 工厂函数存在');
assertType(dc, 'createCleaner', 'function', 'createCleaner 是函数');

assertExists(dc, 'QualityScorer', 'QualityScorer 类存在');
assertExists(dc, 'createQualityScorer', 'createQualityScorer 工厂函数存在');
assertType(dc, 'createQualityScorer', 'function', 'createQualityScorer 是函数');

assertExists(dc, 'OperationLogger', 'OperationLogger 类存在');
assertExists(dc, 'createLogger', 'createLogger 工厂函数存在');
assertType(dc, 'createLogger', 'function', 'createLogger 是函数');

assertExists(dc, 'RuleLearner', 'RuleLearner 类存在');
assertExists(dc, 'createRuleLearner', 'createRuleLearner 工厂函数存在');
assertType(dc, 'createRuleLearner', 'function', 'createRuleLearner 是函数');

assertExists(dc, 'DataScanner', 'DataScanner 类存在');
assertExists(dc, 'createDataScanner', 'createDataScanner 工厂函数存在');
assertType(dc, 'createDataScanner', 'function', 'createDataScanner 是函数');

assertExists(dc, 'BatchProcessor', 'BatchProcessor 类存在');
assertExists(dc, 'createBatchProcessor', 'createBatchProcessor 工厂函数存在');
assertType(dc, 'createBatchProcessor', 'function', 'createBatchProcessor 是函数');

console.log('\n2. 验证工具函数导出...');
const utilFunctions = [
  'sanitizePhone', 'sanitizeText', 'sanitizeUrl',
  'isValidPhone', 'isValidUrl', 'isValidRating',
  'parseDate', 'normalizeBudget', 'findMatchingStyle',
  'findMatchingShootType', 'parseAmount', 'toHalfWidth'
];
for (const fn of utilFunctions) {
  assertType(dc, fn, 'function', `${fn} 工具函数存在且是函数`);
}

console.log('\n3. 验证规则函数导出...');
const ruleFunctions = [
  'validateField', 'validateRequiredFields', 'validateStateTransition',
  'validateLogicConsistency', 'validateRecord'
];
for (const fn of ruleFunctions) {
  assertType(dc, fn, 'function', `${fn} 规则函数存在且是函数`);
}

console.log('\n4. 验证Schema和Config方法...');
const schemaMethods = [
  'loadSchemas', 'getSchema', 'getSchemaByTableId', 'getSchemaByTableName',
  'getFieldSchema', 'getFieldByFieldId', 'getRequiredFields', 'getEnumFields'
];
for (const fn of schemaMethods) {
  assertType(dc, fn, 'function', `${fn} Schema方法存在`);
}
const configMethods = [
  'loadConfig', 'getSynonyms', 'getCleaningRules', 'getStyleSynonyms',
  'getShootTypeMapping', 'getFieldFormatRule', 'getStateMachine', 'getValidationLevel'
];
for (const fn of configMethods) {
  assertType(dc, fn, 'function', `${fn} Config方法存在`);
}

console.log('\n5. 端到端流程测试: 单条数据清洗...');

const testRecord = {
  '客户姓名': '  测试客户  ',
  '联系方式': '138-0013-8000',
  '意向风格': ['日系清新'],
  '预算区间': '3000-5000元',
  '来源渠道': '小红书',
  '咨询时间': '2025-06-26'
};

const cleaner = dc.createCleaner();
const cleanResult = cleaner.cleanRecord('customer', testRecord);
assert(cleanResult.success === true || cleanResult.success === false, '清洗返回结果对象');
assert(cleanResult.data !== undefined, '清洗结果包含data字段');
assert(Array.isArray(cleanResult.errors), '清洗结果包含errors数组');
assert(Array.isArray(cleanResult.warnings), '清洗结果包含warnings数组');
assert(Array.isArray(cleanResult.corrections), '清洗结果包含corrections数组');
assert(cleanResult.data['联系方式'] === '13800138000', '手机号横杠被正确移除');
assert(cleanResult.data['客户姓名'] === '测试客户', '客户姓名前后空格被去除');

console.log('\n6. 端到端流程测试: 质量评分...');

const scorer = dc.createQualityScorer();
const validationResult = dc.validateRecord('customer', cleanResult.data);
const qualityResult = scorer.score('customer', cleanResult.data, validationResult);
assert(typeof qualityResult.score === 'number', '质量分是数字');
assert(qualityResult.score >= 0 && qualityResult.score <= 100, '质量分在0-100之间');
assert(typeof qualityResult.grade === 'string', '质量等级是字符串');
assert(Array.isArray(qualityResult.deductions), '扣分明细是数组');
assert(Array.isArray(qualityResult.suggestions), '改进建议是数组');
assert(typeof qualityResult.summary === 'string', '质量摘要是字符串');

console.log('\n7. 端到端流程测试: 日志记录器...');

const logger = dc.createLogger();
assert(logger !== null && logger !== undefined, '日志记录器创建成功');
assert(typeof logger.log === 'function', 'logger有log方法');

console.log('\n8. 端到端流程测试: 批量处理...');

async function testBatch() {
  const processor = dc.createBatchProcessor();
  assert(processor !== null && processor !== undefined, '批量处理器创建成功');
  assert(typeof processor.processBatch === 'function', 'processBatch方法存在');
  assert(typeof processor.generateReport === 'function', 'generateReport方法存在');
  assert(typeof processor.getWritableRecords === 'function', 'getWritableRecords方法存在');

  const batchData = [
    { '客户姓名': '客户A', '联系方式': '13800138000' },
    { '客户姓名': '客户B', '联系方式': '13900139000', '意向风格': ['韩系唯美'] },
    { '客户姓名': '客户C', '联系方式': 'invalid' },
    { '客户姓名': '', '联系方式': '13700137000' },
    { '客户姓名': '客户E', '联系方式': '13600136000', '预算区间': '5000以上' }
  ];

  const batchResult = await processor.processBatch('customer', batchData);
  assert(batchResult.batchId !== undefined, '批量处理返回batchId');
  assert(batchResult.totalRecords === 5, '总记录数正确');
  assert(batchResult.results.length === 5, '结果数组长度正确');
  assert(batchResult.summary !== undefined, '返回summary统计');
  assert(typeof batchResult.summary.passed === 'number', '统计包含passed数');
  assert(typeof batchResult.summary.failed === 'number', '统计包含failed数');

  const report = processor.generateReport(batchResult);
  assert(typeof report === 'string', '生成文本报告');
  assert(report.length > 0, '报告非空');

  const writable = processor.getWritableRecords(batchResult, true);
  assert(Array.isArray(writable), 'getWritableRecords返回数组');

  const failed = processor.getFailedRecords(batchResult);
  assert(Array.isArray(failed), 'getFailedRecords返回数组');

  const partitioned = processor.partitionForWriting(batchResult, true, 2);
  assert(partitioned.totalWritable !== undefined, '分块结果包含totalWritable');
  assert(Array.isArray(partitioned.chunks), '分块结果包含chunks数组');
}

console.log('\n9. 向后兼容性测试...');

assert(typeof dc.loadConfig === 'function', '原有loadConfig API保持兼容');
assert(typeof dc.loadSchemas === 'function', '原有loadSchemas API保持兼容');
assert(typeof dc.getSchema === 'function', '原有getSchema API保持兼容');
assert(typeof dc.clearCache === 'function', '原有clearCache API保持兼容');

async function runAllTests() {
  try {
    await testBatch();
  } catch (err) {
    failed++;
    errors.push(`批量处理测试异常: ${err.message}`);
    console.log(`  ✗ 批量处理测试异常: ${err.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`测试结果: 通过 ${passed} 项, 失败 ${failed} 项`);
  
  if (failed > 0) {
    console.log('\n失败项:');
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('\n所有测试通过! 🎉');
    process.exit(0);
  }
}

runAllTests();
