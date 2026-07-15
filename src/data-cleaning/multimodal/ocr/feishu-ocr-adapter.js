/**
 * 飞书 OCR API 适配器（降级/云端方案）
 * 调用 lark-cli 实现图片文字识别：
 *   1. lark-cli drive +upload 上传图片获取 file_token
 *   2. lark-cli api POST /open-apis/drive/v1/medias/{file_token}/ocr 执行识别
 *   3. 解析返回的 data.content 提取文本
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function _getLarkCliCommand() {
  if (process.platform === 'win32') {
    return 'npx lark-cli.cmd';
  }
  return 'npx lark-cli';
}

function checkFeishuAvailable() {
  try {
    execSync(`${_getLarkCliCommand()} --version`, { stdio: 'ignore' });
    return { available: true };
  } catch (err) {
    return {
      available: false,
      message: 'lark-cli 未安装或不在 PATH 中'
    };
  }
}

function _writeTempJsonFile(data) {
  const tempDir = os.tmpdir();
  const tempName = `feishu-ocr-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.json`;
  const tempPath = path.join(tempDir, tempName);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  return tempPath;
}

function _cleanupTempFile(tempPath) {
  try {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch (e) {
    // 忽略清理错误
  }
}

function _parseJsonStdout(stdout, label) {
  const trimmed = (stdout || '').trim();
  let result;
  try {
    result = JSON.parse(trimmed);
  } catch (parseErr) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      result = JSON.parse(match[0]);
    } else {
      throw new Error(`${label}返回内容无法解析为 JSON: ${trimmed.substring(0, 200)}`);
    }
  }
  return result;
}

/**
 * 调用 lark-cli api（JSON body 场景）
 */
function _callLarkApi(method, urlPath, params, timeout) {
  const larkCmd = _getLarkCliCommand();
  const tempPath = _writeTempJsonFile(params || {});
  try {
    const cmd = `${larkCmd} api ${method} "${urlPath}" --as user --data @"${tempPath}"`;
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout || 30000,
      killSignal: 'SIGTERM'
    });

    const result = _parseJsonStdout(stdout, 'lark-cli api');

    if (result.code !== undefined && result.code !== 0) {
      throw new Error(`飞书 API 调用失败: code=${result.code}, msg=${result.msg || 'unknown'}`);
    }
    return result.data || result;
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new Error(`lark-cli 调用超时（${timeout || 30000}ms）：${method} ${urlPath}`);
    }
    if (err.stderr) {
      throw new Error(`lark-cli 调用失败: ${err.message}, stderr: ${err.stderr.substring(0, 500)}`);
    }
    throw err;
  } finally {
    _cleanupTempFile(tempPath);
  }
}

/**
 * 上传图片文件获取 file_token
 * 使用 lark-cli drive +upload（项目已验证可用的上传方式）
 */
function _uploadImage(absPath, timeout) {
  const larkCmd = _getLarkCliCommand();
  const cmd = `${larkCmd} drive +upload --file "${absPath}" --parent-type CCM_IMPORT_OPEN --as user`;

  let stdout;
  try {
    stdout = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout,
      killSignal: 'SIGTERM',
      maxBuffer: 50 * 1024 * 1024
    });
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new Error(`图片上传超时（${timeout}ms）：${absPath}`);
    }
    const stderr = err.stderr ? err.stderr.substring(0, 500) : '';
    throw new Error(`图片上传失败：${err.message}${stderr ? `, stderr: ${stderr}` : ''}`);
  }

  const response = _parseJsonStdout(stdout, '图片上传');

  // 兼容多种返回格式（code/ok 两种风格）
  const codeOk = (response.code === undefined || response.code === 0) && response.ok !== false;
  if (!codeOk && response.ok !== true) {
    throw new Error(`图片上传 API 错误: code=${response.code}, msg=${response.msg || 'unknown'}`);
  }

  const fileToken = (response.data && (response.data.fileToken || response.data.file_token)) ||
                    response.fileToken ||
                    response.file_token;
  if (!fileToken) {
    throw new Error(`图片上传失败：未获取到 file_token，返回：${JSON.stringify(response).substring(0, 300)}`);
  }
  return fileToken;
}

/**
 * 从图片中提取文字（飞书 OCR）
 * @param {string} imagePath 图片绝对或相对路径
 * @param {object} options 配置项（timeout 可选）
 * @returns {Promise<{text: string, confidence: number, engine: string, blocks: string[]}>}
 */
async function extractText(imagePath, options = {}) {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`图片文件不存在：${absPath}`);
  }

  const check = checkFeishuAvailable();
  if (!check.available) {
    throw new Error(check.message);
  }

  const timeout = options.timeout || 30000;

  try {
    // Step 1: 上传图片获取 file_token
    const fileToken = _uploadImage(absPath, timeout);

    // Step 2: 调用 OCR 识别接口
    const ocrResult = _callLarkApi(
      'POST',
      `/open-apis/drive/v1/medias/${fileToken}/ocr`,
      { file_token: fileToken },
      timeout
    );

    // Step 3: 解析识别结果
    // 飞书 OCR 返回格式：{ content: [{ type: "text", text: "..." }] }
    const content = (ocrResult && ocrResult.content) || [];
    const textBlocks = [];
    for (const item of content) {
      if (item && item.type === 'text' && item.text) {
        const lines = item.text.split('\n').map(l => l.trim()).filter(l => l);
        textBlocks.push(...lines);
      }
    }

    return {
      text: textBlocks.join('\n'),
      confidence: 0.85, // 飞书 OCR 不返回置信度，使用固定值
      engine: 'feishu',
      blocks: textBlocks
    };
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new Error(`飞书 OCR 调用超时（${timeout}ms）`);
    }
    throw err;
  }
}

module.exports = {
  extractText,
  checkFeishuAvailable
};
