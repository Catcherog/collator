/**
 * 数据清洗引擎基准测试运行器
 *
 * 用法：
 *   node src/data-cleaning/benchmark/run-benchmark.js
 *
 * 输出：
 *   docs/reports/benchmark_YYYYMMDD_HHmmss.md
 */

const fs = require('fs');
const path = require('path');
const dc = require('../index');
const metrics = require('./metrics');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const REPORT_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'reports');

const FIXTURE_FILES = [
  'customer-cases.json',
  'project-cases.json',
  'product-cases.json',
  'resource-cases.json',
  'chat-cases.json',
  'batch-cases.json'
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFixtures() {
  const allCases = [];
  for (const file of FIXTURE_FILES) {
    const filePath = path.join(FIXTURE_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ 测试用例文件不存在：${filePath}`);
      continue;
    }
    const cases = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const c of cases) {
      c.fixtureFile = file;
    }
    allCases.push(...cases);
  }
  return allCases;
}

function formatTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatDateTime() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function runBenchmark() {
  console.log('=== 数据清洗引擎基准测试 ===\n');

  dc.init();
  const cleaner = dc.createCleaner();
  const scorer = dc.createQualityScorer();

  const cases = loadFixtures();
  console.log(`已加载 ${cases.length} 个测试用例\n`);

  let passed = 0;
  let failed = 0;
  let fieldCorrectTotal = 0;
  let fieldTotalTotal = 0;

  for (const testCase of cases) {
    const { id, schemaKey, input, expected, description } = testCase;

    const cleanResult = cleaner.cleanRecord(schemaKey, input, { recordId: id });
    const validationResult = dc.validateRecord(schemaKey, cleanResult.data);
    const scoreResult = scorer.score(schemaKey, cleanResult.data, validationResult);

    const fieldAccuracy = metrics.computeFieldAccuracy(expected.cleanedData, cleanResult.data);
    const correctionsAccuracy = metrics.computeCorrectionsAccuracy(expected.expectedCorrections, cleanResult.corrections);
    const statusMatch = metrics.computeStatusMatch(
      expected.expectedStatus,
      cleanResult.success,
      expected.expectedErrorCodes,
      cleanResult.errors
    );
    const scoreOk = metrics.scoreWithinRange(scoreResult.score, expected.minScore);

    // 失效点2 修复：将 codesMatched 纳入 casePassed 判断（BENCH-004）
    const casePassed = metrics.computeCasePassed(statusMatch, scoreOk, expected.expectedErrorCodes);
    if (casePassed) {
      passed++;
      console.log(`  ✓ ${id}: ${description}`);
    } else {
      failed++;
      console.log(`  ✗ ${id}: ${description}`);
      if (!statusMatch.statusMatched) {
        console.log(`    状态不匹配：期望 ${expected.expectedStatus}，实际 ${statusMatch.actualStatus}`);
      }
      if (!scoreOk) {
        console.log(`    质量分未达标：期望 ≥ ${expected.minScore - 5}，实际 ${scoreResult.score}`);
      }
    }

    fieldCorrectTotal += fieldAccuracy.correct;
    fieldTotalTotal += fieldAccuracy.total;

    testCase.result = {
      actualSuccess: cleanResult.success,
      actualData: cleanResult.data,
      actualErrors: cleanResult.errors,
      actualWarnings: cleanResult.warnings,
      actualCorrections: cleanResult.corrections,
      actualScore: scoreResult.score,
      fieldAccuracy,
      correctionsAccuracy,
      statusMatch,
      scoreOk,
      casePassed
    };
  }

  const synonymRecall = metrics.computeSynonymRecall(cases);
  const requiredInterception = metrics.computeRequiredInterception(cases);
  const fieldAccuracyRate = metrics.accuracy(fieldCorrectTotal, fieldTotalTotal);
  const endToEndPassRate = metrics.accuracy(passed, cases.length);

  const summary = {
    totalCases: cases.length,
    passed,
    failed,
    fieldAccuracyRate,
    synonymRecallRate: synonymRecall.rate,
    requiredInterceptionRate: requiredInterception.rate,
    endToEndPassRate,
    fieldCorrectTotal,
    fieldTotalTotal,
    synonymRecallCorrect: synonymRecall.correct,
    synonymRecallTotal: synonymRecall.total,
    requiredInterceptionCorrect: requiredInterception.correct,
    requiredInterceptionTotal: requiredInterception.total
  };

  const reportPath = path.join(REPORT_DIR, `benchmark_${formatTimestamp()}.md`);
  ensureDir(REPORT_DIR);
  const report = generateReport(summary, cases);
  fs.writeFileSync(reportPath, report, 'utf-8');

  console.log('\n' + '='.repeat(50));
  console.log(`基准测试完成`);
  console.log(`  总用例数：${cases.length}`);
  console.log(`  通过：${passed}`);
  console.log(`  失败：${failed}`);
  console.log(`  字段清洗准确率：${fieldAccuracyRate}%`);
  console.log(`  同义词映射召回率：${synonymRecall.rate}%`);
  console.log(`  必填字段拦截率：${requiredInterception.rate}%`);
  console.log(`  端到端通过率：${endToEndPassRate}%`);
  console.log(`  报告已生成：${reportPath}`);

  const criteria = {
    fieldAccuracy: fieldAccuracyRate >= 95,
    synonymRecall: synonymRecall.rate >= 90,
    requiredInterception: requiredInterception.rate >= 95,
    endToEndPass: endToEndPassRate >= 95
  };

  if (!Object.values(criteria).every(Boolean)) {
    console.log('\n⚠ 未完全达到验收标准：');
    if (!criteria.fieldAccuracy) console.log('  - 字段清洗准确率 < 95%');
    if (!criteria.synonymRecall) console.log('  - 同义词映射召回率 < 90%');
    if (!criteria.requiredInterception) console.log('  - 必填字段拦截率 < 95%');
    if (!criteria.endToEndPass) console.log('  - 端到端通过率 < 95%');
    process.exit(1);
  }

  console.log('\n✓ 所有验收标准均已达成');
  process.exit(0);
}

function generateReport(summary, cases) {
  const lines = [];
  lines.push('# 数据清洗引擎基准测试报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **测试用例数**：${summary.totalCases}`);
  lines.push('');

  lines.push('## 一、总体指标');
  lines.push('');
  lines.push('| 指标 | 结果 | 验收标准 | 是否达标 |');
  lines.push('|------|------|---------|---------|');
  lines.push(`| 字段清洗准确率 | ${summary.fieldAccuracyRate}% | ≥ 95% | ${summary.fieldAccuracyRate >= 95 ? '✅' : '❌'} |`);
  lines.push(`| 同义词映射召回率 | ${summary.synonymRecallRate}% | ≥ 90% | ${summary.synonymRecallRate >= 90 ? '✅' : '❌'} |`);
  lines.push(`| 必填字段拦截率 | ${summary.requiredInterceptionRate}% | ≥ 95% | ${summary.requiredInterceptionRate >= 95 ? '✅' : '❌'} |`);
  lines.push(`| 端到端通过率 | ${summary.endToEndPassRate}% | ≥ 95% | ${summary.endToEndPassRate >= 95 ? '✅' : '❌'} |`);
  lines.push('');

  lines.push('## 二、详细统计');
  lines.push('');
  lines.push(`- 通过用例：${summary.passed}`);
  lines.push(`- 失败用例：${summary.failed}`);
  lines.push(`- 字段匹配：${summary.fieldCorrectTotal}/${summary.fieldTotalTotal}`);
  lines.push(`- 同义词用例通过：${summary.synonymRecallCorrect}/${summary.synonymRecallTotal}`);
  lines.push(`- 必填拦截用例通过：${summary.requiredInterceptionCorrect}/${summary.requiredInterceptionTotal}`);
  lines.push('');

  lines.push('## 三、失败用例明细');
  lines.push('');
  const failedCases = cases.filter(c => !c.result.casePassed);
  if (failedCases.length === 0) {
    lines.push('无失败用例。');
  } else {
    lines.push('| 用例ID | 描述 | 期望状态 | 实际状态 | 实际质量分 | 期望最低分 |');
    lines.push('|--------|------|---------|---------|-----------|-----------|');
    for (const c of failedCases) {
      const r = c.result;
      lines.push(`| ${c.id} | ${c.description} | ${c.expected.expectedStatus} | ${r.statusMatch.actualStatus} | ${r.actualScore} | ${c.expected.minScore} |`);
    }
  }
  lines.push('');

  lines.push('## 四、所有用例结果');
  lines.push('');
  lines.push('| 用例ID | Schema | 描述 | 状态 | 质量分 | 字段准确率 |');
  lines.push('|--------|--------|------|------|--------|-----------|');
  for (const c of cases) {
    const r = c.result;
    lines.push(`| ${c.id} | ${c.schemaKey} | ${c.description} | ${r.casePassed ? '✅ 通过' : '❌ 失败'} | ${r.actualScore} | ${r.fieldAccuracy.rate}% |`);
  }
  lines.push('');

  lines.push('## 五、附录：用例失败详情');
  lines.push('');
  for (const c of failedCases) {
    const r = c.result;
    lines.push(`### ${c.id}: ${c.description}`);
    lines.push('');
    lines.push('**输入**：');
    lines.push('```json');
    lines.push(JSON.stringify(c.input, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('**期望清洗结果**：');
    lines.push('```json');
    lines.push(JSON.stringify(c.expected.cleanedData, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('**实际清洗结果**：');
    lines.push('```json');
    lines.push(JSON.stringify(r.actualData, null, 2));
    lines.push('```');
    lines.push('');
    if (r.actualErrors && r.actualErrors.length > 0) {
      lines.push('**错误信息**：');
      lines.push('```json');
      lines.push(JSON.stringify(r.actualErrors, null, 2));
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

runBenchmark().catch(err => {
  console.error('基准测试运行异常：', err);
  process.exit(1);
});
