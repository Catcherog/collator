// project-record-writer.ts
// 主线 A1: 项目主表幂等写入器。
// 仿照 customer-record-writer.ts 模式：字段白名单 + 按"Collator 摄入 ID"幂等搜索 + 稳定 client_token。

import {
  createStableClientToken,
  type FeishuClient,
} from '../feishu/feishu-client.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
import { FeishuCommitFailedError } from '../domain/errors.js';

/**
 * 项目表业务字段白名单。
 * 任何不在白名单内的字段在写入时被静默丢弃。
 */
const PROJECT_FIELD_WHITELIST = [
  '项目名称',
  '项目类型',
  '客户关联',
  '模特关联',
  '拍摄日期',
  '预算区间',
  '风格要求',
  '交付要求',
] as const;

const COLLATOR_INGESTION_ID_FIELD = 'Collator 摄入 ID';

/**
 * 日期字段集合 — 写入时转换为飞书 epoch 毫秒。
 */
const DATETIME_FIELDS = new Set<string>(['拍摄日期']);

/**
 * 多选字段集合 — Feishu MultiSelect 要求字符串数组。
 */
const MULTISELECT_FIELDS = new Set<string>(['风格要求']);

export interface ProjectRecordWriterResult {
  business_record_id: string;
  created: boolean;
}

export interface ProjectRecordWriterInput {
  ingestionId: string;
  normalizedFields: Record<string, unknown>;
}

/**
 * 项目记录写入器接口。
 *
 * 实现必须按 ingestionId 幂等：重试不得产生重复项目记录。
 */
export interface ProjectRecordWriter {
  write(input: ProjectRecordWriterInput): Promise<ProjectRecordWriterResult>;
  /** 删除记录（用于事务回滚补偿）。 */
  deleteRecord(recordId: string): Promise<void>;
}

export interface FeishuProjectRecordWriterOptions {
  projectTableId: string;
}

/**
 * 飞书项目表写入器。
 *
 * 幂等策略：
 * 1. 按 "Collator 摄入 ID" 搜索项目表
 * 2. 已存在 → 返回 record_id，created=false
 * 3. 不存在 → 构建白名单字段载荷 + createRecord + 稳定 client_token
 */
export class FeishuProjectRecordWriter implements ProjectRecordWriter {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuProjectRecordWriterOptions
  ) {}

  async write(input: ProjectRecordWriterInput): Promise<ProjectRecordWriterResult> {
    let existing;
    try {
      existing = await this.client.searchRecords(this.options.projectTableId, {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: COLLATOR_INGESTION_ID_FIELD,
              operator: 'is',
              value: [input.ingestionId],
            },
          ],
        },
        page_size: 2,
      });
    } catch (e) {
      throw this.toCommitFailed(e);
    }

    if (existing.length > 0) {
      return {
        business_record_id: existing[0].record_id,
        created: false,
      };
    }

    const fields = this.buildFields(input.normalizedFields, input.ingestionId);
    let recordId: string;
    try {
      recordId = await this.client.createRecord(
        this.options.projectTableId,
        fields,
        createStableClientToken(
          `project-record:${this.options.projectTableId}:${input.ingestionId}`
        )
      );
    } catch (e) {
      throw this.toCommitFailed(e);
    }
    return {
      business_record_id: recordId,
      created: true,
    };
  }

  async deleteRecord(recordId: string): Promise<void> {
    try {
      await this.client.deleteRecord(this.options.projectTableId, recordId);
    } catch (e) {
      throw this.toCommitFailed(e);
    }
  }

  private buildFields(
    normalizedFields: Record<string, unknown>,
    ingestionId: string
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      [COLLATOR_INGESTION_ID_FIELD]: ingestionId,
    };
    for (const key of PROJECT_FIELD_WHITELIST) {
      const value = normalizedFields[key];
      if (value === undefined || value === null) continue;
      if (DATETIME_FIELDS.has(key) && typeof value === 'string') {
        const ms = Date.parse(value);
        fields[key] = Number.isNaN(ms) ? value : ms;
      } else if (MULTISELECT_FIELDS.has(key)) {
        fields[key] = Array.isArray(value) ? value : [value];
      } else {
        fields[key] = value;
      }
    }
    return fields;
  }

  private toCommitFailed(e: unknown): FeishuCommitFailedError {
    if (e instanceof FeishuApiError) {
      return new FeishuCommitFailedError(
        `Feishu API error (code=${e.code}): ${e.message}`
      );
    }
    return new FeishuCommitFailedError(
      `Feishu commit failed: ${(e as Error)?.name ?? 'UnknownError'}`
    );
  }
}
