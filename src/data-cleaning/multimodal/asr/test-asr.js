/**
 * ASR 模块验证脚本
 *
 * 用法：
 *   node src/data-cleaning/multimodal/asr/test-asr.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { transcribe } = require('./index');
const { isSilkFile, convertSilkToWav } = require('./wechat-voice-converter');
const metrics = require('../../benchmark/metrics');
const dc = require('../../index');
const feishuAdapter = require('./feishu-minutes-adapter');

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

function resolveAudio(relPath) {
  return path.join(BASE_DIR, relPath);
}

function extractFieldsFromText(text) {
  dc.init();
  const fields = {};

  const shootTypeMatch = text.match(/(亲子|商业拍摄|商业片|创作片|写真)/);
  if (shootTypeMatch) {
    const mapping = {
      '亲子': '亲子',
      '商业拍摄': '商业拍摄',
      '商业片': '商业拍摄',
      '创作片': '创作片',
      '写真': '创作片'
    };
    fields['拍摄类型'] = mapping[shootTypeMatch[1]];
  }

  const budgetMatch = text.match(/(\\d+)\s*[kK千]?\s*[-~到至]?\s*(?:\\d+)?\s*[kK千]?/);
  if (budgetMatch) {
    const num = parseInt(budgetMatch[1]);
    if (num < 1000) fields['预算区间'] = '1000元以下';
    else if (num <= 2000) fields['预算区间'] = '1000-2000元';
    else if (num <= 3000) fields['预算区间'] = '2000-3000元';
    else if (num <= 5000) fields['预算区间'] = '3000-5000元';
    else if (num <= 8000) fields['预算区间'] = '5000-8000元';
    else if (num <= 10000) fields['预算区间'] = '8000-10000元';
    else fields['预算区间'] = '10000元以上';
  }

  const styleMatch = text.match(/(日系清新|韩系唯美|复古胶片|暗调情绪|法式浪漫|国潮古风)/);
  if (styleMatch) {
    fields['意向风格'] = [styleMatch[1]];
  }

  const phoneMatch = text.match(/1[3-9]\\d{9}/);
  if (phoneMatch) {
    fields['联系方式'] = phoneMatch[0];
  }

  return fields;
}

async function runMockTests() {
  console.log('=== 飞书妙记 ASR 适配器 Mock 测试 ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.log(`  ✗ ${message}`);
      failed++;
    }
  }

  async function test(name, fn) {
    console.log(`测试：${name}`);
    try {
      await fn();
    } catch (err) {
      console.log(`  ✗ 异常：${err.message}`);
      failed++;
    }
    console.log('');
  }

  // Test 1: 音频文件不存在时抛出错误
  await test('音频文件不存在时抛出错误', async () => {
    const origCheck = feishuAdapter.checkFeishuAvailable;
    feishuAdapter.checkFeishuAvailable = () => ({ available: true });
    try {
      let thrown = null;
      try {
        await feishuAdapter.transcribe('nonexistent-audio-' + Date.now() + '.mp3');
      } catch (err) {
        thrown = err;
      }
      assert(thrown !== null, '应抛出错误');
      assert(thrown && thrown.message.includes('音频文件不存在'), '错误信息应包含"音频文件不存在"');
    } finally {
      feishuAdapter.checkFeishuAvailable = origCheck;
    }
  });

  // Test 2: lark-cli 未安装时抛出明确错误
  await test('lark-cli 未安装时抛出明确错误', async () => {
    const tmpAudio = path.join(os.tmpdir(), `test-audio-${Date.now()}.mp3`);
    fs.writeFileSync(tmpAudio, 'fake audio content');

    const origCheck = feishuAdapter.checkFeishuAvailable;
    feishuAdapter.checkFeishuAvailable = () => ({
      available: false,
      message: 'lark-cli 未安装或不在 PATH 中'
    });
    try {
      let thrown = null;
      try {
        await feishuAdapter.transcribe(tmpAudio);
      } catch (err) {
        thrown = err;
      }
      assert(thrown !== null, '应抛出错误');
      assert(thrown && thrown.message.includes('lark-cli'), '错误信息应包含"lark-cli"');
    } finally {
      feishuAdapter.checkFeishuAvailable = origCheck;
      try { fs.unlinkSync(tmpAudio); } catch (e) { /* 忽略 */ }
    }
  });

  // Test 3: 成功转写场景返回正确格式
  await test('成功转写场景返回正确格式', async () => {
    const tmpAudio = path.join(os.tmpdir(), `test-audio-${Date.now()}.mp3`);
    fs.writeFileSync(tmpAudio, 'fake audio content');

    const origCheck = feishuAdapter.checkFeishuAvailable;
    const origExec = feishuAdapter._deps.execSync;
    const origSleep = feishuAdapter._deps.sleep;

    feishuAdapter.checkFeishuAvailable = () => ({ available: true });
    feishuAdapter._deps.sleep = () => { /* no-op，测试不等待 */ };

    feishuAdapter._deps.execSync = function (cmd, opts) {
      if (cmd.includes('drive upload')) {
        return JSON.stringify({ file_token: 'ft_mock_001' });
      }
      if (cmd.includes('POST') && cmd.includes('/minutes/v1/minutes')) {
        return JSON.stringify({ code: 0, data: { minute: { minute_id: 'm_mock_001' } } });
      }
      if (cmd.includes('GET') && cmd.includes('/transcripts')) {
        return JSON.stringify({
          code: 0,
          data: {
            transcript: {
              text: '你好，我想咨询亲子照。',
              segments: [
                { start_time: 0, end_time: 2000, text: '你好', speaker: 'spk_1' },
                { start_time: 2000, end_time: 5000, text: '我想咨询亲子照', speaker: 'spk_1' }
              ]
            }
          }
        });
      }
      if (cmd.includes('GET') && cmd.includes('/minutes/v1/minutes/')) {
        return JSON.stringify({ code: 0, data: { minute: { status: 'completed' } } });
      }
      throw new Error('Mock: 未预期的命令：' + cmd);
    };

    try {
      const result = await feishuAdapter.transcribe(tmpAudio, { pollInterval: 10, pollTimeout: 5000 });
      assert(typeof result.text === 'string' && result.text.length > 0, '返回 text 应为非空字符串');
      assert(result.confidence > 0 && result.confidence <= 1, 'confidence 应在 0-1 之间');
      assert(Array.isArray(result.segments), 'segments 应为数组');
      assert(result.segments.length === 2, 'segments 应有 2 条记录');
      assert(result.segments[0].text === '你好', '第一条 segment 文本应为"你好"');
      assert(result.segments[0].start === 0, '第一条 segment start 应为 0');
      assert(result.segments[1].speaker === 'spk_1', '第二条 segment speaker 应为 spk_1');
    } finally {
      feishuAdapter.checkFeishuAvailable = origCheck;
      feishuAdapter._deps.execSync = origExec;
      feishuAdapter._deps.sleep = origSleep;
      try { fs.unlinkSync(tmpAudio); } catch (e) { /* 忽略 */ }
    }
  });

  console.log('='.repeat(50));
  console.log(`Mock 测试完成：${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function runASRBenchmark() {
  console.log('=== ASR 模块验证 ===\n');

  const groundTruth = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'ground-truth.json'), 'utf-8'));
  const results = [];
  let silkTotal = 0;
  let silkSuccess = 0;

  for (const item of groundTruth) {
    let audioPath = resolveAudio(item.audio);
    console.log(`验证：${item.audio}`);

    if (!fs.existsSync(audioPath)) {
      console.log(`  ⚠ 音频文件不存在，跳过：${audioPath}`);
      results.push({ ...item, skipped: true, reason: '音频文件不存在' });
      continue;
    }

    // silk 转换
    if (isSilkFile(audioPath)) {
      silkTotal++;
      try {
        const wavPath = audioPath.replace(/\.silk$/i, '.wav');
        convertSilkToWav(audioPath, wavPath);
        audioPath = wavPath;
        silkSuccess++;
      } catch (err) {
        console.log(`  ✗ silk 转换失败：${err.message}`);
        results.push({ ...item, skipped: true, reason: err.message });
        continue;
      }
    }

    try {
      const asrResult = await transcribe(audioPath, { engine: 'whisper', fallback: true });
      const wer = metrics.computeWER(item.expectedText, asrResult.text);
      const parsedFields = extractFieldsFromText(asrResult.text);
      const fieldAccuracy = metrics.computeFieldAccuracy(item.expectedFields || {}, parsedFields);

      results.push({
        ...item,
        skipped: false,
        asrResult,
        parsedFields,
        wer,
        fieldAccuracy
      });

      console.log(`  WER：${wer}%`);
      console.log(`  字段提取准确率：${fieldAccuracy.rate}%`);
    } catch (err) {
      console.log(`  ✗ ASR 失败：${err.message}`);
      results.push({ ...item, skipped: false, error: err.message });
    }
  }

  const validResults = results.filter(r => !r.skipped && !r.error);
  const avgWER = validResults.length
    ? Math.round((validResults.reduce((sum, r) => sum + r.wer, 0) / validResults.length) * 100) / 100
    : 0;
  const avgField = validResults.length
    ? Math.round((validResults.reduce((sum, r) => sum + r.fieldAccuracy.rate, 0) / validResults.length) * 100) / 100
    : 0;

  const reportPath = path.join(REPORT_DIR, `asr_benchmark_${formatTimestamp()}.md`);
  ensureDir(REPORT_DIR);
  fs.writeFileSync(reportPath, generateReport(groundTruth, results, avgWER, avgField, silkTotal, silkSuccess), 'utf-8');

  console.log('\n' + '='.repeat(50));
  console.log('ASR 验证完成');
  console.log(`  总样本数：${groundTruth.length}`);
  console.log(`  有效验证：${validResults.length}`);
  console.log(`  平均 WER：${avgWER}%`);
  console.log(`  平均字段准确率：${avgField}%`);
  console.log(`  silk 转换：${silkSuccess}/${silkTotal}`);
  console.log(`  报告已生成：${reportPath}`);

  if (validResults.length === 0) {
    console.log('\n⚠ 未找到可验证音频，请补充 fixtures 后重试');
    process.exit(0);
  }

  const criteria = {
    wer: avgWER <= 20,
    fieldAccuracy: avgField >= 80
  };

  if (!Object.values(criteria).every(Boolean)) {
    console.log('\n⚠ 未完全达到验收标准：');
    if (!criteria.wer) console.log('  - 平均 WER > 20%');
    if (!criteria.fieldAccuracy) console.log('  - 平均字段准确率 < 80%');
    process.exit(1);
  }

  console.log('\n✓ ASR 验收标准均已达成');
}

function generateReport(groundTruth, results, avgWER, avgField, silkTotal, silkSuccess) {
  const lines = [];
  lines.push('# ASR 模块验证报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **总样本数**：${groundTruth.length}`);
  lines.push('');

  lines.push('## 一、总体指标');
  lines.push('');
  lines.push(`- 平均 WER：${avgWER}%`);
  lines.push(`- 平均字段提取准确率：${avgField}%`);
  lines.push(`- silk 转换成功率：${silkTotal ? Math.round((silkSuccess / silkTotal) * 100) : 0}% (${silkSuccess}/${silkTotal})`);
  lines.push('');

  lines.push('## 二、单样本详情');
  lines.push('');
  lines.push('| 音频 | 场景 | 状态 | WER | 字段准确率 |');
  lines.push('|------|------|------|-----|-----------|');
  for (const r of results) {
    let status = '✅ 已验证';
    if (r.skipped) status = '⏭ 跳过';
    if (r.error) status = '❌ 失败';
    const wer = r.wer !== undefined ? `${r.wer}%` : '-';
    const field = r.fieldAccuracy ? `${r.fieldAccuracy.rate}%` : '-';
    lines.push(`| ${r.audio} | ${r.scene} | ${status} | ${wer} | ${field} |`);
  }
  lines.push('');

  lines.push('## 三、失败/跳过明细');
  lines.push('');
  const problemResults = results.filter(r => r.skipped || r.error);
  if (problemResults.length === 0) {
    lines.push('无失败或跳过样本。');
  } else {
    for (const r of problemResults) {
      lines.push(`- ${r.audio}: ${r.reason || r.error}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

const isBenchmarkMode = process.argv.includes('--benchmark');

if (isBenchmarkMode) {
  runASRBenchmark().catch(err => {
    console.error('ASR 验证异常：', err);
    process.exit(1);
  });
} else {
  runMockTests().catch(err => {
    console.error('Mock 测试异常：', err);
    process.exit(1);
  });
}
