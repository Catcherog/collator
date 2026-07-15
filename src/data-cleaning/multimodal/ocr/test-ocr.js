/**
 * OCR 模块验证脚本
 *
 * 用法：
 *   node src/data-cleaning/multimodal/ocr/test-ocr.js
 *
 * 说明：
 *   1. 将真实业务图片放入 fixtures/ 下对应目录。
 *   2. 在 ground-truth.json 中维护每张图片的真值。
 *   3. 脚本会跳过不存在的图片文件，仅对已存在文件做验证。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractText } = require('./index');
const { parseBusinessCard, parseContract } = require('./business-card-parser');
const metrics = require('../../benchmark/metrics');

const BASE_DIR = __dirname;
const REPORT_DIR = path.join(BASE_DIR, '..', '..', '..', '..', 'docs', 'reports');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function resolveImage(relPath) {
  return path.join(BASE_DIR, relPath);
}

function parseFields(scene, text) {
  if (scene === 'business-card') return parseBusinessCard(text);
  if (scene === 'contract-screenshot') return parseContract(text);
  return {};
}

/**
 * 飞书 OCR 适配器 Mock 测试
 * 通过 monkey-patch child_process.execSync + 模块缓存重载实现隔离测试
 */
function makeMockExecSync(scenario) {
  return function (cmd, opts) {
    if (scenario === 'unavailable') {
      // 模拟 lark-cli 未安装：任何 lark-cli 调用都抛错
      const err = new Error('lark-cli: command not found');
      err.stderr = 'lark-cli: command not found';
      throw err;
    }
    // scenario === 'available' | 'success'
    if (cmd.includes('--version')) {
      return 'lark-cli 1.0.0';
    }
    if (scenario === 'available') {
      return '';
    }
    // scenario === 'success'
    if (cmd.includes('drive +upload')) {
      return JSON.stringify({
        code: 0,
        data: { fileToken: 'mock-file-token-12345' }
      });
    }
    if (cmd.includes('/ocr')) {
      return JSON.stringify({
        code: 0,
        data: {
          content: [
            { type: 'text', text: '张三\n13800138000\n微信 zhangsan001' }
          ]
        }
      });
    }
    throw new Error(`Mock 未覆盖的命令：${cmd}`);
  };
}

async function runMockTests() {
  console.log('=== 飞书 OCR 适配器 Mock 测试 ===\n');

  const childProcess = require('child_process');
  const originalExecSync = childProcess.execSync;
  const adapterPath = require.resolve('./feishu-ocr-adapter');

  let passed = 0;
  let failed = 0;
  const total = 3;

  function assert(condition, message) {
    if (!condition) {
      throw new Error(`断言失败：${message}`);
    }
    console.log(`  ✅ ${message}`);
  }

  function loadAdapterWithMock(mockFn) {
    childProcess.execSync = mockFn;
    delete require.cache[adapterPath];
    return require('./feishu-ocr-adapter');
  }

  function restoreExecSync() {
    childProcess.execSync = originalExecSync;
    delete require.cache[adapterPath];
  }

  // 测试 1：图片文件不存在
  try {
    console.log('测试 1/3：图片文件不存在时抛出错误');
    const adapter = loadAdapterWithMock(makeMockExecSync('available'));
    let threw = false;
    let errMsg = '';
    try {
      await adapter.extractText(`nonexistent-${Date.now()}.png`);
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, '应抛出错误');
    assert(errMsg.includes('图片文件不存在'), `错误信息应包含"图片文件不存在"，实际：${errMsg}`);
    passed++;
  } catch (e) {
    failed++;
    console.log(`  ❌ ${e.message}`);
  } finally {
    restoreExecSync();
  }

  // 测试 2：lark-cli 未安装
  try {
    console.log('测试 2/3：lark-cli 未安装时抛出明确错误');
    const adapter = loadAdapterWithMock(makeMockExecSync('unavailable'));
    const tempFile = path.join(os.tmpdir(), `feishu-test-${Date.now()}.png`);
    fs.writeFileSync(tempFile, 'fake image');
    let threw = false;
    let errMsg = '';
    try {
      await adapter.extractText(tempFile);
    } catch (e) {
      threw = true;
      errMsg = e.message;
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
    }
    assert(threw, '应抛出错误');
    assert(errMsg.includes('lark-cli'), `错误信息应提及 lark-cli，实际：${errMsg}`);
    passed++;
  } catch (e) {
    failed++;
    console.log(`  ❌ ${e.message}`);
  } finally {
    restoreExecSync();
  }

  // 测试 3：成功识别场景
  try {
    console.log('测试 3/3：成功识别场景');
    const adapter = loadAdapterWithMock(makeMockExecSync('success'));
    const tempFile = path.join(os.tmpdir(), `feishu-test-${Date.now()}.png`);
    fs.writeFileSync(tempFile, 'fake image');
    let result;
    try {
      result = await adapter.extractText(tempFile);
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
    }
    assert(result && typeof result.text === 'string', '返回值应包含 text 字符串');
    assert(result.confidence === 0.85, `confidence 应为 0.85，实际：${result.confidence}`);
    assert(Array.isArray(result.blocks), 'blocks 应为数组');
    assert(result.blocks.length === 3, `应有 3 行文本，实际：${result.blocks.length}`);
    assert(result.text.includes('张三'), `text 应包含"张三"，实际：${result.text}`);
    assert(result.text.includes('13800138000'), `text 应包含电话号码，实际：${result.text}`);
    passed++;
  } catch (e) {
    failed++;
    console.log(`  ❌ ${e.message}`);
  } finally {
    restoreExecSync();
  }

  console.log(`\nMock 测试结果：${passed}/${total} 通过，${failed} 失败\n`);
  return { passed, failed, total };
}

async function runOCRBenchmark() {
  console.log('=== OCR 模块验证 ===\n');

  const groundTruth = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'ground-truth.json'), 'utf-8'));
  const results = [];

  for (const item of groundTruth) {
    const imagePath = resolveImage(item.image);
    console.log(`验证：${item.image}`);

    if (!fs.existsSync(imagePath)) {
      console.log(`  ⚠ 图片文件不存在，跳过：${imagePath}`);
      results.push({ ...item, skipped: true, reason: '图片文件不存在' });
      continue;
    }

    try {
      const ocrResult = await extractText(imagePath, { engine: 'tesseract', fallback: true });
      const parsedFields = parseFields(item.scene, ocrResult.text);
      const cra = metrics.computeCRA(item.expectedText, ocrResult.text);
      const fieldAccuracy = metrics.computeFieldAccuracy(item.expectedFields || {}, parsedFields);

      results.push({
        ...item,
        skipped: false,
        ocrResult,
        parsedFields,
        cra,
        fieldAccuracy
      });

      console.log(`  字符准确率：${cra}%`);
      console.log(`  字段提取准确率：${fieldAccuracy.rate}%`);
    } catch (err) {
      console.log(`  ✗ OCR 失败：${err.message}`);
      results.push({ ...item, skipped: false, error: err.message });
    }
  }

  const validResults = results.filter(r => !r.skipped && !r.error);
  const sceneStats = {};
  for (const r of validResults) {
    if (!sceneStats[r.scene]) sceneStats[r.scene] = { count: 0, craSum: 0, fieldSum: 0 };
    sceneStats[r.scene].count++;
    sceneStats[r.scene].craSum += r.cra;
    sceneStats[r.scene].fieldSum += r.fieldAccuracy.rate;
  }

  for (const scene in sceneStats) {
    const s = sceneStats[scene];
    s.avgCRA = s.count ? Math.round((s.craSum / s.count) * 100) / 100 : 0;
    s.avgField = s.count ? Math.round((s.fieldSum / s.count) * 100) / 100 : 0;
  }

  const reportPath = path.join(REPORT_DIR, `ocr_benchmark_${formatTimestamp()}.md`);
  ensureDir(REPORT_DIR);
  fs.writeFileSync(reportPath, generateReport(groundTruth, results, sceneStats), 'utf-8');

  console.log('\n' + '='.repeat(50));
  console.log('OCR 验证完成');
  console.log(`  总样本数：${groundTruth.length}`);
  console.log(`  有效验证：${validResults.length}`);
  console.log(`  跳过/失败：${groundTruth.length - validResults.length}`);
  for (const [scene, s] of Object.entries(sceneStats)) {
    console.log(`  [${scene}] 平均字符准确率：${s.avgCRA}%，平均字段准确率：${s.avgField}%`);
  }
  console.log(`  报告已生成：${reportPath}`);
}

function generateReport(groundTruth, results, sceneStats) {
  const lines = [];
  lines.push('# OCR 模块验证报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **总样本数**：${groundTruth.length}`);
  lines.push('');

  lines.push('## 一、按场景统计');
  lines.push('');
  lines.push('| 场景 | 样本数 | 平均字符准确率 | 平均字段准确率 |');
  lines.push('|------|--------|---------------|---------------|');
  for (const [scene, s] of Object.entries(sceneStats)) {
    lines.push(`| ${scene} | ${s.count} | ${s.avgCRA}% | ${s.avgField}% |`);
  }
  lines.push('');

  lines.push('## 二、单样本详情');
  lines.push('');
  lines.push('| 图片 | 场景 | 状态 | 字符准确率 | 字段准确率 |');
  lines.push('|------|------|------|-----------|-----------|');
  for (const r of results) {
    let status = '✅ 已验证';
    if (r.skipped) status = '⏭ 跳过';
    if (r.error) status = '❌ 失败';
    const cra = r.cra !== undefined ? `${r.cra}%` : '-';
    const field = r.fieldAccuracy ? `${r.fieldAccuracy.rate}%` : '-';
    lines.push(`| ${r.image} | ${r.scene} | ${status} | ${cra} | ${field} |`);
  }
  lines.push('');

  lines.push('## 三、失败/跳过明细');
  lines.push('');
  const problemResults = results.filter(r => r.skipped || r.error);
  if (problemResults.length === 0) {
    lines.push('无失败或跳过样本。');
  } else {
    for (const r of problemResults) {
      lines.push(`- ${r.image}: ${r.reason || r.error}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

runMockTests().then(mockResult => {
  if (mockResult.failed > 0) {
    process.exitCode = 1;
  }
  return runOCRBenchmark();
}).catch(err => {
  console.error('OCR 验证异常：', err);
  process.exit(1);
});
