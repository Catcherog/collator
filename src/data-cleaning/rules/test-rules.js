const { validateRecord, validateField, validateLogicConsistency } = require('./index');
const schemas = require('../schemas');

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

function assertHasIssue(issues, field, code, testName) {
  const found = issues.some(i => i.field === field && i.code === code);
  assert(found, testName, found ? '' : `Expected field=${field}, code=${code}. Actual: ${JSON.stringify(issues.map(i => i.field + ':' + i.code))}`);
}

function assertIssueStructure(issue, testName) {
  const hasRequiredProps = issue.field !== undefined &&
    issue.code !== undefined &&
    issue.message !== undefined &&
    (issue.severity === 'error' || issue.severity === 'warning') &&
    issue.suggestion !== undefined;
  assert(hasRequiredProps, testName, hasRequiredProps ? '' : `Bad issue structure: ${JSON.stringify(issue)}`);
}

function makePhone(digits) {
  return String(digits);
}

const VALID_PHONE = makePhone(13800138000);
const VALID_PHONE_WITH_SPACES = '138 0013 8000';
const BAD_PHONE = '12345';

console.log('========================================');
console.log('Business Rules Validator Test Suite');
console.log('========================================\n');

console.log('Test 1: Missing required field (phone/contact)');
{
  const data = {
    '客户姓名': 'Zhang San'
  };
  const result = validateRecord('customer', data);
  assert(result.status === 'failed', 'status should be failed', `actual: ${result.status}`);
  assertHasIssue(result.errors, '联系方式', 'REQUIRED_MISSING', 'should report missing contact field');
  assert(result.errors.length > 0, 'errors array should not be empty');
  result.errors.forEach(e => assertIssueStructure(e, 'error structure'));
  console.log('    Summary:', JSON.stringify({ status: result.status, errorCount: result.errors.length, score: result.score }));
}

console.log('\nTest 2: Invalid enum value (intentional style = "nonexistent style")');
{
  const data = {
    '客户姓名': 'Li Si',
    '联系方式': VALID_PHONE,
    '意向风格': ['nonexistent', '日系清新']
  };
  const result = validateRecord('customer', data);
  assert(result.status === 'failed', 'status should be failed (invalid enum)', `actual: ${result.status}`);
  assertHasIssue(result.errors, '意向风格', 'ENUM_MISMATCH', 'should report enum mismatch for style');
  const enumError = result.errors.find(e => e.code === 'ENUM_MISMATCH' && e.field === '意向风格');
  assert(enumError && enumError.message.includes('nonexistent'), 'error message should contain invalid value "nonexistent"');
  console.log('    Summary:', JSON.stringify({ status: result.status, errorCount: result.errors.length, warnings: result.warnings.length }));
}

console.log('\nTest 3: Date conflict (shoot date earlier than consult date)');
{
  const data = {
    '客户姓名': 'Wang Wu',
    '联系方式': '13900139000',
    '咨询时间': '2025-06-20',
    '拍摄日期': '2025-06-15',
    '项目状态': '待拍摄',
    '项目名称': 'Wang Wu-Qinzi-20250615',
    '项目类型': '客片',
    '项目负责人': 'Photographer A'
  };
  const result = validateRecord('customer', data);
  const dateConflictError = result.errors.find(e => e.code === 'DATE_CONFLICT');
  assert(dateConflictError !== undefined, 'should detect date conflict error', `actual errors: ${JSON.stringify(result.errors.map(e => e.code))}`);
  assert(dateConflictError && dateConflictError.severity === 'error', 'date conflict should be error severity');
  assert(result.status === 'failed', 'status should be failed when date conflict exists', `actual: ${result.status}`);
  console.log('    Summary:', JSON.stringify({ status: result.status, dateConflict: dateConflictError ? dateConflictError.message : 'not detected' }));
}

console.log('\nTest 4: Complete valid data -> passed');
{
  const data = {
    '客户姓名': 'Zhao Liu',
    '联系方式': VALID_PHONE,
    '来源渠道': '小红书',
    '咨询时间': '2025-06-01',
    '拍摄类型': '亲子',
    '预算区间': '3000-5000元',
    '意向风格': ['日系清新', '韩系唯美'],
    '跟进记录': 'Client prefers weekend shoot, bright tones'
  };
  const result = validateRecord('customer', data);
  assert(result.status === 'passed', 'status should be passed', `actual: ${result.status}, errors: ${result.errors.length}, warnings: ${result.warnings.length}`);
  assert(result.errors.length === 0, 'errors array should be empty', `errors: ${JSON.stringify(result.errors.map(e => e.code + ':' + e.field))}`);
  assert(result.score >= 80, `data quality score should be high (>=80), actual: ${result.score}`);
  assert(result.sanitizedData !== undefined, 'should return sanitizedData');
  console.log('    Summary:', JSON.stringify({ status: result.status, score: result.score, errors: result.errors.length, warnings: result.warnings.length }));
}

console.log('\nTest 5: Multi-select enum validation (array contains invalid values)');
{
  const data = {
    '客户姓名': 'Sun Qi',
    '联系方式': '13700137000',
    '意向风格': ['日系清新', 'Cyberpunk', '韩系唯美', 'InvalidStyle2']
  };
  const result = validateRecord('customer', data);
  assertHasIssue(result.errors, '意向风格', 'ENUM_MISMATCH', 'should detect invalid values in multi-select');
  const enumError = result.errors.find(e => e.field === '意向风格' && e.code === 'ENUM_MISMATCH');
  assert(enumError && enumError.message.includes('Cyberpunk'), 'error should contain first invalid value "Cyberpunk"');
  assert(enumError && enumError.message.includes('InvalidStyle2'), 'error should contain second invalid value "InvalidStyle2"');
  assert(enumError && enumError.severity === 'error', 'enum mismatch should be error severity');
  console.log('    Summary:', JSON.stringify({ status: result.status, enumError: enumError ? enumError.message : 'not detected' }));
}

console.log('\nTest 6: Validation result format standardization (errors/warnings structure)');
{
  const data = {
    '客户姓名': 'Zhou Ba',
    '联系方式': VALID_PHONE
  };
  const result = validateRecord('customer', data);
  assert(Array.isArray(result.errors), 'errors should be an array');
  assert(Array.isArray(result.warnings), 'warnings should be an array');
  assert(['passed', 'warning', 'failed'].includes(result.status), `status should be passed/warning/failed, actual: ${result.status}`);
  assert(typeof result.score === 'number', 'score should be a number');
  assert(result.sanitizedData !== undefined, 'should include sanitizedData');

  const allIssues = [...result.errors, ...result.warnings];
  allIssues.forEach((issue, idx) => {
    assertIssueStructure(issue, `issue #${idx + 1} structure complete`);
  });

  const errorSeverities = result.errors.map(e => e.severity);
  assert(errorSeverities.every(s => s === 'error'), 'all errors should have severity "error"', `actual: ${errorSeverities.join(',')}`);

  const warningSeverities = result.warnings.map(w => w.severity);
  assert(warningSeverities.every(s => s === 'warning'), 'all warnings should have severity "warning"', `actual: ${warningSeverities.join(',')}`);

  console.log('    Result keys:', Object.keys(result).join(', '));
}

console.log('\nTest 7: Field type validation - string length warning');
{
  const longString = 'A'.repeat(6000);
  const fieldSchema = schemas.getFieldSchema('customer', '客户姓名');
  const fieldResult = validateField(fieldSchema, longString);
  const lengthWarning = fieldResult.warnings.find(w => w.code === 'LENGTH_WARNING');
  assert(lengthWarning !== undefined, 'super long string should produce LENGTH_WARNING');
  assert(lengthWarning && lengthWarning.severity === 'warning', 'length warning should be warning severity');
  console.log('    Result:', fieldResult.warnings.length > 0 ? fieldResult.warnings[0].message.substring(0, 80) + '...' : 'no warnings');
}

console.log('\nTest 8: Field type validation - date format check');
{
  const fieldSchema = schemas.getFieldSchema('customer', '咨询时间');
  const badDateResult = validateField(fieldSchema, 'not-a-date');
  const formatError = badDateResult.errors.find(e => e.code === 'FORMAT_ERROR');
  assert(formatError !== undefined, 'invalid date string should report FORMAT_ERROR');

  const goodDateResult = validateField(fieldSchema, '2025-06-26');
  assert(goodDateResult.errors.length === 0, 'valid YYYY-MM-DD format should have no errors', `errors: ${JSON.stringify(goodDateResult.errors)}`);
  console.log('    Bad date result:', badDateResult.errors.length > 0 ? badDateResult.errors[0].message : 'no error');
  console.log('    Good date result:', goodDateResult.errors.length === 0 ? 'pass' : 'has errors');
}

console.log('\nTest 9: Field type validation - phone format check');
{
  const fieldSchema = schemas.getFieldSchema('customer', '联系方式');
  const badPhoneResult = validateField(fieldSchema, BAD_PHONE);
  assert(badPhoneResult.errors.some(e => e.code === 'FORMAT_ERROR'), 'bad phone number should report FORMAT_ERROR');

  const goodPhoneResult = validateField(fieldSchema, VALID_PHONE_WITH_SPACES);
  assert(goodPhoneResult.errors.length === 0, 'phone with spaces should pass after sanitization', `errors: ${JSON.stringify(goodPhoneResult.errors)}`);
  assert(goodPhoneResult.sanitizedValue === '13800138000', 'phone should be sanitized to pure digits', `actual: ${goodPhoneResult.sanitizedValue}`);
  console.log('    Bad phone:', badPhoneResult.errors.length > 0 ? badPhoneResult.errors[0].message : 'none');
  console.log('    Sanitized phone:', goodPhoneResult.sanitizedValue);
}

console.log('\nTest 10: Logic consistency - deal status requires linked customer');
{
  const data = {
    '项目名称': 'Test Project',
    '客户姓名': '',
    '项目类型': '客片',
    '项目状态': '已归档',
    '拍摄日期': '2025-07-01',
    '项目负责人': 'Photographer A'
  };
  const logicResult = validateLogicConsistency(data, 'project');
  const missingRelation = logicResult.errors.find(e => e.code === 'MISSING_RELATION');
  assert(missingRelation !== undefined, 'archived status without customer should report MISSING_RELATION');
  assert(missingRelation && missingRelation.severity === 'error', 'missing customer relation should be error severity');
  console.log('    Result:', missingRelation ? missingRelation.message : 'not detected');
}

console.log('\nTest 11: Valid project data -> passed');
{
  const data = {
    '项目名称': 'Ms Zhang-Qinzi-20250701',
    '客户姓名': 'Ms Zhang',
    '项目类型': '客片',
    '项目状态': '待拍摄',
    '拍摄日期': '2025-07-01',
    '拍摄地点': 'Indoor Studio',
    '拍摄风格': '日系清新',
    '项目负责人': 'Photographer A'
  };
  const result = validateRecord('project', data);
  assert(result.status === 'passed', 'valid project data should have status passed', `actual: ${result.status}, errors: ${result.errors.length}`);
  console.log('    Summary:', JSON.stringify({ status: result.status, score: result.score, errors: result.errors.length }));
}

console.log('\n========================================');
console.log('Test Results Summary');
console.log('========================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\nFailure details:');
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.testName}`);
    if (f.details) console.log(`     ${f.details}`);
  });
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
