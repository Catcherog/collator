// model-record-writer.ts
// 主线 A1: 模特主表幂等写入器。
// 仿照 customer-record-writer.ts 模式：字段白名单 + 按"Collator 摄入 ID"幂等搜索 + 稳定 client_token。

import {
  createStableClientToken,
  type FeishuClient,
} from '../feishu/feishu-client.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
import { FeishuCommitFailedError } from '../domain/errors.js';

const MODEL_FIELD_WHITELIST = [
  '模特姓名',
  '联系方式',
  '风格标签',
] as const;

const COLLATOR_INGESTION_ID_FIELD = 'Collator 摄入 ID';

const MULTISELECT_FIELDS = new Set<string>(['风格标签']);

export interface ModelRecordWriterResult {
  business_record_id: string;
  created: boolean;
}

export interface ModelRecordWriterInput {
  ingestionId: string;
  normalizedFields: Record<string, unknown>;
}

export interface ModelRecordWriter {
  write(input: ModelRecordWriterInput): Promise<ModelRecordWriterResult>;
  deleteRecord(recordId: string): Promise<void>;
}

export interface FeishuModelRecordWriterOptions {
  modelTableId: string;
}

export class FeishuModelRecordWriter implements ModelRecordWriter {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuModelRecordWriterOptions
  ) {}

  async write(input: ModelRecordWriterInput): Promise<ModelRecordWriterResult> {
    let existing;
    try {
      existing = await this.client.searchRecords(this.options.modelTableId, {
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
        this.options.modelTableId,
        fields,
        createStableClientToken(
          `model-record:${this.options.modelTableId}:${input.ingestionId}`
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
      await this.client.deleteRecord(this.options.modelTableId, recordId);
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
    for (const key of MODEL_FIELD_WHITELIST) {
      const value = normalizedFields[key];
      if (value === undefined || value === null) continue;
      if (MULTISELECT_FIELDS.has(key)) {
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
