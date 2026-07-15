/**
 * 飞书妙记 API 适配器
 * 上传音频到飞书妙记，获取转写结果
 *
 * 调用流程：
 *   1. 上传音频文件 → 获取 file_token
 *   2. 创建妙记     → 获取 minute_id
 *   3. 轮询转写状态 → 等待 completed
 *   4. 获取转写结果 → 解析 text / segments
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// 可 mock 的依赖容器（测试用：覆盖 _deps.execSync / _deps.sleep 即可隔离外部调用）
const _deps = {
  execSync: execSync,
  sleep: function (ms) {
    // Windows 下用 ping 实现同步等待（整个调用链为同步 execSync）
    try {
      execSync(`ping -n ${Math.ceil(ms / 1000)} 127.0.0.1 > nul`, { stdio: 'ignore' });
    } catch (e) {
      // 忽略 ping 错误
    }
  }
};

function checkFeishuAvailable() {
  try {
    _deps.execSync('lark-cli --version', { stdio: 'ignore' });
    return { available: true };
  } catch (err) {
    return {
      available: false,
      message: 'lark-cli 未安装或不在 PATH 中'
    };
  }
}

function _getLarkCliCommand() {
  if (process.platform === 'win32') {
    return 'npx lark-cli.cmd';
  }
  return 'npx lark-cli';
}

function _writeTempJsonFile(data) {
  const tempDir = os.tmpdir();
  const tempName = `feishu-minutes-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.json`;
  const tempPath = path.join(tempDir, tempName);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  return tempPath;
}

function _cleanupTempFile(tempPath) {
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch (e) {
    // 忽略清理错误
  }
}

function _callLarkApi(method, urlPath, params, timeout) {
  const larkCmd = _getLarkCliCommand();
  const tempPath = params && Object.keys(params).length > 0 ? _writeTempJsonFile(params) : null;
  try {
    let cmd = `${larkCmd} api ${method} "${urlPath}" --as user`;
    if (tempPath) {
      cmd += ` --data @"${tempPath}"`;
    }
    const stdout = _deps.execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout || 30000,
      killSignal: 'SIGTERM'
    });
    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch (parseErr) {
      const match = stdout.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        throw new Error(`lark-cli 返回内容无法解析为 JSON: ${stdout.substring(0, 200)}`);
      }
    }
    if (result.code !== 0) {
      throw new Error(`飞书 API 调用失败: code=${result.code}, msg=${result.msg || 'unknown'}`);
    }
    return result.data || result;
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new Error(`lark-cli 调用超时（${timeout || 30000}ms）：${method} ${urlPath}`);
    }
    throw err;
  } finally {
    if (tempPath) _cleanupTempFile(tempPath);
  }
}

/**
 * 上传音频文件，返回 file_token
 */
function _uploadAudioFile(absPath, timeout) {
  const uploadCmd = `${_getLarkCliCommand()} drive upload --file "${absPath}" --file_type opus --parent_type CCM_IMPORT_OPEN`;
  let stdout;
  try {
    stdout = _deps.execSync(uploadCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout,
      killSignal: 'SIGTERM'
    });
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new Error(`音频上传超时（${timeout}ms）`);
    }
    throw new Error(`音频上传失败：${err.message}`);
  }

  let uploadResult;
  try {
    uploadResult = JSON.parse(stdout.trim());
  } catch (parseErr) {
    throw new Error(`音频上传响应解析失败：${stdout.substring(0, 200)}`);
  }
  const fileToken = uploadResult.file_token || (uploadResult.data && uploadResult.data.file_token);
  if (!fileToken) {
    throw new Error(`音频上传失败：未获取到 file_token，返回：${JSON.stringify(uploadResult)}`);
  }
  return fileToken;
}

async function transcribe(audioPath, options = {}) {
  const absPath = path.resolve(audioPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`音频文件不存在：${absPath}`);
  }

  // 通过 module.exports 引用，便于测试时 mock
  const check = module.exports.checkFeishuAvailable();
  if (!check.available) {
    throw new Error(check.message);
  }

  const timeout = options.timeout || 30000;
  const pollInterval = options.pollInterval || 5000;
  const pollTimeout = options.pollTimeout || 300000;
  const fileName = path.basename(absPath);

  // Step 1: 上传音频文件
  const fileToken = _uploadAudioFile(absPath, timeout);

  // Step 2: 创建妙记
  const minuteData = {
    topic: fileName,
    file_token: fileToken
  };
  const minuteResult = _callLarkApi('POST', '/open-apis/minutes/v1/minutes', minuteData, timeout);
  const minuteId = (minuteResult.minute && minuteResult.minute.minute_id) || minuteResult.minute_id;
  if (!minuteId) {
    throw new Error(`创建妙记失败：未获取到 minute_id，返回：${JSON.stringify(minuteResult)}`);
  }

  // Step 3: 轮询转写状态
  const startTime = Date.now();
  let minuteStatus;
  while (true) {
    if (Date.now() - startTime > pollTimeout) {
      throw new Error(`飞书妙记转写超时（${pollTimeout}ms）`);
    }

    const statusResult = _callLarkApi('GET', `/open-apis/minutes/v1/minutes/${minuteId}`, {}, timeout);
    minuteStatus = (statusResult.minute && statusResult.minute.status) || statusResult.status;

    if (minuteStatus === 'completed' || minuteStatus === 'finished') {
      break;
    }
    if (minuteStatus === 'failed' || minuteStatus === 'error') {
      throw new Error(`飞书妙记转写失败：状态=${minuteStatus}`);
    }

    // 等待下一轮轮询
    _deps.sleep(pollInterval);
  }

  // Step 4: 获取转写结果
  const transcriptResult = _callLarkApi('GET', `/open-apis/minutes/v1/minutes/${minuteId}/transcripts`, {}, timeout);

  // 解析转写结果（飞书妙记返回格式可能为 { transcript: {...} } 或 { data: {...} } 或直接平铺）
  const transcript = transcriptResult.transcript || transcriptResult.data || transcriptResult;
  const fullText = transcript.text || transcript.content || '';
  const segments = transcript.segments || [];

  // 转换 segments 格式，统一输出字段
  const formattedSegments = segments.map(seg => ({
    start: seg.start_time || seg.start || 0,
    end: seg.end_time || seg.end || 0,
    text: seg.text || seg.content || '',
    speaker: seg.speaker || seg.speaker_id || null
  })).filter(seg => seg.text);

  return {
    text: fullText,
    confidence: 0.85, // 飞书不返回置信度，使用固定值
    segments: formattedSegments
  };
}

module.exports = {
  transcribe,
  checkFeishuAvailable,
  _deps
};
