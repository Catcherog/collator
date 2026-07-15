/**
 * 微信语音格式转换器
 * 将 .silk (Silk V3) 转换为 .wav 或 .mp3
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function isSilkFile(filePath) {
  return path.extname(filePath).toLowerCase() === '.silk';
}

function convertSilkToWav(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`silk 文件不存在：${inputPath}`);
  }

  // 方案 1：使用 silk-v3-decoder（需自行编译或下载可执行文件）
  // 方案 2：使用 FFmpeg 降级（可能不支持 silk，需先解码为 pcm）
  try {
    execSync(`silk-v3-decoder "${inputPath}" "${outputPath}"`, { stdio: 'ignore' });
    return outputPath;
  } catch (err) {
    throw new Error(`silk 转换失败：${err.message}。请确保 silk-v3-decoder 已安装，或先手动转换为 wav。`);
  }
}

module.exports = {
  isSilkFile,
  convertSilkToWav
};
