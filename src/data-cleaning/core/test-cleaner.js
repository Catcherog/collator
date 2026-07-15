const { createCleaner } = require('./index');
const utils = require('../utils');

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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function runTests() {
  console.log('=== 数据清洗引擎测试 ===\n');
  const cleaner = createCleaner();

  console.log('1. 手机号格式化测试');
  const phoneResult = cleaner.cleanRecord('customer', {
    '客户姓名': '张三',
    '联系方式': '137-6666-8888'
  });
  assert(phoneResult.success === true, '手机号清洗成功');
  assert(phoneResult.data['联系方式'] === '13766668888', `手机号格式化：期望 "13766668888"，实际 "${phoneResult.data['联系方式']}"`);
  const phoneCorrection = phoneResult.corrections.find(c => c.field === '联系方式');
  assert(phoneCorrection !== undefined, '有格式化修正记录');
  assert(phoneCorrection.reason === '格式清洗', '修正原因为格式清洗');
  console.log();

  console.log('2. 枚举同义词映射测试（意向风格: 小清新 → 日系清新）');
  const styleResult = cleaner.cleanRecord('customer', {
    '客户姓名': '李四',
    '联系方式': '13800138000',
    '意向风格': '小清新'
  });
  assert(styleResult.success === true, '风格映射清洗成功');
  assert(styleResult.data['意向风格'] === '日系清新', `风格映射：期望 "日系清新"，实际 "${styleResult.data['意向风格']}"`);
  const styleCorrection = styleResult.corrections.find(c => c.field === '意向风格');
  assert(styleCorrection !== undefined, '有枚举映射修正记录');
  assert(styleCorrection.confidence >= 0.85, `映射置信度 >= 0.85（实际 ${styleCorrection.confidence}）`);
  assert(styleCorrection.source !== undefined, '记录了映射来源');
  console.log();

  console.log('3. 日期解析测试（咨询时间: 今天 → YYYY-MM-DD）');
  const today = formatDate(new Date());
  const dateResult = cleaner.cleanRecord('customer', {
    '客户姓名': '王五',
    '联系方式': '13900139000',
    '咨询时间': '今天'
  });
  assert(dateResult.success === true, '日期解析清洗成功');
  assert(dateResult.data['咨询时间'] === today, `日期解析：期望 "${today}"，实际 "${dateResult.data['咨询时间']}"`);
  const dateCorrection = dateResult.corrections.find(c => c.field === '咨询时间');
  assert(dateCorrection !== undefined, '有日期解析修正记录');
  console.log();

  console.log('4. 预算金额归一化测试（预算区间: 2000多 → 2000-3000元）');
  const budgetResult = cleaner.cleanRecord('customer', {
    '客户姓名': '赵六',
    '联系方式': '13600136000',
    '预算区间': '2000多'
  });
  assert(budgetResult.success === true, '预算归一化清洗成功');
  assert(budgetResult.data['预算区间'] === '2000-3000元', `预算归一化：期望 "2000-3000元"，实际 "${budgetResult.data['预算区间']}"`);
  const budgetCorrection = budgetResult.corrections.find(c => c.field === '预算区间');
  assert(budgetCorrection !== undefined, '有预算归一化修正记录');
  console.log();

  console.log('5. 必填字段缺失测试（缺少联系方式）');
  const missingResult = cleaner.cleanRecord('customer', {
    '客户姓名': '孙七'
  });
  assert(missingResult.success === false, '缺失必填字段返回失败');
  assert(missingResult.missingFields.includes('联系方式'), 'missingFields包含联系方式');
  assert(missingResult.errors.some(e => e.includes('联系方式')), 'errors中包含联系方式缺失提示');
  console.log();

  console.log('6. 异常容错测试（传入非字符串异常值）');
  const abnormalResult = cleaner.cleanRecord('customer', {
    '客户姓名': '周八',
    '联系方式': 13500135000,
    '意向风格': null,
    '来源渠道': undefined,
    '跟进记录': { invalid: 'object' }
  });
  let noCrash = true;
  try {
    assert(abnormalResult !== undefined, '异常输入不崩溃');
    assert(abnormalResult.data !== undefined, '返回结果包含data');
    assert(abnormalResult.warnings !== undefined, '异常输入有warnings记录');
  } catch (e) {
    noCrash = false;
  }
  assert(noCrash, '异常值处理不中断流程');
  console.log();

  console.log('7. 空值处理测试（可选字段空值不报错）');
  const emptyResult = cleaner.cleanRecord('customer', {
    '客户姓名': '吴九',
    '联系方式': '13400134000',
    '来源渠道': '',
    '预算区间': null,
    '意向风格': undefined
  });
  assert(emptyResult.success === true, '可选字段空值清洗成功');
  assert(emptyResult.errors.length === 0 || emptyResult.errors.every(e => !e.includes('来源渠道') && !e.includes('预算区间')), '可选空值不产生必填错误');
  console.log();

  console.log('8. 性能测试（单条记录 < 10ms）');
  const perfTestData = {
    '客户姓名': '郑十',
    '联系方式': '133-0013-3000',
    '意向风格': '小清新',
    '咨询时间': '明天',
    '预算区间': '3k多'
  };
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    cleaner.cleanRecord('customer', perfTestData);
  }
  const elapsed = Date.now() - start;
  const avgMs = elapsed / 100;
  assert(avgMs < 10, `平均处理时间 ${avgMs.toFixed(2)}ms < 10ms`);
  console.log();

  console.log('9. 向后兼容测试（原有API可用）');
  const compatResult = cleaner.cleanRecord('customer', {
    '客户姓名': '测试用户',
    '联系方式': '13200132000'
  });
  assert(compatResult.hasOwnProperty('success'), '返回success字段');
  assert(compatResult.hasOwnProperty('data'), '返回data字段');
  assert(compatResult.hasOwnProperty('errors'), '返回errors字段');
  assert(compatResult.hasOwnProperty('warnings'), '返回warnings字段');
  assert(compatResult.hasOwnProperty('corrections'), '返回corrections字段');
  assert(compatResult.hasOwnProperty('missingFields'), '返回missingFields字段');
  console.log();

  console.log('10. 多选枚举字段测试（数组支持）');
  const multiResult = cleaner.cleanRecord('customer', {
    '客户姓名': '多选测试',
    '联系方式': '13100131000',
    '意向风格': ['小清新', '韩系']
  });
  assert(multiResult.success === true || multiResult.errors.every(e => !e.includes('意向风格')), '多选字段处理正常');
  console.log();

  console.log('11. 去重算法专项测试（bigram Jaccard 相似度）');
  // 核心修复点：'ab' 与 'ba' 顺序不同应低相似度
  const simAB = cleaner.calculateStringSimilarity('ab', 'ba');
  assert(simAB < 0.5, `'ab' 与 'ba' 相似度 < 0.5（实际 ${simAB}）`);

  // 中文场景：'张三' 与 '三张' 顺序不同应低相似度
  const simZH = cleaner.calculateStringSimilarity('张三', '三张');
  assert(simZH < 0.5, `'张三' 与 '三张' 相似度 < 0.5（实际 ${simZH}）`);

  // 完全相同返回 1.0
  const simSame = cleaner.calculateStringSimilarity('hello', 'hello');
  assert(simSame === 1, `'hello' 与 'hello' 返回 1.0（实际 ${simSame}）`);

  // 包含关系返回 0.9
  const simInclude = cleaner.calculateStringSimilarity('hello', 'hell');
  assert(simInclude === 0.9, `'hello' 与 'hell' 返回 0.9（包含关系，实际 ${simInclude}）`);

  // 空字符串返回 0
  const simEmpty1 = cleaner.calculateStringSimilarity('', 'abc');
  assert(simEmpty1 === 0, `空字符串与 'abc' 返回 0（实际 ${simEmpty1}）`);
  const simEmpty2 = cleaner.calculateStringSimilarity('abc', '');
  assert(simEmpty2 === 0, `'abc' 与空字符串返回 0（实际 ${simEmpty2}）`);

  // 短字符串（长度<2）退化逻辑
  const simShortSame = cleaner.calculateStringSimilarity('a', 'a');
  assert(simShortSame === 1, `'a' 与 'a' 短字符串完全相同返回 1.0（实际 ${simShortSame}）`);
  const simShortDiff = cleaner.calculateStringSimilarity('a', 'b');
  assert(simShortDiff === 0, `'a' 与 'b' 短字符串完全不同返回 0（实际 ${simShortDiff}）`);

  // 'abc' 与 'abd' 相似度约 0.33（bigram 集合：{'ab','bc'} 与 {'ab','bd'}，交集1，并集3）
  const simABD = cleaner.calculateStringSimilarity('abc', 'abd');
  assert(Math.abs(simABD - 1 / 3) < 0.01, `'abc' 与 'abd' 相似度约 0.33（实际 ${simABD.toFixed(4)}）`);
  console.log();

  console.log('=== 测试结果汇总 ===');
  console.log(`通过: ${passed}, 失败: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n所有测试通过！✓');
    process.exit(0);
  }
}

runTests();
