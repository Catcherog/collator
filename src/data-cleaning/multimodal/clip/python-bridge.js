/**
 * CLIP Python 推理桥接
 * Node.js 通过子进程调用 Python open-clip-torch 服务
 */

const { spawn } = require('child_process');
const path = require('path');

function checkPythonAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-c', 'import open_clip, torch, PIL; print("ok")'], { stdio: 'ignore' });
    proc.on('close', code => resolve(code === 0));
  });
}

async function computeSimilarity(imagePath, texts, options = {}) {
  const available = await checkPythonAvailable();
  if (!available) {
    throw new Error('Python CLIP 环境未安装。请运行：pip install open-clip-torch torch pillow');
  }

  const scriptPath = path.join(__dirname, 'clip_service.py');
  return new Promise((resolve, reject) => {
    const args = [scriptPath, path.resolve(imagePath), JSON.stringify(texts)];
    const proc = spawn('python', args, { encoding: 'utf-8' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', data => { stdout += data; });
    proc.stderr.on('data', data => { stderr += data; });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`CLIP 推理失败：${stderr || stdout}`));
        return;
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const result = JSON.parse(lines[lines.length - 1]);
        resolve(result);
      } catch (err) {
        reject(new Error(`解析 CLIP 输出失败：${stdout}`));
      }
    });
  });
}

async function checkImageTextMatch(imagePath, title, copy, options = {}) {
  const texts = [title, copy, `${title || ''} ${copy || ''}`.trim()].filter(Boolean);
  if (texts.length === 0) {
    throw new Error('标题和文案不能同时为空');
  }

  const result = await computeSimilarity(imagePath, texts, options);
  const threshold = options.threshold || 0.6;

  return {
    matched: result.bestScore >= threshold,
    score: result.bestScore,
    bestText: texts[result.bestMatch],
    similarities: result.similarities,
    texts,
    engine: 'python'
  };
}

module.exports = {
  checkPythonAvailable,
  computeSimilarity,
  checkImageTextMatch
};
