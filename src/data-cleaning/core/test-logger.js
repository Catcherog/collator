const fs = require('fs');
const path = require('path');
const { OperationLogger, createCleaner } = require('./index');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function cleanupTestDir(testDir) {
  try {
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  } catch (e) {}
}

function runTests() {
  const testLogDir = path.join(__dirname, '..', 'logs-test');
  cleanupTestDir(testLogDir);

  console.log('=== 操作日志模块测试 ===\n');

  console.log('1. 文件不存在时自动创建日志目录');
  const logger1 = new OperationLogger({ logDir: testLogDir });
  assert(fs.existsSync(testLogDir), '日志目录自动创建成功');
  console.log();

  console.log('2. 追加写入日志不覆盖历史');
  logger1.log({
    operationType: 'clean',
    tableName: 'customer',
    recordId: 'REC001',
    field: '联系方式',
    originalValue: '137-6666-8888',
    newValue: '13766668888',
    reason: '格式清洗:手机号去横杠'
  });
  const logFile1 = logger1._getLogFilePath();
  const lineCount1 = fs.readFileSync(logFile1, 'utf8').trim().split('\n').filter(l => l).length;
  assert(lineCount1 === 1, `第一次写入后有1条记录（实际 ${lineCount1}）`);
  
  logger1.log({
    operationType: 'correct',
    tableName: 'customer',
    recordId: 'REC002',
    field: '意向风格',
    originalValue: '小清新',
    newValue: '日系清新',
    reason: '同义词映射:小清新→日系清新'
  });
  const lineCount2 = fs.readFileSync(logFile1, 'utf8').trim().split('\n').filter(l => l).length;
  assert(lineCount2 === 2, `第二次追加写入后有2条记录（实际 ${lineCount2}，未覆盖历史）`);
  console.log();

  console.log('3. 日志条目包含所有必要字段');
  const entries = logger1.query();
  const firstEntry = entries[0];
  const requiredFields = ['timestamp', 'operationType', 'tableName', 'recordId', 'field', 'originalValue', 'newValue', 'reason', 'operator', 'confidence', 'batchId'];
  let allFieldsPresent = true;
  for (const field of requiredFields) {
    if (!(field in firstEntry)) {
      allFieldsPresent = false;
      console.log(`  ✗ 缺少字段: ${field}`);
    }
  }
  assert(allFieldsPresent, '日志条目包含所有必要字段');
  assert(firstEntry.operator === 'auto', '默认operator为auto');
  assert(typeof firstEntry.timestamp === 'string' && firstEntry.timestamp.includes('T'), 'timestamp为ISO格式');
  console.log();

  console.log('4. logCorrection 方法正确记录修正');
  logger1.logCorrection('customer', 'REC003', {
    field: '预算区间',
    original: '2000多',
    corrected: '2000-3000元',
    reason: '预算金额归一化',
    confidence: 0.9
  });
  const correctionEntries = logger1.query({ operationType: 'correct', recordId: 'REC003' });
  assert(correctionEntries.length === 1, `logCorrection写入1条记录（实际 ${correctionEntries.length}）`);
  const corrEntry = correctionEntries[0];
  assert(corrEntry.field === '预算区间', `field正确（${corrEntry.field}）`);
  assert(corrEntry.originalValue === '2000多', `originalValue正确（${corrEntry.originalValue}）`);
  assert(corrEntry.newValue === '2000-3000元', `newValue正确（${corrEntry.newValue}）`);
  assert(corrEntry.confidence === 0.9, `confidence正确（${corrEntry.confidence}）`);
  console.log();

  console.log('5. 按recordId查询能返回该记录所有历史');
  logger1.logCorrection('customer', 'REC001', {
    field: '意向风格',
    original: '文艺风',
    corrected: '日系清新',
    reason: '同义词映射'
  });
  const rec001Entries = logger1.query({ recordId: 'REC001' });
  assert(rec001Entries.length === 2, `REC001有2条历史记录（实际 ${rec001Entries.length}）`);
  assert(rec001Entries.every(e => e.recordId === 'REC001'), '所有返回记录的recordId都是REC001');
  console.log();

  console.log('6. 按tableName查询筛选');
  logger1.log({
    operationType: 'clean',
    tableName: 'product',
    recordId: 'PROD001',
    field: '产品名称',
    originalValue: '  测试产品  ',
    newValue: '测试产品',
    reason: '去除首尾空格'
  });
  const customerEntries = logger1.query({ tableName: 'customer' });
  const productEntries = logger1.query({ tableName: 'product' });
  assert(customerEntries.length > 0, '按customer筛选有结果');
  assert(productEntries.length === 1, `按product筛选有1条结果（实际 ${productEntries.length}）`);
  assert(productEntries[0].tableName === 'product', 'product筛选结果tableName正确');
  console.log();

  console.log('7. 按时间范围筛选正常工作');
  const now = new Date();
  const pastTime = new Date(now.getTime() - 3600000);
  const futureTime = new Date(now.getTime() + 3600000);
  const allTimeEntries = logger1.query({ startTime: pastTime.toISOString(), endTime: futureTime.toISOString() });
  const totalEntries = logger1.query().length;
  assert(allTimeEntries.length === totalEntries, '包含所有记录的时间范围返回全部结果');
  
  const futureOnlyEntries = logger1.query({ startTime: futureTime.toISOString() });
  assert(futureOnlyEntries.length === 0, '未来时间范围筛选返回0条');
  console.log();

  console.log('8. logBatchStart 记录批量操作开始');
  logger1.logBatchStart('BATCH001', 'customer', 100);
  const batchEntries = logger1.query({ operationType: 'batch_import', batchId: 'BATCH001' });
  assert(batchEntries.length === 1, '批量开始日志已记录');
  assert(batchEntries[0].newValue.totalCount === 100, '批量总数正确');
  console.log();

  console.log('9. logRuleUpdate 记录规则变更到单独文件');
  const originalSynonyms = { 小清新: ['小清新', '文艺'] };
  const newSynonyms = { 小清新: ['小清新', '文艺', '清新风'] };
  logger1.logRuleUpdate('synonyms', originalSynonyms, newSynonyms, '新增同义词:清新风');
  const ruleChangesPath = logger1._getRuleChangesPath();
  assert(fs.existsSync(ruleChangesPath), 'rule-changes.jsonl文件已创建');
  const ruleContent = fs.readFileSync(ruleChangesPath, 'utf8').trim();
  assert(ruleContent.length > 0, '规则变更文件有内容');
  const ruleEntry = JSON.parse(ruleContent.split('\n')[0]);
  assert(ruleEntry.operationType === 'rule_update', '规则变更operationType正确');
  assert(ruleEntry.field === 'synonyms', '规则类型为synonyms');
  assert(ruleEntry.operator === 'user', '规则变更operator为user');
  console.log();

  console.log('10. 写入失败不抛出异常（降级处理）');
  const invalidLogger = new OperationLogger({ logDir: 'Z:\\\\nonexistent\\\\path\\\\that\\\\cannot\\\\exist' });
  let noException = true;
  let writeResult = false;
  try {
    writeResult = invalidLogger.log({
      operationType: 'clean',
      tableName: 'test',
      recordId: 'TEST',
      reason: '测试写入失败场景'
    });
  } catch (e) {
    noException = false;
  }
  assert(noException, '写入无效路径不抛出异常');
  assert(writeResult === false, '写入失败返回false');
  console.log();

  console.log('11. DataCleaner集成logger自动记录corrections');
  const integratedLogger = new OperationLogger({ logDir: path.join(testLogDir, 'integrated') });
  const cleaner = createCleaner({ logger: integratedLogger });
  const cleanResult = cleaner.cleanRecord('customer', {
    '客户姓名': '测试集成',
    '联系方式': '137-8888-9999',
    '意向风格': '小清新'
  }, { tableName: 'customer', recordId: 'INTEG001' });
  assert(cleanResult.success === true || cleanResult.corrections.length > 0, '清洗执行完成');
  const integEntries = integratedLogger.query({ recordId: 'INTEG001' });
  assert(integEntries.length >= 1, `清洗后自动记录日志（实际 ${integEntries.length} 条）`);
  console.log();

  console.log('12. setLogger方法可注入自定义logger');
  const customLogger = new OperationLogger({ logDir: path.join(testLogDir, 'custom') });
  const cleaner2 = createCleaner();
  cleaner2.setLogger(customLogger);
  cleaner2.cleanRecord('customer', {
    '客户姓名': '自定义Logger',
    '联系方式': '13600136000'
  }, { tableName: 'customer', recordId: 'CUST001' });
  const customEntries = customLogger.query({ recordId: 'CUST001' });
  assert(customEntries.length >= 1, 'setLogger注入的logger正常工作');
  console.log();

  console.log('=== 测试结果汇总 ===');
  console.log(`通过: ${passed}, 失败: ${failed}`);
  
  cleanupTestDir(testLogDir);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n所有测试通过！✓');
    process.exit(0);
  }
}

runTests();
