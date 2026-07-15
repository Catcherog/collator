/**
 * 多模态集成测试
 *
 * 用法：
 *   node src/data-cleaning/test-multimodal-integration.js
 *
 * 说明：
 *   验证 OCR / ASR / CLIP 接入 DataCleaner 后的端到端流程，
 *   默认使用 mock 引擎，不依赖真实 Tesseract / Whisper / Python 环境。
 */

const path = require('path');
const dc = require('./index');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    errors.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function assertExists(obj, prop, message) {
  assert(obj && obj[prop] !== undefined && obj[prop] !== null, message || `${prop} 应该存在`);
}

console.log('=== 多模态集成测试 ===\n');

dc.init();
const cleaner = dc.createCleaner();

async function runMM001() {
  console.log('MM-001: 仅结构化数据');
  const data = {
    '客户姓名': '  测试客户  ',
    '联系方式': '138-0013-8000',
    '来源渠道': '小红书'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {});
  assert(result.success === true, '清洗成功');
  assert(!result.multimodal || (!result.multimodal.ocr && !result.multimodal.asr && !result.multimodal.clip), '未触发多模态');
  assert(result.data['客户姓名'] === '测试客户', '客户姓名已清洗');
  assert(result.data['联系方式'] === '13800138000', '联系方式已清洗');
}

async function runMM002() {
  console.log('\nMM-002: 结构化 + imagePath + mock OCR');
  const data = {
    '客户姓名': '张小姐',
    '联系方式': '13800138000'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {
    enableMultimodal: true,
    imagePath: 'fixtures/test-image.png',
    ocrEngine: 'mock',
    mockOcrText: '  测试OCR跟进记录  '
  });
  assert(result.success === true, '清洗成功');
  assertExists(result.multimodal, 'ocr', '返回 multimodal.ocr');
  assert(result.multimodal.ocr.text === '  测试OCR跟进记录  ', 'OCR 文本正确');
  assert(result.data['跟进记录'] === '测试OCR跟进记录', '跟进记录已写入并清洗');
  assert(result.corrections.some(c => c.field === '跟进记录'), '生成跟进记录 corrections');
}

async function runMM003() {
  console.log('\nMM-003: 结构化 + audioPath + mock ASR');
  const data = {
    '客户姓名': '李先生',
    '联系方式': '13900139000'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {
    enableMultimodal: true,
    audioPath: 'fixtures/test-audio.mp3',
    asrEngine: 'mock',
    mockAsrText: '  测试ASR跟进记录  '
  });
  assert(result.success === true, '清洗成功');
  assertExists(result.multimodal, 'asr', '返回 multimodal.asr');
  assert(result.multimodal.asr.text === '  测试ASR跟进记录  ', 'ASR 文本正确');
  assert(result.data['跟进记录'] === '测试ASR跟进记录', '跟进记录已写入并清洗');
  assert(result.corrections.some(c => c.field === '跟进记录'), '生成跟进记录 corrections');
}

async function runMM004() {
  console.log('\nMM-004: 结构化 + imagePath + audioPath');
  const data = {
    '客户姓名': '王女士',
    '联系方式': '13700137000'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {
    enableMultimodal: true,
    imagePath: 'fixtures/test-image.png',
    audioPath: 'fixtures/test-audio.mp3',
    ocrEngine: 'mock',
    mockOcrText: 'OCR文本',
    asrEngine: 'mock',
    mockAsrText: 'ASR文本'
  });
  assert(result.success === true, '清洗成功');
  assertExists(result.multimodal, 'ocr', '返回 multimodal.ocr');
  assertExists(result.multimodal, 'asr', '返回 multimodal.asr');
  assert(result.data['跟进记录'].includes('OCR文本') && result.data['跟进记录'].includes('ASR文本'), '跟进记录包含 OCR 和 ASR 文本');
}

async function runMM005() {
  console.log('\nMM-005: product schema + 图片 + 文案 + mock CLIP 不匹配');
  const data = {
    '发布标题': '日系清新亲子照',
    '所属平台': '小红书',
    '发布状态': '待制作',
    '成品文件': 'test.jpg'
  };
  const result = await cleaner.cleanRecordAsync('product', data, {}, {
    enableMultimodal: true,
    imagePath: 'fixtures/test-image.png',
    clipEngine: 'mock',
    mockClipMatched: false,
    mockClipScore: 0.35
  });
  assert(result.success === true, '清洗成功');
  assertExists(result.multimodal, 'clip', '返回 multimodal.clip');
  assert(result.multimodal.clip.matched === false, 'CLIP 判定为不匹配');
  assert(result.warnings.some(w => w.includes('CLIP')), '生成 CLIP warning');
}

async function runMM006() {
  console.log('\nMM-006: OCR 失败（无效图片路径）');
  const data = {
    '客户姓名': '赵先生',
    '联系方式': '13600136000'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {
    enableMultimodal: true,
    imagePath: 'fixtures/not-exist.png',
    ocrEngine: 'tesseract'
  });
  assert(result.success === true, '结构化清洗继续成功');
  assert(result.multimodal && result.multimodal.ocr && result.multimodal.ocr.error, 'OCR 失败记录错误');
  assert(result.warnings.some(w => w.includes('OCR')), '生成 OCR 失败 warning');
}

async function runMM007() {
  console.log('\nMM-007: ASR 失败（无效音频路径）');
  const data = {
    '客户姓名': '钱先生',
    '联系方式': '13500135000'
  };
  const result = await cleaner.cleanRecordAsync('customer', data, {}, {
    enableMultimodal: true,
    audioPath: 'fixtures/not-exist.mp3',
    asrEngine: 'whisper'
  });
  assert(result.success === true, '结构化清洗继续成功');
  assert(result.multimodal && result.multimodal.asr && result.multimodal.asr.error, 'ASR 失败记录错误');
  assert(result.warnings.some(w => w.includes('ASR')), '生成 ASR 失败 warning');
}

async function runMM008() {
  console.log('\nMM-008: CLIP 失败（图片不存在）');
  const data = {
    '发布标题': '日系清新亲子照',
    '所属平台': '小红书',
    '发布状态': '待制作',
    '成品文件': 'test.jpg'
  };
  const result = await cleaner.cleanRecordAsync('product', data, {}, {
    enableMultimodal: true,
    imagePath: 'fixtures/not-exist.png',
    clipEngine: 'python'
  });
  assert(result.success === true, '结构化清洗继续成功');
  assert(result.multimodal && result.multimodal.clip && result.multimodal.clip.error, 'CLIP 失败记录错误');
  assert(result.warnings.some(w => w.includes('CLIP')), '生成 CLIP 失败 warning');
}

async function runRegression() {
  console.log('\n原有引擎回归测试...');
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const cmd = 'node src/data-cleaning/test-integration.js';
    exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        console.log(stdout);
        console.log(stderr);
        assert(false, '原有集成测试无失败');
        resolve();
        return;
      }
      console.log(stdout);
      assert(true, '原有集成测试无失败');
      resolve();
    });
  });
}

async function runAllTests() {
  try {
    await runMM001();
    await runMM002();
    await runMM003();
    await runMM004();
    await runMM005();
    await runMM006();
    await runMM007();
    await runMM008();
    await runRegression();
  } catch (err) {
    failed++;
    errors.push(`测试执行异常: ${err.message}`);
    console.log(`  ✗ 测试执行异常: ${err.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`多模态集成测试结果: 通过 ${passed} 项, 失败 ${failed} 项`);

  if (failed > 0) {
    console.log('\n失败项:');
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('\n所有多模态集成测试通过!');
    process.exit(0);
  }
}

runAllTests();
