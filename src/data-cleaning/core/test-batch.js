const { createBatchProcessor } = require('./batch-processor');

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

function generateTestData() {
  const records = [];

  for (let i = 0; i < 8; i++) {
    records.push({
      '客户姓名': `合格客户${i + 1}`,
      '联系方式': `138${String(10000000 + i).padStart(8, '0')}`,
      '来源渠道': '小红书',
      '预算区间': '2000-3000元',
      '意向风格': ['日系清新'],
      '咨询时间': '2026-06-26'
    });
  }

  for (let i = 0; i < 6; i++) {
    records.push({
      '客户姓名': `警告客户${i + 1}`,
      '联系方式': `139${String(20000000 + i).padStart(8, '0')}`,
      '来源渠道': '抖音',
      '预算区间': '2000多',
      '意向风格': ['小清新', '暗调情绪'],
      '拍摄类型': '亲子',
      '咨询时间': '今天'
    });
  }

  for (let i = 0; i < 4; i++) {
    records.push({
      '客户姓名': `错误客户${i + 1}`,
      '联系方式': 'not-a-phone',
      '来源渠道': '未知渠道',
      '预算区间': '无效预算',
      '意向风格': ['欧美街头风'],
      '咨询时间': '2026-13-45'
    });
  }

  records.push({
    '客户姓名': '无手机客户',
    '来源渠道': '线下'
  });

  records.push({
    '客户姓名': '日期冲突客户',
    '联系方式': '13700000001',
    '拍摄日期': '2026-06-01',
    '咨询时间': '2026-06-15'
  });

  return records;
}

async function runTests() {
  console.log('=== 批量处理与质量报告模块测试 ===\n');

  const processor = createBatchProcessor();
  const testData = generateTestData();

  console.log(`测试数据: ${testData.length}条混合记录（8条合格，6条带警告，6条错误）\n`);

  console.log('1. 批量处理基础测试');
  let progressCalls = 0;
  const result = await processor.processBatch('customer', testData, {
    batchSize: 5,
    onProgress: (info) => {
      progressCalls++;
    }
  });

  assert(result.batchId && result.batchId.startsWith('batch_'), `生成唯一批次ID: ${result.batchId}`);
  assert(result.schemaKey === 'customer', 'schemaKey正确');
  assert(result.processedAt !== undefined, '有处理时间戳');
  assert(result.totalRecords === 20, `总记录数正确: ${result.totalRecords}`);
  assert(result.results.length === 20, `结果数组长度正确: ${result.results.length}`);
  assert(progressCalls === 20, `进度回调调用次数正确: ${progressCalls}次`);
  console.log();

  console.log('2. 统计数据正确性测试');
  const { passed: passedCount, withWarnings, failed: failedCount, passRate, averageScore, issueByField, issueByType, correctionsCount } = result.summary;
  const total = passedCount + withWarnings + failedCount;

  assert(total === 20, `统计总和正确: passed(${passedCount}) + withWarnings(${withWarnings}) + failed(${failedCount}) = ${total}`);
  assert(passRate >= 0 && passRate <= 100, `通过率在0-100之间: ${passRate}%`);
  assert(typeof passRate === 'number', '通过率是数字类型');
  assert(averageScore >= 0 && averageScore <= 100, `平均分在0-100之间: ${averageScore}`);
  assert(correctionsCount >= 0, `自动修正次数非负: ${correctionsCount}`);
  assert(passedCount > 0, '有通过记录');
  assert(withWarnings >= 0, '警告记录数非负');
  assert(failedCount > 0, '有失败记录');
  console.log();

  console.log('3. 问题分布统计测试');
  assert(Object.keys(issueByField).length > 0, '有问题字段统计');
  assert(Object.keys(issueByType).length > 0, '有问题类型统计');
  const fieldIssueSum = Object.values(issueByField).reduce((a, b) => a + b, 0);
  const typeIssueSum = Object.values(issueByType).reduce((a, b) => a + b, 0);
  assert(fieldIssueSum > 0, `字段问题累计次数正确: ${fieldIssueSum}`);
  assert(typeIssueSum > 0, `类型问题累计次数正确: ${typeIssueSum}`);
  console.log();

  console.log('4. 单条记录结果结构测试');
  const firstResult = result.results[0];
  assert(firstResult.index === 0, '第一条记录索引正确');
  assert(firstResult.data !== undefined, '包含清洗后数据');
  assert(firstResult.originalData !== undefined, '包含原始数据');
  assert(firstResult.validation !== undefined, '包含验证结果');
  assert(firstResult.quality !== undefined, '包含质量评分');
  assert(firstResult.corrections !== undefined, '包含修正记录');
  assert(['passed', 'warning', 'failed'].includes(firstResult.status), '状态值合法');
  assert(typeof firstResult.quality.score === 'number', '质量分是数字');
  assert(['优秀', '良好', '中等', '较差'].includes(firstResult.quality.grade), '质量等级合法');
  console.log();

  console.log('5. 质量报告生成测试');
  const report = processor.generateReport(result, 'text');
  assert(typeof report === 'string', '报告是字符串类型');
  assert(report.length > 100, `报告长度合理: ${report.length}字符`);
  assert(report.includes('📦 **批量导入预览**'), '报告包含标题');
  assert(report.includes('总记录数: 20条'), '报告包含总条数');
  assert(report.includes('✅ **验证通过**'), '报告包含通过统计');
  assert(report.includes('⚠️ **需要确认**'), '报告包含警告统计');
  assert(report.includes('❌ **无法处理**'), '报告包含失败统计');
  assert(report.includes(`${passRate}%`), `报告包含通过率: ${passRate}%`);
  assert(report.includes('质量等级分布'), '报告包含质量等级分布');
  assert(report.includes('优秀'), '报告包含优秀等级');
  assert(report.includes('问题字段统计'), '报告包含问题字段统计');
  assert(report.includes('问题类型统计'), '报告包含问题类型统计');
  console.log();

  console.log('6. getWritableRecords 测试');
  const writableOnlyPassed = processor.getWritableRecords(result, false);
  assert(writableOnlyPassed.length === passedCount, `仅passed时可写入数正确: ${writableOnlyPassed.length} = ${passedCount}`);
  assert(writableOnlyPassed.every(r => r.status === 'passed'), '所有可写入记录都是passed状态');

  const writableWithWarnings = processor.getWritableRecords(result, true);
  assert(writableWithWarnings.length === passedCount + withWarnings, `包含warnings时可写入数正确: ${writableWithWarnings.length} = ${passedCount + withWarnings}`);
  assert(writableWithWarnings.every(r => r.status === 'passed' || r.status === 'warning'), '可写入记录只有passed/warning');
  console.log();

  console.log('7. getFailedRecords 测试');
  const failedRecords = processor.getFailedRecords(result);
  assert(failedRecords.length === failedCount, `失败记录数正确: ${failedRecords.length} = ${failedCount}`);
  assert(failedRecords.every(r => r.errors && r.errors.length > 0), '失败记录都有错误信息');
  assert(failedRecords.every(r => r.data !== undefined), '失败记录包含原始数据');
  console.log();

  console.log('8. partitionForWriting 分批测试');
  const partition = processor.partitionForWriting(result, false, 200);
  assert(partition.totalWritable === writableOnlyPassed.length, `可写入总数一致: ${partition.totalWritable}`);
  assert(partition.chunks.length >= 1, '至少有一个分批');
  assert(partition.chunkSize <= 200, `分批大小≤200: ${partition.chunkSize}`);

  let totalInChunks = 0;
  for (const chunk of partition.chunks) {
    assert(chunk.length <= 200, `单批大小≤200: ${chunk.length}`);
    totalInChunks += chunk.length;
  }
  assert(totalInChunks === partition.totalWritable, `分批总和等于总数: ${totalInChunks} = ${partition.totalWritable}`);

  const partitionWithWarnings = processor.partitionForWriting(result, true, 200);
  totalInChunks = 0;
  for (const chunk of partitionWithWarnings.chunks) {
    totalInChunks += chunk.length;
  }
  assert(totalInChunks === passedCount + withWarnings, `含warnings时分批总和正确: ${totalInChunks}`);
  console.log();

  console.log('9. 分批大小边界测试（小batchSize验证分批逻辑）');
  const smallPartition = processor.partitionForWriting(result, true, 3);
  assert(smallPartition.chunkSize === 3, `自定义分批大小正确: ${smallPartition.chunkSize}`);
  for (const chunk of smallPartition.chunks) {
    assert(chunk.length <= 3, `小批量分批大小≤3: ${chunk.length}`);
  }
  console.log();

  console.log('10. 异常格式报告测试');
  let formatError = false;
  try {
    processor.generateReport(result, 'json');
  } catch (e) {
    formatError = true;
  }
  assert(formatError, '不支持的格式抛出异常');
  console.log();

  console.log('=== 测试报告预览 ===\n');
  console.log(report);

  console.log('\n=== 测试结果汇总 ===');
  console.log(`通过: ${passed}, 失败: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n所有测试通过！✓');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('测试执行出错:', err);
  process.exit(1);
});
