/**
 * 本地 Whisper / faster-whisper 适配器
 * 通过 Python 子进程调用 faster-whisper 进行转写
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function checkWhisperAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-c', 'import faster_whisper; print("ok")'], { stdio: 'ignore' });
    proc.on('close', code => resolve(code === 0));
  });
}

async function transcribe(audioPath, options = {}) {
  const absPath = path.resolve(audioPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`音频文件不存在：${absPath}`);
  }

  const available = await checkWhisperAvailable();
  if (!available) {
    throw new Error('faster-whisper 未安装。请运行：pip install faster-whisper');
  }

  const modelSize = options.modelSize || 'small';
  const language = options.language || 'zh';

  return new Promise((resolve, reject) => {
    const args = [
      '-c',
      `
import json
import faster_whisper
model = faster_whisper.WhisperModel("${modelSize}", device="cpu", compute_type="int8")
segments, info = model.transcribe("${absPath.replace(/\\/g, '\\\\')}", language="${language}", beam_size=5)
text = " ".join([s.text for s in segments]).strip()
result = {"text": text, "language": info.language, "duration": info.duration}
print(json.dumps(result, ensure_ascii=False))
      `.trim()
    ];

    const proc = spawn('python', args, { encoding: 'utf-8' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', data => { stdout += data; });
    proc.stderr.on('data', data => { stderr += data; });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Whisper 转写失败：${stderr || stdout}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim().split('\n').pop());
        resolve({
          text: result.text || '',
          confidence: 0.85,
          engine: 'whisper',
          language: result.language,
          duration: result.duration
        });
      } catch (err) {
        reject(new Error(`解析 Whisper 输出失败：${stdout}`));
      }
    });
  });
}

module.exports = {
  transcribe,
  checkWhisperAvailable
};
