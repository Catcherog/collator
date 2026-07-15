// TEMP: 多模态单模块综合验证 | 2026-06-26 | 预计删除日期 2026-06-29
const fs = require('fs');
const path = require('path');
const ocr = require('./ocr');
const asr = require('./asr');
const clip = require('./clip');
const metrics = require('../../benchmark/metrics');

const REPORT_DIR = path.join(__dirname, '..', '..', '..', '..', 'docs', 'reports');

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

let totalTests = 0;
let passedTests = 0;
const results = { ocr: [], asr: [], clip: [] };

function assert(condition, name, detail = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${name}`);
    return true;
  } else {
    console.log(`  ✗ ${name} ${detail}`);
    return false;
  }
}

async function testOCRModule() {
  console.log('\n=== OCR 模块验证 ===\n');

  const testCases = [
    {
      name: 'OCR mock模式基本调用',
      mockText: '张女士 13600136000 预算3000-5000元',
      expectedText: '张女士 13600136000 预算3000-5000元'
    },
    {
      name: 'OCR mock模式低置信度',
      mockText: '测试文本',
      mockConfidence: 0.5,
      expectedText: '测试文本'
    },
    {
      name: 'CRA指标-完美匹配',
      craRef: '日系清新亲子照',
      craHyp: '日系清新亲子照',
      expectedCRA: 100
    },
    {
      name: 'CRA指标-含错误',
      craRef: '联系电话：13800138000',
      craHyp: '联系电话：13800138001',
      minCRA: 90
    },
    {
      name: 'isImage文件类型检测',
      testPath: 'test.png',
      expectedIsImage: true
    },
    {
      name: 'isImage非图片文件',
      testPath: 'test.pdf',
      expectedIsImage: false
    }
  ];

  for (const tc of testCases) {
    if (tc.mockText !== undefined) {
      try {
        const result = await ocr.extractText('dummy.png', {
          engine: 'mock',
          mockText: tc.mockText,
          mockConfidence: tc.mockConfidence || 0.99
        });
        const ok = assert(
          result.text === tc.expectedText && result.engine === 'mock' && typeof result.confidence === 'number',
          tc.name
        );
        results.ocr.push({ name: tc.name, passed: ok, type: 'api' });
      } catch (err) {
        assert(false, tc.name, err.message);
        results.ocr.push({ name: tc.name, passed: false, error: err.message });
      }
    } else if (tc.craRef !== undefined) {
      const cra = metrics.computeCRA(tc.craRef, tc.craHyp);
      const ok = tc.expectedCRA !== undefined
        ? assert(cra === tc.expectedCRA, tc.name, `CRA=${cra}, expected=${tc.expectedCRA}`)
        : assert(cra >= tc.minCRA, tc.name, `CRA=${cra}, expected>=${tc.minCRA}`);
      results.ocr.push({ name: tc.name, passed: ok, type: 'metric', cra });
    } else if (tc.testPath !== undefined) {
      const isImg = ocr.isImage(tc.testPath);
      const ok = assert(isImg === tc.expectedIsImage, tc.name, `isImage=${isImg}`);
      results.ocr.push({ name: tc.name, passed: ok, type: 'utility' });
    }
  }
}

async function testASRModule() {
  console.log('\n=== ASR 模块验证 ===\n');

  const testCases = [
    {
      name: 'ASR mock模式基本调用',
      mockText: '你好我想咨询一下拍摄写真的价格',
      expectedText: '你好我想咨询一下拍摄写真的价格'
    },
    {
      name: 'ASR mock模式时长返回',
      mockText: '测试语音',
      mockDuration: 15.5,
      expectedDuration: 15.5
    },
    {
      name: 'WER指标-完美匹配',
      werRef: '客户想拍日系清新风格',
      werHyp: '客户想拍日系清新风格',
      expectedWER: 0
    },
    {
      name: 'WER指标-含替换错误',
      werRef: '预算大概 三千 左右',
      werHyp: '预算大概 四千 左右',
      maxWER: 50
    },
    {
      name: 'WER指标-含插入删除',
      werRef: '下周 三 有空',
      werHyp: '下周三 下午 有空',
      maxWER: 70
    }
  ];

  for (const tc of testCases) {
    if (tc.mockText !== undefined) {
      try {
        const result = await asr.transcribe('dummy.mp3', {
          engine: 'mock',
          mockText: tc.mockText,
          mockConfidence: 0.98,
          mockDuration: tc.mockDuration || 0
        });
        let ok = result.text === tc.expectedText && result.engine === 'mock';
        if (tc.expectedDuration !== undefined) {
          ok = ok && result.duration === tc.expectedDuration;
        }
        assert(ok, tc.name);
        results.asr.push({ name: tc.name, passed: ok, type: 'api' });
      } catch (err) {
        assert(false, tc.name, err.message);
        results.asr.push({ name: tc.name, passed: false, error: err.message });
      }
    } else if (tc.werRef !== undefined) {
      const wer = metrics.computeWER(tc.werRef, tc.werHyp);
      const ok = tc.expectedWER !== undefined
        ? assert(wer === tc.expectedWER, tc.name, `WER=${wer}%, expected=${tc.expectedWER}%`)
        : assert(wer <= tc.maxWER, tc.name, `WER=${wer}%, expected<=${tc.maxWER}%`);
      results.asr.push({ name: tc.name, passed: ok, type: 'metric', wer });
    }
  }
}

async function testCLIPModule() {
  console.log('\n=== CLIP 模块验证 ===\n');

  const testCases = [
    {
      name: 'CLIP mock模式匹配返回',
      mockMatched: true,
      mockScore: 0.92,
      expectedMatched: true
    },
    {
      name: 'CLIP mock模式不匹配返回',
      mockMatched: false,
      mockScore: 0.35,
      expectedMatched: false
    },
    {
      name: 'CLIP相似度阈值判断-通过',
      mockScore: 0.75,
      threshold: 0.6,
      shouldPass: true
    },
    {
      name: 'CLIP相似度阈值判断-不通过',
      mockScore: 0.45,
      threshold: 0.6,
      shouldPass: false
    },
    {
      name: 'CLIP返回bestText字段',
      title: '日系清新亲子照',
      copy: '今天天气真好',
      mockScore: 0.88
    }
  ];

  for (const tc of testCases) {
    try {
      const result = await clip.checkImageTextMatch('dummy.jpg', tc.title || '测试标题', tc.copy || '', {
        engine: 'mock',
        mockMatched: tc.mockMatched,
        mockScore: tc.mockScore || 0.8
      });

      let ok = true;
      if (tc.expectedMatched !== undefined) {
        ok = ok && result.matched === tc.expectedMatched;
      }
      if (tc.threshold !== undefined) {
        const pass = result.score >= tc.threshold;
        ok = ok && pass === tc.shouldPass;
      }
      if (tc.title !== undefined) {
        ok = ok && (result.bestText === tc.title || result.texts.includes(tc.title));
      }
      ok = ok && result.engine === 'mock' && typeof result.score === 'number';

      assert(ok, tc.name, `score=${result.score}, matched=${result.matched}`);
      results.clip.push({ name: tc.name, passed: ok, type: 'api', score: result.score });
    } catch (err) {
      assert(false, tc.name, err.message);
      results.clip.push({ name: tc.name, passed: false, error: err.message });
    }
  }
}

function testCrossModuleMetrics() {
  console.log('\n=== 跨模块指标验证 ===\n');

  const accuracyTests = [
    { correct: 9, total: 10, expected: 90, name: 'accuracy 9/10 = 90%' },
    { correct: 38, total: 38, expected: 100, name: 'accuracy 38/38 = 100%' },
    { correct: 0, total: 0, expected: 0, name: 'accuracy 0/0 = 0%' }
  ];

  for (const tc of accuracyTests) {
    const acc = metrics.accuracy(tc.correct, tc.total);
    assert(acc === tc.expected, tc.name, `got ${acc}%`);
  }

  const isEqualTests = [
    { a: 'hello', b: 'hello', expected: true, name: 'isEqual字符串相等' },
    { a: ['a', 'b'], b: ['b', 'a'], expected: true, name: 'isEqual数组排序后相等' },
    { a: 123, b: '123', expected: true, name: 'isEqual数字与字符串' },
    { a: 'test', b: 'Test', expected: false, name: 'isEqual大小写不同' }
  ];

  for (const tc of isEqualTests) {
    const eq = metrics.isEqual(tc.a, tc.b);
    assert(eq === tc.expected, tc.name, `${JSON.stringify(tc.a)} vs ${JSON.stringify(tc.b)}`);
  }
}

function generateReport() {
  const lines = [];
  lines.push('# 多模态（OCR/ASR/CLIP）单模块验证报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **验证模式**：Mock 模式（接口正确性 + 指标计算验证）`);
  lines.push('');

  lines.push('## 一、总体结果');
  lines.push('');
  lines.push(`- **总测试项**：${totalTests}`);
  lines.push(`- **通过项**：${passedTests}`);
  lines.push(`- **失败项**：${totalTests - passedTests}`);
  lines.push(`- **通过率**：${Math.round((passedTests / totalTests) * 10000) / 100}%`);
  lines.push('');

  const modules = [
    { key: 'ocr', name: 'OCR 光学字符识别' },
    { key: 'asr', name: 'ASR 自动语音识别' },
    { key: 'clip', name: 'CLIP 图文匹配' }
  ];

  lines.push('## 二、分模块结果');
  lines.push('');

  for (const mod of modules) {
    const modResults = results[mod.key];
    const modPassed = modResults.filter(r => r.passed).length;
    lines.push(`### ${mod.name}`);
    lines.push('');
    lines.push(`- 测试项：${modResults.length}`);
    lines.push(`- 通过：${modPassed}`);
    lines.push(`- 通过率：${modResults.length > 0 ? Math.round((modPassed / modResults.length) * 10000) / 100 : 0}%`);
    lines.push('');

    const apiTests = modResults.filter(r => r.type === 'api');
    const metricTests = modResults.filter(r => r.type === 'metric' || r.type === 'utility');

    lines.push('| 测试项 | 类型 | 结果 | 详情 |');
    lines.push('|--------|------|------|------|');
    for (const r of modResults) {
      const typeLabel = r.type === 'api' ? 'API接口' : r.type === 'metric' ? '指标计算' : '工具函数';
      let detail = '-';
      if (r.cra !== undefined) detail = `CRA=${r.cra}%`;
      if (r.wer !== undefined) detail = `WER=${r.wer}%`;
      if (r.score !== undefined) detail = `score=${r.score}`;
      if (r.error) detail = r.error;
      lines.push(`| ${r.name} | ${typeLabel} | ${r.passed ? '✅ 通过' : '❌ 失败'} | ${detail} |`);
    }
    lines.push('');
  }

  lines.push('## 三、验证项说明');
  lines.push('');
  lines.push('### OCR 模块验证项');
  lines.push('- ✅ Mock 引擎调用接口正确性');
  lines.push('- ✅ 置信度参数传递');
  lines.push('- ✅ CRA（字符识别准确率）指标计算');
  lines.push('- ✅ 图片文件类型检测（isImage）');
  lines.push('- ⏳ 真实图片 OCR 准确率（需 Tesseract 或飞书 OCR 配置）');
  lines.push('- ⏳ 名片/合同结构化字段解析（需真实样本）');
  lines.push('');

  lines.push('### ASR 模块验证项');
  lines.push('- ✅ Mock 引擎调用接口正确性');
  lines.push('- ✅ 时长（duration）字段返回');
  lines.push('- ✅ WER（词错误率）指标计算');
  lines.push('- ⏳ 真实语音识别准确率（需 Whisper 或飞书妙记配置）');
  lines.push('- ⏳ 微信语音格式转换（需 ffmpeg）');
  lines.push('');

  lines.push('### CLIP 模块验证项');
  lines.push('- ✅ Mock 引擎调用接口正确性');
  lines.push('- ✅ 图文匹配判定（matched/score）');
  lines.push('- ✅ 相似度阈值判断逻辑');
  lines.push('- ✅ bestText 最佳匹配文本返回');
  lines.push('- ⏳ 真实图文相似度计算（需 Python CLIP 环境）');
  lines.push('');

  lines.push('## 四、指标计算公式');
  lines.push('');
  lines.push('| 指标 | 全称 | 公式 | 用途 |');
  lines.push('|------|------|------|------|');
  lines.push('| CRA | Character Recognition Accuracy | (正确字符数 / 总字符数) × 100% | OCR 准确率评估 |');
  lines.push('| WER | Word Error Rate | (替换+插入+删除) / 参考词数 × 100% | ASR 错误率评估 |');
  lines.push('| Accuracy | 准确率 | 正确数 / 总数 × 100% | 通用准确率 |');
  lines.push('');

  lines.push('## 五、环境依赖说明');
  lines.push('');
  lines.push('| 引擎 | 类型 | 依赖 | 当前状态 |');
  lines.push('|------|------|------|---------|');
  lines.push('| Mock | 所有模块 | 无（内置） | ✅ 可用 |');
  lines.push('| Tesseract.js | OCR | npm包（纯JS） | ✅ 内置可降级 |');
  lines.push('| 飞书 OCR API | OCR | 飞书应用凭证 | ⚠ 需配置 |');
  lines.push('| Whisper | ASR | Python + ffmpeg | ⚠ 需环境 |');
  lines.push('| 飞书妙记 | ASR | 飞书应用凭证 | ⚠ 需配置 |');
  lines.push('| Python CLIP | CLIP | Python + PyTorch | ⚠ 需环境 |');
  lines.push('');

  lines.push('---');
  lines.push(`*报告由 collator 多模态验证框架自动生成*`);

  return lines.join('\n');
}

async function main() {
  console.log('=== 多模态（OCR/ASR/CLIP）单模块验证 ===\n');
  console.log('验证模式：Mock 模式 + 指标计算验证\n');

  await testOCRModule();
  await testASRModule();
  await testCLIPModule();
  testCrossModuleMetrics();

  console.log('\n' + '='.repeat(50));
  console.log('单模块验证完成');
  console.log(`  总测试项：${totalTests}`);
  console.log(`  通过：${passedTests}`);
  console.log(`  失败：${totalTests - passedTests}`);
  console.log(`  通过率：${Math.round((passedTests / totalTests) * 10000) / 100}%`);

  ensureDir(REPORT_DIR);
  const reportPath = path.join(REPORT_DIR, `multimodal_validation_${formatTimestamp()}.md`);
  fs.writeFileSync(reportPath, generateReport(), 'utf-8');
  console.log(`  报告已生成：${reportPath}`);

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('验证异常：', err);
  process.exit(1);
});
