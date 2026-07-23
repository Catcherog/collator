// file-audit-repository.ts
// WORKSTREAM-D (Task D3): 基于 JSON Lines 的文件审计日志适配器。
//
// 持久化形态：每行一条 AuditLogRecord 的紧凑 JSON（JSONL）。append-only，简单、
// 无外部凭据、进程重启后可读（AC-D01）、可整文件复制备份（AC-D09）。
//
// 关键实现点：
// - 并发写（AC-D07）：进程内 promise 链互斥串行化所有 append，避免交错写损坏文件。
//   读操作（findByIngestionId / hasEventType）走 createReadStream + readline，
//   append-only 日志的读为一致性快照，读与写并发安全。
// - 幂等（AC-D02）：record() 先流读判定 (ingestion_id, event_type) 是否已存在，
//   已存在则返回已存在记录，不写重复行。读-判-写在同一互斥段内，进程内无 TOCTOU。
// - 失效模式（AC-D03）：写入失败 → failClosed=true 抛 AuditWriteError；
//   failClosed=false 记录警告并返回未持久化（已脱敏）记录。
// - 目录初始化（AC-D08）：首次写入前 mkdir(recursive)，缺失目录/文件自动创建。
// - PII 最小化（AC-D04）：持久化边界对 details 调用 redactDetails。
// - 有序性（AC-D05/D06）：findByIngestionId 按时间戳升序稳定排序（文件序为 tiebreak）。

import { createInterface } from 'node:readline';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AuditEventType,
  AuditLogRecord,
  AuditLogRepository,
} from '../../../audit/audit-log-repository.js';
import { redactDetails } from '../../../audit/audit-log-repository.js';
import type { AuditConfig } from '../../config/audit-config.js';

/**
 * 审计写入失败（failClosed=true 时抛出）。调用方可据此感知审计缺失，
 * 决定是否中止业务推进。AC-D03。
 */
export class AuditWriteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AuditWriteError';
  }
}

/**
 * 最小日志接口，避免硬依赖 pino。生产可由 Workstream E 传入 pino 适配器，
 * 测试可注入捕获型 logger。默认走 console.warn。
 */
export interface AuditLogger {
  warn(message: string, extra?: Record<string, unknown>): void;
}

const defaultLogger: AuditLogger = {
  warn(message, extra) {
    // eslint-disable-next-line no-console
    console.warn(`[audit] ${message}`, extra ?? '');
  },
};

export interface FileAuditRepositoryOptions {
  /** JSONL 文件路径。 */
  filePath: string;
  /** 写入失败重试次数（不含首次），默认 2。 */
  maxRetries?: number;
  /** 写入失败是否 fail-closed，默认 true。 */
  failClosed?: boolean;
  /** 警告日志器，默认 console.warn。 */
  logger?: AuditLogger;
}

/**
 * 从 AuditConfig 构造 FileAuditRepository。Workstream E 推荐入口：
 *   new FileAuditRepository.fromConfig(loadAuditConfig(process.env))
 */
export function createFileAuditRepository(config: AuditConfig, logger?: AuditLogger): FileAuditRepository {
  return new FileAuditRepository({
    filePath: config.filePath,
    maxRetries: config.maxRetries,
    failClosed: config.failClosed,
    logger,
  });
}

export class FileAuditRepository implements AuditLogRepository {
  private readonly filePath: string;
  private readonly maxRetries: number;
  private readonly failClosed: boolean;
  private readonly logger: AuditLogger;
  /** 串行化所有写操作的 promise 链（AC-D07 进程内互斥）。 */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: FileAuditRepositoryOptions) {
    this.filePath = options.filePath;
    this.maxRetries = options.maxRetries ?? 2;
    this.failClosed = options.failClosed ?? true;
    this.logger = options.logger ?? defaultLogger;
  }

  async record(event: AuditLogRecord): Promise<AuditLogRecord> {
    // 串行化整个读-判-写段，保证 (ingestion_id, event_type) 幂等在进程内无 TOCTOU。
    return this.enqueue(() => this.doRecord(event));
  }

  async findByIngestionId(ingestionId: string): Promise<AuditLogRecord[]> {
    const collected: AuditLogRecord[] = [];
    await this.streamRecords((record) => {
      if (record.ingestion_id === ingestionId) {
        collected.push(record);
      }
      return false; // 不提前退出
    });
    // 稳定排序：按 timestamp 升序，相同时间戳保持文件序（Array.sort 稳定）。
    return collected
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        if (a.r.timestamp < b.r.timestamp) return -1;
        if (a.r.timestamp > b.r.timestamp) return 1;
        return a.i - b.i;
      })
      .map((x) => x.r);
  }

  async hasEventType(ingestionId: string, eventType: AuditEventType): Promise<boolean> {
    let found = false;
    await this.streamRecords((record) => {
      if (record.ingestion_id === ingestionId && record.event_type === eventType) {
        found = true;
        return true; // 命中即提前退出
      }
      return false;
    });
    return found;
  }

  // ---- 内部实现 ----

  /**
   * 串行化任务入队。保证所有写操作顺序执行，失败不阻断后续写（chain 始终 resolve）。
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async doRecord(event: AuditLogRecord): Promise<AuditLogRecord> {
    // AC-D02: 先判定 (ingestion_id, event_type) 是否已记录。
    const existing = await this.findExisting(event.ingestion_id, event.event_type);
    if (existing) {
      // 返回已存在记录（首次写入时的 audit_id/timestamp），忽略本次入参。
      return existing;
    }

    // AC-D04: 持久化边界脱敏 + 深拷贝（不修改入参）。
    const stored: AuditLogRecord = {
      ...this.deepClone(event),
      details: redactDetails(event.details),
    };

    const line = JSON.stringify(stored) + '\n';
    try {
      await this.appendWithRetry(line);
    } catch (e) {
      if (this.failClosed) {
        // AC-D03 fail-closed：抛出让调用方感知审计缺失。
        throw new AuditWriteError(
          `Audit write failed for ${event.ingestion_id}/${event.event_type}: ${(e as Error)?.message ?? String(e)}`,
          e
        );
      }
      // AC-D03 degrade：记录警告并返回未持久化（已脱敏）记录。
      this.logger.warn('Audit write degraded (failClosed=false)', {
        ingestion_id: event.ingestion_id,
        event_type: event.event_type,
        error: (e as Error)?.message ?? String(e),
      });
    }
    return stored;
  }

  /**
   * 流读文件，对每条合法记录调用 visitor。visitor 返回 true 时提前关闭流。
   * 文件不存在（ENOENT）时安全返回空。非法 JSON 行被跳过（不抛错，保持读的韧性）。
   */
  private streamRecords(visitor: (record: AuditLogRecord) => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      let stream: ReadStream;
      try {
        stream = createReadStream(this.filePath, { encoding: 'utf8' });
      } catch {
        // 极少数同步抛错（如路径非法），按空结果处理。
        finish();
        return;
      }
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let aborted = false;

      const cleanup = () => {
        rl.close();
        stream.destroy();
      };

      rl.on('line', (line: string) => {
        if (aborted) return;
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // 非法行跳过：保持读取韧性，不因单行损坏而丢失其余记录。
          return;
        }
        if (parsed && typeof parsed === 'object' && 'ingestion_id' in parsed && 'event_type' in parsed) {
          if (visitor(parsed as AuditLogRecord)) {
            aborted = true;
            cleanup();
            finish();
          }
        }
      });

      rl.on('close', () => finish());
      // readline 在输入流出错（如 ENOENT/EISDIR）时会自行 emit 'error'，
      // 必须监听否则会作为未捕获异常泄漏；此处统一视为空结果。
      rl.on('error', () => finish());
      stream.on('error', () => {
        cleanup();
        finish();
      });
    });
  }

  /** 流读直到命中 (ingestion_id, event_type)，返回已存在记录或 null。 */
  private async findExisting(
    ingestionId: string,
    eventType: AuditEventType
  ): Promise<AuditLogRecord | null> {
    let match: AuditLogRecord | null = null;
    await this.streamRecords((record) => {
      if (record.ingestion_id === ingestionId && record.event_type === eventType) {
        match = record;
        return true;
      }
      return false;
    });
    return match;
  }

  /**
   * 带重试的 append。每次尝试前确保目录存在（AC-D08）。
   * 仅对瞬时 I/O 错误重试；达到 maxRetries 仍失败则抛出。
   */
  private async appendWithRetry(line: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, 'utf8');
        return;
      } catch (e) {
        lastError = e;
        // 立即重试（不 sleep，避免阻塞；瞬时 I/O 错误通常立即可重试）。
      }
    }
    throw lastError;
  }

  private deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
