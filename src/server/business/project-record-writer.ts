// project-record-writer.ts
// 主线 A1: 项目主表幂等写入器。
// 仿照 customer-record-writer.ts 模式：字段白名单 + 按"Collator 摄入 ID"幂等搜索 + 稳定 client_token。

import {
  createStableClientToken,
  type FeishuClient,
} from '../feishu/feishu-client.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
import { FeishuCommitFailedError } from '../domain/errors.js';
import { assertExpectedFields } from './post-write-verification.js';

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

/**
 * 关联（Link）字段集合 — Feishu 关联字段要求 record_id 字符串数组。
 *
 * AC-C07: 关联字段必须使用真实 record_id，不得使用展示名称。
 * 本写入器不做「名称 → record_id」解析（那需要额外查询且有安全风险），
 * 调用方 MUST 在 normalizedFields 中提供真实 Feishu record_id。单个
 * record_id 字符串会被包装成单元素数组；数组原样透传；非字符串/非数组
 * 值原样透传交由飞书拒绝（ surfaced 为 FEISHU_COMMIT_FAILED），避免静默
 * 把展示名当作 record_id 写入。
 */
const RELATION_FIELDS = new Set<string>(['客户关联', '模特关联']);

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
  verifyRecord?(recordId: string, input: ProjectRecordWriterInput): Promise<void>;
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

  async verifyRecord(recordId: string, input: ProjectRecordWriterInput): Promise<void> {
    const record = await this.client.getRecord(this.options.projectTableId, recordId);
    assertExpectedFields(record.fields, this.buildFields(input.normalizedFields, input.ingestionId));
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
      } else if (RELATION_FIELDS.has(key)) {
        // AC-C07: 关联字段必须为 record_id 数组。单个 record_id 包装成
        // 单元素数组；数组原样透传；其余值原样透传交由飞书拒绝。
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
