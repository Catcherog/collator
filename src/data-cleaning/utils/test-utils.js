const utils = require('./index');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, actual, expected) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    failures.push({ testName, actual, expected });
    console.log(`  ✗ FAIL: ${testName}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
  }
}

function formatToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const styleSynonyms = {
  '日系清新': ['小清新', '清新', '日系', '文艺', '自然'],
  '复古胶片': ['复古', '胶片', '港风', '怀旧', '颗粒感'],
  '韩式简约': ['韩系', '简约', '唯美', '清新淡雅'],
  '欧美时尚': ['欧美', '时尚', '大片', '高级感', '杂志风'],
  '古风汉服': ['古风', '汉服', '中国风', '古装', '国风'],
};

console.log('\n========== 测试工具函数 ==========\n');

console.log('1. sanitizePhone 测试:');
assert(utils.sanitizePhone('137-6666-8888') === '13766668888', 'sanitizePhone("137-6666-8888") === "13766668888"', utils.sanitizePhone('137-6666-8888'), '13766668888');
assert(utils.sanitizePhone('138 1234 5678') === '13812345678', 'sanitizePhone("138 1234 5678") === "13812345678"', utils.sanitizePhone('138 1234 5678'), '13812345678');

console.log('\n2. isValidPhone 测试:');
assert(utils.isValidPhone('13812345678') === true, 'isValidPhone("13812345678") === true', utils.isValidPhone('13812345678'), true);
assert(utils.isValidPhone('12345') === false, 'isValidPhone("12345") === false', utils.isValidPhone('12345'), false);

console.log('\n3. parseDate 测试:');
const todayExpected = formatToday();
const todayResult = utils.parseDate('今天');
assert(todayResult === todayExpected, 'parseDate("今天") === 今天的日期', todayResult, todayExpected);

console.log('\n4. normalizeBudget 测试:');
const budgetResult1 = utils.normalizeBudget('2000多');
assert(budgetResult1.interval === '2000-3000元', 'normalizeBudget("2000多").interval === "2000-3000元"', budgetResult1.interval, '2000-3000元');
const budgetResult2 = utils.normalizeBudget('两三千');
assert(budgetResult2.interval === '2000-3000元', 'normalizeBudget("两三千").interval === "2000-3000元"', budgetResult2.interval, '2000-3000元');

console.log('\n5. findMatchingStyle 测试:');
const styleResult = utils.findMatchingStyle('小清新', styleSynonyms);
assert(styleResult && styleResult.style === '日系清新', 'findMatchingStyle("小清新", styleSynonyms).style === "日系清新"', styleResult ? styleResult.style : null, '日系清新');

console.log('\n6. toHalfWidth 测试:');
assert(utils.toHalfWidth('１３８') === '138', 'toHalfWidth("１３８") === "138"', utils.toHalfWidth('１３８'), '138');

console.log('\n7. 额外测试 - sanitizeText 增强:');
assert(utils.sanitizeText('  你好   世界  ') === '你好 世界', 'sanitizeText 合并连续空格', utils.sanitizeText('  你好   世界  '), '你好 世界');

console.log('\n8. 额外测试 - parseDate 更多场景:');
assert(utils.parseDate('2026-06-26') === '2026-06-26', 'parseDate 标准格式直接返回', utils.parseDate('2026-06-26'), '2026-06-26');
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowExpected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
assert(utils.parseDate('明天') === tomorrowExpected, 'parseDate("明天") 正确', utils.parseDate('明天'), tomorrowExpected);

console.log('\n9. 额外测试 - createLogger:');
const logger = utils.createLogger('TEST');
console.log('  (以下是日志输出测试，可以看到带时间戳的日志):');
logger.info('这是一条信息日志', { key: 'value' });
logger.warn('这是一条警告日志');
logger.error('这是一条错误日志');
assert(typeof logger.info === 'function' && typeof logger.warn === 'function' && typeof logger.error === 'function', 'createLogger 返回三个方法', true, true);

console.log('\n========== 测试结果汇总 ==========\n');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);

if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach((f, i) => {
    console.log(`\n${i + 1}. ${f.testName}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ 所有测试通过!');
  process.exit(0);
}
