// TEMP: Lane B 真实 OCR 测试 (Tesseract) | 2026-07-26 | 2026-07-29
// 验证 TesseractOcrEngine 可用性，满足 AC-04 真实 OCR 至少一条
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

// 设置 TESSDATA_PREFIX 到 OS temp（防止污染 worktree）
const TMP_DIR = join(process.env.LOCALAPPDATA || '/tmp', 'Temp', 'famp-r3-e2e-flow-01');
const TESSDATA_PREFIX = join(TMP_DIR, 'tessdata');
mkdirSync(TESSDATA_PREFIX, { recursive: true });
process.env.TESSDATA_PREFIX = TESSDATA_PREFIX;

async function main() {
  console.log('=== Lane B 真实 OCR 测试 (Tesseract) ===\n');
  console.log(`TESSDATA_PREFIX: ${TESSDATA_PREFIX}\n`);

  // 动态导入（确保环境变量先设置）
  const { TesseractOcrEngine } = await import('../../src/ocr/tesseract-ocr-engine.js');

  // 选择测试图片
  const candidates = [
    'D:\\360Downloads\\Trae 项目\\lark\\collator\\public\\temp_images\\Jiaaq_报价_4.jpg',
    'D:\\360Downloads\\Trae 项目\\lark\\collator\\public\\temp_images\\佐伊_报价_2.jpg',
    'D:\\360Downloads\\Trae 项目\\lark\\collator\\public\\temp_images\\Jiaaq_作品_5.jpg',
  ];

  let imagePath: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      imagePath = p;
      break;
    }
  }
  if (!imagePath) {
    throw new Error('未找到测试图片');
  }

  const imageBuffer = readFileSync(imagePath);
  const imageHash = createHash('sha256').update(imageBuffer).digest('hex').substring(0, 12);
  console.log(`1. 测试图片:`);
  console.log(`   路径: ${imagePath}`);
  console.log(`   文件名: ${imagePath.split('\\').pop()}`);
  console.log(`   大小: ${imageBuffer.length} bytes`);
  console.log(`   SHA256 前缀: sha256:${imageHash}\n`);

  // 创建 TesseractOcrEngine 实例
  const engine = new TesseractOcrEngine({
    lang: 'chi_sim+eng',
    timeoutMs: 180000, // 3 分钟（首次下载语言数据）
    maxRetries: 1,
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxDimension: 10000,
  });

  console.log(`2. OCR 引擎配置:`);
  console.log(`   引擎名: ${engine.engine}`);
  console.log(`   版本: ${engine.ocr_version}`);
  console.log(`   语言: chi_sim+eng`);
  console.log(`   超时: 180000ms\n`);

  console.log(`3. 执行 OCR（首次可能需要下载语言数据，请等待）...\n`);
  const startTime = Date.now();
  try {
    const result = await engine.extract(imageBuffer);
    const duration = Date.now() - startTime;

    console.log(`4. OCR 结果:`);
    console.log(`   引擎: ${result.engine}`);
    console.log(`   版本: ${result.ocr_version}`);
    console.log(`   置信度: ${result.confidence.toFixed(4)}`);
    console.log(`   文本块数: ${result.text_blocks.length}`);
    console.log(`   原始文本长度: ${result.raw_text.length} 字符`);
    console.log(`   处理时间: ${new Date(result.processed_at).toISOString()}`);
    console.log(`   耗时: ${duration}ms\n`);

    // 脱敏输出文本摘要（不输出完整文本，只输出前 200 字符 + 统计）
    const rawText = result.raw_text;
    const textPreview = rawText.substring(0, 200);
    const hasChinese = /[\u4e00-\u9fff]/.test(rawText);
    const hasDigits = /\d/.test(rawText);
    const hasPrice = /[¥￥]?\s*\d+[.,]?\d*/.test(rawText);

    console.log(`5. 文本摘要（脱敏）:`);
    console.log(`   包含中文: ${hasChinese ? '✓' : '✗'}`);
    console.log(`   包含数字: ${hasDigits ? '✓' : '✗'}`);
    console.log(`   包含价格模式: ${hasPrice ? '✓' : '✗'}`);
    console.log(`   文本预览（前 200 字符）: ${textPreview.replace(/\n/g, ' ').substring(0, 200)}...\n`);

    // 输出文本块类型统计
    const blockTypes: Record<string, number> = {};
    for (const block of result.text_blocks) {
      blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
    }
    console.log(`6. 文本块类型统计:`);
    for (const [type, count] of Object.entries(blockTypes)) {
      console.log(`   ${type}: ${count}`);
    }

    // 结论
    const ocrSuccess = result.confidence > 0 && rawText.length > 0;
    console.log(`\n7. 结论:`);
    console.log(`   Tesseract OCR 引擎可用: ${ocrSuccess ? '✓' : '✗'}`);
    console.log(`   置信度 > 0: ${result.confidence > 0 ? '✓' : '✗'}`);
    console.log(`   识别文本非空: ${rawText.length > 0 ? '✓' : '✗'}`);
    console.log(`   AC-04 真实 OCR: ${ocrSuccess ? '✅ PASS' : '❌ FAIL'}\n`);

    // 输出脱敏 JSON
    const output = {
      test_time: new Date().toISOString(),
      engine: result.engine,
      ocr_version: result.ocr_version,
      image: {
        filename: imagePath.split('\\').pop(),
        size_bytes: imageBuffer.length,
        sha256_prefix: `sha256:${imageHash}`,
      },
      ocr_result: {
        confidence: result.confidence,
        text_blocks_count: result.text_blocks.length,
        raw_text_length: rawText.length,
        has_chinese: hasChinese,
        has_digits: hasDigits,
        has_price_pattern: hasPrice,
        text_preview_desensitized: textPreview.substring(0, 100),
      },
      duration_ms: duration,
      ac_04_status: ocrSuccess ? 'PASS' : 'FAIL',
      tessdata_prefix: TESSDATA_PREFIX,
    };

    const outputPath = join(TMP_DIR, 'lane-b-tesseract-ocr-result.json');
    const { writeFileSync } = await import('fs');
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`脱敏结果已写入: ${outputPath}`);

    if (!ocrSuccess) {
      process.exit(1);
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`\nOCR 失败 (耗时 ${duration}ms):`, err instanceof Error ? err.message : err);
    console.error(`AC-04 真实 OCR: ❌ FAIL`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
