const { createQualityScorer } = require('./quality-scorer');
const rules = require('../rules');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, details) {
  if (condition) {
    passed++;
    console.log(`  OK ${testName}`);
  } else {
    failed++;
    failures.push({ testName, details });
    console.log(`  FAIL ${testName}`);
    if (details) console.log(`       ${details}`);
  }
}

function assertScoreRange(actual, min, max, testName) {
  assert(actual >= min && actual <= max, testName, `Expected score in [${min}, ${max}], actual: ${actual}`);
}

console.log('========================================');
console.log('Data Quality Scorer Test Suite');
console.log('========================================\n');

const scorer = createQualityScorer();

console.log('Test 1: Complete valid data -> score >= 90, grade = 优秀');
{
  const validData = {
    '客户姓名': 'Zhang San',
    '联系方式': '13800138000',
    '来源渠道': '小红书',
    '咨询时间': '2025-06-01',
    '拍摄类型': '亲子',
    '预算区间': '3000-5000元',
    '意向风格': ['日系清新']
  };
  const validationResult = rules.validateRecord('customer', validData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);
  
  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);
  
  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade, deductions: result.deductions.length }));
  
  assertScoreRange(result.score, 90, 100, 'score should be >= 90');
  assert(result.grade === '优秀', `grade should be 优秀, actual: ${result.grade}`);
  assert(Array.isArray(result.deductions), 'deductions should be array');
  assert(Array.isArray(result.suggestions), 'suggestions should be array');
  assert(typeof result.summary === 'string' && result.summary.length > 0, 'summary should be non-empty string');
  assert(result.summary.includes('优秀'), 'summary should mention 优秀');
}

console.log('\nTest 2: Invalid phone + invalid enum + 1 required field missing -> score 35-50 (fillRate=0.5 discount applied)');
{
  const badData = {
    '联系方式': '12345',
    '来源渠道': 'invalid_channel',
    '咨询时间': '2025-06-01'
  };
  const validationResult = rules.validateRecord('customer', badData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);
  console.log('    Errors:', validationResult.errors.map(e => `${e.field}:${e.code}`).join(', '));

  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);

  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade, deductions: result.deductions.length }));
  console.log('    Deductions:', result.deductions.map(d => `${d.field}(${d.points}分): ${d.reason.substring(0, 30)}`).join('; '));

  assertScoreRange(result.score, 35, 50, `score should be in 35-50 range (fillRate=0.5 discount applied), actual: ${result.score}`);
  assert(result.grade === '中等' || result.grade === '较差', `grade should be 中等 or 较差, actual: ${result.grade}`);
  assert(result.deductions.length >= 3, `should have at least 3 deductions, actual: ${result.deductions.length}`);
  
  const hasRequiredMissing = result.deductions.some(d => d.reason.includes('必填') || d.reason.includes('缺少') || d.field === '客户姓名');
  assert(hasRequiredMissing, 'should have deduction for missing required field (客户姓名)');
  
  const hasPhoneError = result.deductions.some(d => d.field === '联系方式');
  assert(hasPhoneError, 'should have deduction for phone format error');
  
  const hasEnumError = result.deductions.some(d => d.field === '来源渠道');
  assert(hasEnumError, 'should have deduction for enum error');
}

console.log('\nTest 3: Missing all required fields -> score near 0');
{
  const emptyData = {};
  const validationResult = rules.validateRecord('customer', emptyData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);
  
  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);
  
  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade, deductions: result.deductions.length }));
  console.log('    Deduction fields:', result.deductions.map(d => d.field).join(', '));
  
  assert(result.score <= 20, `score should be <= 20 for all missing required, actual: ${result.score}`);
  assert(result.grade === '较差', `grade should be 较差, actual: ${result.grade}`);
  assert(result.deductions.length >= 2, 'should have deductions for missing required fields');
  
  const requiredFields = ['客户姓名', '联系方式'];
  for (const field of requiredFields) {
    const found = result.deductions.some(d => d.field === field);
    assert(found, `should have deduction for ${field}`);
  }
}

console.log('\nTest 4: Deductions map to specific fields and issues');
{
  const mixedData = {
    '客户姓名': 'Wang Wu',
    '联系方式': 'not-a-phone',
    '来源渠道': '抖音',
    '拍摄类型': 'invalid_type'
  };
  const validationResult = rules.validateRecord('customer', mixedData);
  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);
  
  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade }));
  
  for (const deduction of result.deductions) {
    assert(typeof deduction.field === 'string' && deduction.field.length > 0, `deduction should have field, got: ${JSON.stringify(deduction)}`);
    assert(typeof deduction.reason === 'string' && deduction.reason.length > 0, `deduction should have reason`);
    assert(typeof deduction.points === 'number' && deduction.points > 0, `deduction should have positive points, got: ${deduction.points}`);
    assert(deduction.points <= 40, `single deduction should not exceed 40 points, got: ${deduction.points}`);
  }
  
  const phoneDeduction = result.deductions.find(d => d.field === '联系方式');
  assert(phoneDeduction !== undefined, 'should have deduction for 联系方式');
  assert(phoneDeduction.reason.includes('格式') || phoneDeduction.reason.includes('手机'), 'phone deduction reason should mention format issue');
}

console.log('\nTest 5: Every deduction has improvement suggestion');
{
  const problemData = {
    '客户姓名': 'Test User',
    '联系方式': 'badphone',
    '来源渠道': 'wrong_channel',
    '预算区间': 'bad_budget',
    '意向风格': ['bad_style']
  };
  const validationResult = rules.validateRecord('customer', problemData);
  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);
  
  console.log('    Number of deductions:', result.deductions.length);
  console.log('    Number of suggestions:', result.suggestions.length);
  
  assert(result.deductions.length > 0, 'should have deductions');
  
  let allHaveSuggestions = true;
  const missingSuggestions = [];
  for (const d of result.deductions) {
    if (!d.suggestion || d.suggestion.length === 0) {
      allHaveSuggestions = false;
      missingSuggestions.push(d.field || 'unknown');
    }
  }
  assert(allHaveSuggestions, `all deductions should have suggestions, missing: ${missingSuggestions.join(', ')}`);
  
  assert(result.suggestions.length > 0, 'should have aggregated suggestions list');
  assert(result.suggestions.length <= result.deductions.length, 'suggestions count should not exceed deductions count');
}

console.log('\nTest 6: Score should never be negative or exceed 100');
{
  const veryBadData = {
    '联系方式': 'x',
    '来源渠道': 'x',
    '拍摄类型': 'x',
    '预算区间': 'x',
    '意向风格': ['x', 'y', 'z']
  };
  const validationResult = rules.validateRecord('customer', veryBadData);
  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);
  
  assert(result.score >= 0, `score should be >= 0, actual: ${result.score}`);
  assert(result.score <= 100, `score should be <= 100, actual: ${result.score}`);
}

console.log('\nTest 7: Custom weights should work');
{
  const customScorer = createQualityScorer({
    requiredFieldsComplete: 50,
    formatValid: 20,
    enumValid: 15,
    logicConsistent: 10,
    confidenceWeighted: 5
  });
  
  const emptyData = {};
  const validationResult = rules.validateRecord('customer', emptyData);
  const result = customScorer.score('customer', validationResult.sanitizedData, validationResult);
  
  assert(result.score >= 0 && result.score <= 100, `custom weighted score should be valid, actual: ${result.score}`);
  assert(result.grade === '较差', 'missing all required with 50% required weight should be 较差');
}

console.log('\nTest 8: Discount mechanism - fillRate=1.0 with no errors -> score near 100');
{
  const fullRequiredData = {
    '客户姓名': 'Zhang San',
    '联系方式': '13800138000'
  };
  const validationResult = rules.validateRecord('customer', fullRequiredData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);

  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);

  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade }));

  assertScoreRange(result.score, 90, 100, `fillRate=1.0 score should be near 100, actual: ${result.score}`);
}

console.log('\nTest 9: Discount mechanism - fillRate=0.5 with no other errors -> score ~50 (not 80)');
{
  const halfRequiredData = {
    '客户姓名': 'Zhang San'
  };
  const validationResult = rules.validateRecord('customer', halfRequiredData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);
  console.log('    Errors:', validationResult.errors.map(e => `${e.field}:${e.code}`).join(', '));

  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);

  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade }));
  console.log('    Deductions:', result.deductions.map(d => `${d.field}(${d.points}分)`).join('; '));

  assertScoreRange(result.score, 45, 60, `fillRate=0.5 score should be ~50 (not 80), actual: ${result.score}`);
  assert(result.score < 70, `fillRate=0.5 score should be < 70 (discount applied, not 80), actual: ${result.score}`);
}

console.log('\nTest 10: Discount mechanism - fillRate=0.0 -> score <= 10');
{
  const emptyData = {};
  const validationResult = rules.validateRecord('customer', emptyData);
  console.log('    Validation status:', validationResult.status);
  console.log('    Validation errors:', validationResult.errors.length, 'warnings:', validationResult.warnings.length);

  const result = scorer.score('customer', validationResult.sanitizedData, validationResult);

  console.log('    Quality result:', JSON.stringify({ score: result.score, grade: result.grade }));

  assert(result.score <= 10, `fillRate=0.0 score should be <= 10, actual: ${result.score}`);
}

console.log('\n========================================');
console.log('Test Summary');
console.log('========================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => {
    console.log(`  - ${f.testName}`);
    if (f.details) console.log(`    ${f.details}`);
  });
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
