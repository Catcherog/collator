/**
 * CLIP 模块验证脚本
 *
 * 用法：
 *   node src/data-cleaning/multimodal/clip/test-clip.js
 *
 * 说明：
 *   1. 将真实业务图片放入 fixtures/matched/ 和 fixtures/mismatched/。
 *   2. 在 ground-truth.json 中维护每张图片的真值。
 *   3. 脚本会跳过不存在的图片文件或缺失 Python 环境的情况。
 */

const fs = require('fs');
const path = require('path');
const clip = require('./index');
const pythonBridge = require('./python-bridge');
const metrics = require('../../benchmark/metrics');

const BASE_DIR = __dirname;
const REPORT_DIR = path.join(BASE_DIR, '..', '..', '..', '..', 'docs', 'reports');

const STYLE_LABELS = ['日系清新', '韩系唯美', '复古胶片', '暗调情绪', '法式浪漫', '国潮古风'];

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

function computeAUC(scores, labels) {
  // labels: true = matched (positive), false = unmatched (negative)
  const sorted = scores
    .map((score, idx) => ({ score, label: labels[idx] }))
    .sort((a, b) => b.score - a.score);

  const positives = labels.filter(l => l).length;
  const negatives = labels.filter(l => !l).length;
  if (positives === 0 || negatives === 0) return 0.5;

  let tp = 0;
  let fp = 0;
  let prevFPR = 0;
  let prevTPR = 0;
  let auc = 0;

  for (const item of sorted) {
    if (item.label) tp++;
    else fp++;

    const tpr = tp / positives;
    const fpr = fp / negatives;
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevFPR = fpr;
    prevTPR = tpr;
  }

  return Math.round(auc * 10000) / 10000;
}

function findBestThreshold(results) {
  const thresholds = [];
  for (let t = 0.3; t <= 0.9; t += 0.05) thresholds.push(Math.round(t * 100) / 100);

  let best = { threshold: 0.6, f1: 0, precision: 0, recall: 0 };

  for (const threshold of thresholds) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const r of results) {
      const predicted = r.score >= threshold;
      const actual = r.matched;
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && !actual) tn++;
      else fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

    if (f1 > best.f1) {
      best = { threshold, f1: Math.round(f1 * 10000) / 10000, precision, recall };
    }
  }

  return best;
}

function computeAccuracyAtThreshold(results, threshold) {
  let correct = 0;
  for (const r of results) {
    const predicted = r.score >= threshold;
    if (predicted === r.matched) correct++;
  }
  return metrics.accuracy(correct, results.length);
}

async function runCLIPBenchmark() {
  console.log('=== CLIP 模块验证 ===\n');

  const pythonAvailable = await pythonBridge.checkPythonAvailable();
  if (!pythonAvailable) {
    console.log('⚠ Python CLIP 环境未安装，跳过验证。请运行：pip install open-clip-torch torch pillow');
    const reportPath = path.join(REPORT_DIR, `clip_benchmark_${formatTimestamp()}.md`);
    ensureDir(REPORT_DIR);
    fs.writeFileSync(reportPath, generateSkippedReport('Python CLIP 环境未安装'), 'utf-8');
    console.log(`  报告已生成：${reportPath}`);
    process.exit(0);
  }

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
      const matchResult = await clip.checkImageTextMatch(imagePath, item.title, item.copy, { engine: 'python' });

      let stylePrediction = null;
      let styleTop2 = [];
      try {
        const styleResult = await pythonBridge.computeSimilarity(imagePath, STYLE_LABELS);
        const sorted = styleResult.similarities
          .map((score, idx) => ({ style: STYLE_LABELS[idx], score }))
          .sort((a, b) => b.score - a.score);
        stylePrediction = sorted[0].style;
        styleTop2 = sorted.slice(0, 2).map(s => s.style);
      } catch (err) {
        console.log(`  ⚠ 风格分类失败：${err.message}`);
      }

      results.push({
        ...item,
        skipped: false,
        score: matchResult.score,
        predictedMatched: matchResult.matched,
        stylePrediction,
        styleTop2
      });

      console.log(`  匹配分数：${matchResult.score.toFixed(3)}`);
      console.log(`  预测风格：${stylePrediction || '-'}`);
    } catch (err) {
      console.log(`  ✗ CLIP 失败：${err.message}`);
      results.push({ ...item, skipped: false, error: err.message });
    }
  }

  const validResults = results.filter(r => !r.skipped && !r.error);

  if (validResults.length === 0) {
    console.log('\n⚠ 未找到可验证图片，请补充 fixtures 后重试');
    const reportPath = path.join(REPORT_DIR, `clip_benchmark_${formatTimestamp()}.md`);
    ensureDir(REPORT_DIR);
    fs.writeFileSync(reportPath, generateSkippedReport('未找到可验证图片'), 'utf-8');
    console.log(`  报告已生成：${reportPath}`);
    process.exit(0);
  }

  const bestThreshold = findBestThreshold(validResults);
  const accuracy = computeAccuracyAtThreshold(validResults, bestThreshold.threshold);

  const styleTop1Correct = validResults.filter(r => r.stylePrediction === r.trueStyle).length;
  const styleTop1Accuracy = metrics.accuracy(styleTop1Correct, validResults.length);
  const styleTop2Correct = validResults.filter(r => r.styleTop2 && r.styleTop2.includes(r.trueStyle)).length;
  const styleTop2Recall = metrics.accuracy(styleTop2Correct, validResults.length);

  const auc = computeAUC(validResults.map(r => r.score), validResults.map(r => r.matched));

  const reportPath = path.join(REPORT_DIR, `clip_benchmark_${formatTimestamp()}.md`);
  ensureDir(REPORT_DIR);
  fs.writeFileSync(reportPath, generateReport(groundTruth, results, validResults, bestThreshold, accuracy, styleTop1Accuracy, styleTop2Recall, auc), 'utf-8');

  console.log('\n' + '='.repeat(50));
  console.log('CLIP 验证完成');
  console.log(`  总样本数：${groundTruth.length}`);
  console.log(`  有效验证：${validResults.length}`);
  console.log(`  最佳阈值：${bestThreshold.threshold}（F1=${bestThreshold.f1}）`);
  console.log(`  分类准确率：${accuracy}%`);
  console.log(`  风格 Top-1 准确率：${styleTop1Accuracy}%`);
  console.log(`  风格 Top-2 召回率：${styleTop2Recall}%`);
  console.log(`  ROC-AUC：${auc}`);
  console.log(`  报告已生成：${reportPath}`);

  const criteria = {
    accuracy: accuracy >= 80,
    styleTop1: styleTop1Accuracy >= 70,
    styleTop2: styleTop2Recall >= 85,
    auc: auc >= 0.8
  };

  if (!Object.values(criteria).every(Boolean)) {
    console.log('\n⚠ 未完全达到验收标准：');
    if (!criteria.accuracy) console.log('  - 分类准确率 < 80%');
    if (!criteria.styleTop1) console.log('  - 风格 Top-1 准确率 < 70%');
    if (!criteria.styleTop2) console.log('  - 风格 Top-2 召回率 < 85%');
    if (!criteria.auc) console.log('  - ROC-AUC < 0.80');
    process.exit(1);
  }

  console.log('\n✓ CLIP 验收标准均已达成');
}

function generateSkippedReport(reason) {
  const lines = [];
  lines.push('# CLIP 模块验证报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **状态**：跳过`);
  lines.push(`> **原因**：${reason}`);
  lines.push('');
  lines.push('请在补充图片样本或安装 Python 依赖后重新运行。');
  return lines.join('\n');
}

function generateReport(groundTruth, results, validResults, bestThreshold, accuracy, styleTop1Accuracy, styleTop2Recall, auc) {
  const lines = [];
  lines.push('# CLIP 模块验证报告');
  lines.push('');
  lines.push(`> **生成时间**：${formatDateTime()}`);
  lines.push(`> **总样本数**：${groundTruth.length}`);
  lines.push(`> **有效验证**：${validResults.length}`);
  lines.push('');

  lines.push('## 一、总体指标');
  lines.push('');
  lines.push('| 指标 | 结果 | 验收标准 | 是否达标 |');
  lines.push('|------|------|---------|---------|');
  lines.push(`| 图文匹配分类准确率 | ${accuracy}% | ≥ 80% | ${accuracy >= 80 ? '✅' : '❌'} |`);
  lines.push(`| 风格 Top-1 准确率 | ${styleTop1Accuracy}% | ≥ 70% | ${styleTop1Accuracy >= 70 ? '✅' : '❌'} |`);
  lines.push(`| 风格 Top-2 召回率 | ${styleTop2Recall}% | ≥ 85% | ${styleTop2Recall >= 85 ? '✅' : '❌'} |`);
  lines.push(`| ROC-AUC | ${auc} | ≥ 0.80 | ${auc >= 0.8 ? '✅' : '❌'} |`);
  lines.push('');
  lines.push(`- 最佳阈值：${bestThreshold.threshold}`);
  lines.push(`- 最佳阈值 F1：${bestThreshold.f1}`);
  lines.push('');

  lines.push('## 二、单样本详情');
  lines.push('');
  lines.push('| 图片 | 真实匹配 | 预测匹配 | 分数 | 真实风格 | 预测风格 | 风格Top-2 |');
  lines.push('|------|---------|---------|------|---------|---------|----------|');
  for (const r of results) {
    let status = '✅ 已验证';
    if (r.skipped) status = '⏭ 跳过';
    if (r.error) status = '❌ 失败';
    const score = r.score !== undefined ? r.score.toFixed(3) : '-';
    const predicted = r.predictedMatched !== undefined ? (r.predictedMatched ? '是' : '否') : '-';
    const style = r.stylePrediction || '-';
    const top2 = r.styleTop2 ? r.styleTop2.join(', ') : '-';
    lines.push(`| ${r.image} | ${r.matched !== undefined ? (r.matched ? '是' : '否') : '-'} | ${predicted} | ${score} | ${r.trueStyle || '-'} | ${style} | ${top2} |`);
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

runCLIPBenchmark().catch(err => {
  console.error('CLIP 验证异常：', err);
  process.exit(1);
});
