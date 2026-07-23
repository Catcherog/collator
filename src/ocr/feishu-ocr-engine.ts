/**
 * Workstream B — 飞书 OCR 引擎（真实实现）
 *
 * 实现 ScreenshotOcrEngine（Buffer 输入 → OcrResult 输出），底层通过 lark-cli
 * 调用飞书 OCR API（lark-cli 自管鉴权 → 无需在 OcrConfig 配置凭据）。
 *
 * 说明（架构决策）：现有 src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js
 * 为 CJS 模块；import-ban 测试禁止从 src/ 直接 import data-cleaning，且其依赖
 * 裸 npm 包与 execSync，无法经 legacy-module-loader 加载。故本引擎以该 CJS
 * 适配器为参考在 ESM TypeScript 中等价重写：Buffer → 临时文件 → lark-cli
 * drive +upload 上传获取 file_token → lark-cli api POST OCR → 解析 → 清理。
 * 算法、超时、命令行与既有实现对齐。
 *
 * AC-B04：空/损坏/超大/不支持类型 → fail closed。
 * AC-B07：仅记录安全摘要，file_token 做最小化校验后用于 URL（防注入）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, type ExecException } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScreenshotOcrEngine, OcrResult, OcrOptions } from '../server/services/screenshot-ocr-adapter.js';
import { validateImageBuffer, type ImageType } from './image-validation.js';
import { OcrError, mapProviderError } from './ocr-errors.js';
import { buildOcrResult } from './ocr-result-mapper.js';
import { getOcrLogger, safeResultSummary, type OcrLogger } from './ocr-logger.js';

const execAsync = promisify(exec);

/** lark-cli 命令（win32 需 .cmd 后缀，与既有 feishu-ocr-adapter.js 一致）。 */
function larkCli(): string {
  return process.platform === 'win32' ? 'npx lark-cli.cmd' : 'npx lark-cli';
}

/** 可注入的命令执行器（测试可替换为确定性 fake，避免真实 lark-cli 副作用）。 */
export type LarkCommandRunner = (cmd: string, timeoutMs: number) => Promise<string>;

export interface FeishuOcrEngineOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxFileSizeBytes?: number;
  maxDimension?: number;
  logger?: OcrLogger;
  /** 测试钩子：注入命令执行器。 */
  commandRunner?: LarkCommandRunner;
}

const EXT_BY_TYPE: Record<ImageType, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
};

export class FeishuOcrEngine implements ScreenshotOcrEngine {
  readonly engine = 'feishu';
  readonly ocr_version = 'feishu-ocr-v1';

  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxFileSizeBytes: number;
  private readonly maxDimension: number;
  private readonly logger: OcrLogger;
  private readonly runCmd: LarkCommandRunner;

  constructor(opts: FeishuOcrEngineOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxFileSizeBytes = opts.maxFileSizeBytes ?? 10 * 1024 * 1024;
    this.maxDimension = opts.maxDimension ?? 10000;
    this.logger = opts.logger ?? getOcrLogger();
    this.runCmd = opts.commandRunner ?? defaultCommandRunner;
  }

  async extract(buffer: Buffer, _options?: OcrOptions): Promise<OcrResult> {
    // AC-B04：先校验输入（fail closed，不调用 lark-cli）
    const image = validateImageBuffer(buffer, {
      maxFileSizeBytes: this.maxFileSizeBytes,
      maxDimension: this.maxDimension,
    });

    const startedAt = Date.now();
    const duration = () => Date.now() - startedAt;

    let attempt = 0;
    while (true) {
      try {
        const result = await this.runOcrPipeline(buffer, image.type);
        this.logger.info('Feishu OCR succeeded', {
          ...safeResultSummary(result),
          durationMs: duration(),
        });
        return result;
      } catch (err) {
        const mapped = err instanceof OcrError ? err : mapProviderError('Feishu', err);

        if (!mapped.retryable) {
          this.logger.error('Feishu OCR failed (non-retryable)', {
            code: mapped.code,
            durationMs: duration(),
          });
          throw mapped;
        }

        attempt++;
        if (attempt > this.maxRetries) {
          const exhausted = new OcrError(
            'OCR_RETRY_EXHAUSTED',
            `Feishu OCR failed after ${this.maxRetries + 1} attempts: ${mapped.message}`,
            { cause: mapped },
          );
          this.logger.error('Feishu OCR retries exhausted', {
            code: exhausted.code,
            durationMs: duration(),
          });
          throw exhausted;
        }

        this.logger.warn('Feishu OCR retryable error, retrying', {
          attempt,
          code: mapped.code,
        });
        await sleep(300 * attempt);
      }
    }
  }

  /** 完整管线：临时文件 → 上传 → OCR API → 解析映射 → 清理。 */
  private async runOcrPipeline(buffer: Buffer, type: ImageType): Promise<OcrResult> {
    const tempPath = await this.writeTempImage(buffer, type);
    try {
      const fileToken = await this.uploadImage(tempPath);
      const ocrContent = await this.callOcrApi(fileToken);
      const text = ocrContent.join('\n');
      return buildOcrResult({
        engine: this.engine,
        ocrVersion: this.ocr_version,
        rawText: text.trim(),
        // 飞书 OCR 不返回置信度，与既有 feishu-ocr-adapter.js 一致使用固定值
        confidence: 0.85,
      });
    } finally {
      cleanupFile(tempPath);
    }
  }

  private async writeTempImage(buffer: Buffer, type: ImageType): Promise<string> {
    const tempDir = os.tmpdir();
    const name = `feishu-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${EXT_BY_TYPE[type]}`;
    const tempPath = path.join(tempDir, name);
    await fs.promises.writeFile(tempPath, buffer);
    return tempPath;
  }

  private async uploadImage(absPath: string): Promise<string> {
    const cmd = `${larkCli()} drive +upload --file "${absPath}" --parent-type CCM_IMPORT_OPEN --as user`;
    const stdout = await this.runCmd(cmd, this.timeoutMs);
    const response = parseJsonStdout(stdout, 'Feishu upload');

    const codeOk = (response.code === undefined || response.code === 0) && response.ok !== false;
    if (!codeOk) {
      throw new OcrError(
        'OCR_PROVIDER_ERROR',
        `Feishu upload API error: code=${response.code}, msg=${response.msg ?? 'unknown'}`,
      );
    }

    const fileToken =
      (response.data && (response.data.fileToken || response.data.file_token)) ??
      response.fileToken ??
      response.file_token;

    if (typeof fileToken !== 'string' || !/^[A-Za-z0-9_-]+$/.test(fileToken)) {
      throw new OcrError(
        'OCR_PROVIDER_ERROR',
        `Feishu upload returned invalid file_token: ${redactToken(fileToken)}`,
      );
    }
    return fileToken;
  }

  private async callOcrApi(fileToken: string): Promise<string[]> {
    // file_token 已通过白名单校验，可安全拼入 URL（防注入）
    const urlPath = `/open-apis/drive/v1/medias/${fileToken}/ocr`;
    const dataTempPath = await this.writeTempJson({ file_token: fileToken });
    try {
      const cmd = `${larkCli()} api POST "${urlPath}" --as user --data @"${dataTempPath}"`;
      const stdout = await this.runCmd(cmd, this.timeoutMs);
      const result = parseJsonStdout(stdout, 'Feishu OCR API');

      if (result.code !== undefined && result.code !== 0) {
        throw new OcrError(
          'OCR_PROVIDER_ERROR',
          `Feishu OCR API error: code=${result.code}, msg=${result.msg ?? 'unknown'}`,
        );
      }

      const ocrResult = result.data ?? result;
      const content = (ocrResult && ocrResult.content) ?? [];
      const blocks: string[] = [];
      for (const item of content) {
        if (item && item.type === 'text' && typeof item.text === 'string') {
          const lines = item.text
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 0);
          blocks.push(...lines);
        }
      }
      return blocks;
    } finally {
      cleanupFile(dataTempPath);
    }
  }

  private async writeTempJson(data: unknown): Promise<string> {
    const tempDir = os.tmpdir();
    const name = `feishu-ocr-data-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
    const tempPath = path.join(tempDir, name);
    await fs.promises.writeFile(tempPath, JSON.stringify(data), 'utf-8');
    return tempPath;
  }
}

/** 默认命令执行器：使用 child_process.exec，支持超时。 */
async function defaultCommandRunner(cmd: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      killSignal: 'SIGTERM',
    });
    return stdout;
  } catch (err) {
    const e = err as ExecException & { stderr?: string; stdout?: string };
    if (e.signal === 'SIGTERM' || e.killed) {
      throw new OcrError('OCR_TIMEOUT', `lark-cli call timed out after ${timeoutMs}ms`);
    }
    const stderr = e.stderr ? e.stderr.slice(0, 500) : '';
    throw new OcrError(
      'OCR_PROVIDER_ERROR',
      `lark-cli call failed: ${e.message}${stderr ? `, stderr: ${stderr}` : ''}`,
    );
  }
}

function parseJsonStdout(stdout: string, label: string): Record<string, any> {
  const trimmed = (stdout ?? '').trim();
  let result: Record<string, any>;
  try {
    result = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new OcrError(
        'OCR_PROVIDER_ERROR',
        `${label} returned non-JSON output: ${trimmed.slice(0, 200)}`,
      );
    }
    result = JSON.parse(match[0]);
  }
  return result;
}

function cleanupFile(tempPath: string): void {
  try {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch {
    // 忽略清理错误
  }
}

function redactToken(token: unknown): string {
  if (typeof token !== 'string') return '<non-string>';
  return token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '<redacted>';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
