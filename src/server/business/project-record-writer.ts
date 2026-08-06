// project-record-writer.ts
// 主线 A1: 项目主表幂等写入器。
// 仿照 customer-record-writer.ts 模式：字段白名单 + schema-authoritative
// 幂等搜索 + 稳定 client_token。正式业务 Project 表没有技术 marker 列，
// 因此由配置指定一个受限自然键（当前为“项目名称”）。

import {
  createStableClientToken,
  type FeishuClient,
} from '../feishu/feishu-client.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
import {
  FeishuCommitFailedError,
  FieldTypeMismatchError,
  type WriteFailureDetail,
} from '../domain/errors.js';
import { assertExpectedFields } from './post-write-verification.js';
import { CreateLifecyclePersistenceError, type CreateRecordLifecycle } from './create-lifecycle.js';
import {
  toFeishuDateTime,
  toFeishuMultiSelect,
  toFeishuRelation,
  toFeishuSingleSelect,
  toFeishuText,
} from './field-serialization.js';

/**
 * Legacy/synthetic 项目表业务字段白名单。
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
  createLifecycle?: CreateRecordLifecycle;
  /** Server-owned deterministic logical key for internal-controlled writes. */
  internalWriteKey?: string;
}

/**
 * 项目记录写入器接口。
 *
 * 实现必须按 ingestionId 幂等：重试不得产生重复项目记录。
 */
export interface ProjectRecordWriter {
  write(input: ProjectRecordWriterInput): Promise<ProjectRecordWriterResult>;
  verifyRecord?(recordId: string, input: ProjectRecordWriterInput): Promise<void>;
  findByIngestionId?(ingestionId: string, normalizedFields?: Record<string, unknown>): Promise<string[]>;
  /** 删除记录（用于事务回滚补偿）。 */
  deleteRecord(recordId: string): Promise<void>;
}

/**
 * SingleSelect options defined on the live 项目类型 column.
 * Source: `scripts/export-feishu-schema.mjs` against the target Base.
 */
export const PROJECT_TYPE_OPTIONS = ['客片', '创作'] as const;

/**
 * MultiSelect options defined on the live 风格定位 column.
 *
 * Feishu AUTO-CREATES unknown MultiSelect options instead of rejecting them,
 * which silently mutates the table schema with OCR noise. Validating against
 * the known option set keeps the column stable.
 */
export const PROJECT_STYLE_OPTIONS = [
  '日系清新',
  '韩系唯美',
  '复古胶片',
  '暗调情绪',
  '法式浪漫',
  '国潮古风',
] as const;

export interface FeishuProjectRecordWriterOptions {
  projectTableId: string;
  /** Schema-authoritative idempotency field; defaults to the legacy marker. */
  ingestionIdField?: string;
  /**
   * Allowed 风格定位 options.
   *
   * Opt-in: when omitted, option validation is disabled and Feishu's
   * auto-create behaviour applies (current production behaviour). Supply
   * `PROJECT_STYLE_OPTIONS` to fail closed instead of letting OCR noise
   * silently extend the column's option list.
   */
  styleOptions?: readonly string[];
}

/**
 * 飞书项目表写入器。
 *
 * 幂等策略：
 * 1. 按配置的 schema-authoritative key 搜索项目表
 * 2. 已存在 → 返回 record_id，created=false
 * 3. 不存在 → 构建实际 Base 字段载荷 + createRecord + 稳定 client_token
 */
export class FeishuProjectRecordWriter implements ProjectRecordWriter {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuProjectRecordWriterOptions
  ) {}

  async write(input: ProjectRecordWriterInput): Promise<ProjectRecordWriterResult> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    const idempotencyValue = this.getIdempotencyValue(input.ingestionId, input.normalizedFields);
    let existing;
    try {
      existing = await this.client.searchRecords(this.options.projectTableId, {
        filter: {
          conjunction: 'and',
          conditions: this.buildIdempotencyConditions(
            ingestionIdField,
            idempotencyValue,
            input.normalizedFields,
          ),
        },
        page_size: 2,
      });
    } catch (e) {
      throw this.toCommitFailed(e, {
        ingestionId: input.ingestionId,
        fieldNames: [ingestionIdField],
      });
    }

    if (existing.length > 1) {
      throw new FeishuCommitFailedError('Project idempotency candidates are ambiguous');
    }
    if (existing.length > 0) {
      return {
        business_record_id: existing[0].record_id,
        created: false,
      };
    }

    const fields = this.buildFields(input.normalizedFields, input.ingestionId);
    const operationKey = input.internalWriteKey
      ?? `project-record:${this.options.projectTableId}:${input.ingestionId}`;
    const clientToken = createStableClientToken(operationKey);
    await input.createLifecycle?.beforeCreate?.({
      entity: 'project',
      tableId: this.options.projectTableId,
      ingestionId: input.ingestionId,
      operationKey,
      clientToken,
      createdAt: new Date().toISOString(),
    });
    let recordId: string;
    try {
      recordId = await this.client.createRecord(
        this.options.projectTableId,
        fields,
        clientToken
      );
      try {
        await input.createLifecycle?.afterCreate?.(recordId);
      } catch (error) {
        throw new CreateLifecyclePersistenceError(recordId, error);
      }
    } catch (e) {
      if (e instanceof CreateLifecyclePersistenceError) {
        throw e;
      }
      throw this.toCommitFailed(e, {
        ingestionId: input.ingestionId,
        fieldNames: Object.keys(fields),
      });
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
      throw this.toCommitFailed(e, { fieldNames: [] });
    }
  }

  async findByIngestionId(
    ingestionId: string,
    normalizedFields?: Record<string, unknown>,
  ): Promise<string[]> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    const idempotencyValue = this.getIdempotencyValue(ingestionId, normalizedFields);
    const records = await this.client.searchRecords(this.options.projectTableId, {
      filter: {
        conjunction: 'and',
        conditions: this.buildIdempotencyConditions(
          ingestionIdField,
          idempotencyValue,
          normalizedFields,
        ),
      },
      page_size: 10,
    });
    return records.map((record) => record.record_id);
  }

  async verifyRecord(recordId: string, input: ProjectRecordWriterInput): Promise<void> {
    const record = await this.client.getRecord(this.options.projectTableId, recordId);
    assertExpectedFields(record.fields, this.buildFields(input.normalizedFields, input.ingestionId));
  }

  private buildFields(
    normalizedFields: Record<string, unknown>,
    ingestionId: string
  ): Record<string, unknown> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    if (ingestionIdField !== COLLATOR_INGESTION_ID_FIELD) {
      return this.buildLiveProjectFields(normalizedFields, ingestionId, ingestionIdField);
    }

    const fields: Record<string, unknown> = {
      [ingestionIdField]: ingestionId,
    };
    for (const key of PROJECT_FIELD_WHITELIST) {
      const value = normalizedFields[key];
      if (value === undefined || value === null) continue;
      let serialized: unknown;
      if (DATETIME_FIELDS.has(key)) {
        serialized = toFeishuDateTime(key, value);
      } else if (MULTISELECT_FIELDS.has(key)) {
        serialized = toFeishuMultiSelect(key, value);
      } else if (RELATION_FIELDS.has(key)) {
        // AC-C07: relation columns must carry real record ids. Display names
        // are rejected here — Feishu accepts them and stores nothing.
        serialized = toFeishuRelation(key, value);
      } else {
        serialized = value;
      }
      if (serialized !== null && serialized !== undefined) fields[key] = serialized;
    }
    return fields;
  }

  private getIdempotencyValue(
    ingestionId: string,
    normalizedFields: Record<string, unknown> | undefined,
  ): string {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    if (ingestionIdField === COLLATOR_INGESTION_ID_FIELD) return ingestionId;

    const fields = normalizedFields ?? {};
    const value = ingestionIdField === '项目名称'
      ? fields['项目名称'] ?? fields.project_name
      : fields[ingestionIdField];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new FeishuCommitFailedError('Project idempotency key is missing');
    }
    return value.trim();
  }

  private buildIdempotencyConditions(
    idempotencyField: string,
    idempotencyValue: string,
    normalizedFields: Record<string, unknown> | undefined,
  ): Array<{ field_name: string; operator: 'is'; value: unknown[] }> {
    const conditions: Array<{ field_name: string; operator: 'is'; value: unknown[] }> = [{
      field_name: idempotencyField,
      operator: 'is',
      value: [idempotencyValue],
    }];
    if (idempotencyField !== '项目名称') return conditions;

    const relation = normalizedFields?.['关联客户 ID'] ?? normalizedFields?.['客户关联'];
    if (relation === undefined || relation === null) return conditions;
    const relationIds = Array.isArray(relation) ? relation : [relation];
    if (relationIds.length > 0) {
      conditions.push({
        field_name: '关联客户 ID',
        operator: 'is',
        value: relationIds,
      });
    }
    return conditions;
  }

  private buildLiveProjectFields(
    normalizedFields: Record<string, unknown>,
    ingestionId: string,
    idempotencyField: string,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const assign = (name: string, value: unknown): void => {
      if (value !== null && value !== undefined) fields[name] = value;
    };

    assign(
      '项目名称',
      toFeishuText('项目名称', normalizedFields['项目名称'] ?? normalizedFields.project_name),
    );

    const projectType = normalizedFields['项目类型'] ?? normalizedFields.project_type;
    if (projectType !== undefined && projectType !== null) {
      assign(
        '项目类型',
        toFeishuSingleSelect('项目类型', this.normalizeProjectType(projectType), {
          allowedOptions: PROJECT_TYPE_OPTIONS,
        }),
      );
    }

    // 拍摄档期 is a Feishu DateTime column: it accepts ONLY epoch
    // milliseconds and answers `1254064 DatetimeFieldConvFail` for anything
    // else. The previous implementation fell back to passing the raw string
    // through whenever `Date.parse` returned NaN — which is exactly what OCR
    // produces for year-less Chinese dates ("8月15日") — and that surfaced as
    // an opaque FEISHU_COMMIT_FAILED.
    assign(
      '拍摄档期',
      toFeishuDateTime(
        '拍摄档期',
        normalizedFields['拍摄档期'] ?? normalizedFields['拍摄日期'] ?? normalizedFields.shoot_date,
      ),
    );

    assign(
      '风格定位',
      toFeishuMultiSelect(
        '风格定位',
        normalizedFields['风格定位'] ?? normalizedFields['风格要求'],
        { allowedOptions: this.options.styleOptions },
      ),
    );

    // Link columns silently store an empty relation when handed a display
    // name, so record-id shape is enforced here instead of relying on Feishu
    // to reject it.
    assign(
      '关联客户 ID',
      toFeishuRelation(
        '关联客户 ID',
        normalizedFields['关联客户 ID'] ?? normalizedFields['客户关联'],
      ),
    );

    for (const field of ['拍摄地点', '备注', '系列', '主题', '项目Wiki文档', '项目云盘文件夹']) {
      assign(field, toFeishuText(field, normalizedFields[field]));
    }

    // The live Project table has no technical marker column. The configured
    // field is therefore a bounded natural key (currently 项目名称), while
    // the stable client token still protects the Create boundary.
    if (fields[idempotencyField] === undefined) {
      fields[idempotencyField] = this.getIdempotencyValue(ingestionId, normalizedFields);
    }
    return fields;
  }

  private normalizeProjectType(value: unknown): unknown {
    if (value === 'client') return '客片';
    if (value === 'creative') return '创作';
    if (value === '客片' || value === '创作') return value;
    throw new FeishuCommitFailedError('Project type option is unsupported');
  }

  /**
   * Wrap a low-level failure into FeishuCommitFailedError while preserving a
   * redacted, structured diagnostic (feishu code / message / request_id /
   * attempted field names). The coarse `FEISHU_COMMIT_FAILED` code is kept
   * for API compatibility; the detail rides alongside it so the failure is
   * never reduced to an opaque token.
   */
  private toCommitFailed(
    e: unknown,
    context: { ingestionId?: string; fieldNames?: string[] } = {},
  ): FeishuCommitFailedError {
    const fieldNames = context.fieldNames ?? [];
    if (e instanceof FeishuApiError) {
      const apiDetail = e.toDetail();
      const detail: WriteFailureDetail = {
        internal_error_code: 'FEISHU_COMMIT_FAILED',
        target_table: 'project',
        field_names: fieldNames,
        ingestion_id: context.ingestionId,
        feishu_code: apiDetail.feishu_code,
        feishu_message: apiDetail.feishu_message,
        request_id: apiDetail.request_id,
        http_status: apiDetail.http_status,
        ...(apiDetail.field_violations ? { field_violations: apiDetail.field_violations } : {}),
      };
      return new FeishuCommitFailedError(
        `Feishu API error (code=${e.code}): ${e.safeMessage}`,
        e.code < 0,
        detail,
      );
    }
    if (e instanceof FieldTypeMismatchError) {
      return new FeishuCommitFailedError(
        e.message,
        false,
        e.toDetail(context.ingestionId, fieldNames),
      );
    }
    return new FeishuCommitFailedError(
      `Feishu commit failed: ${(e as Error)?.name ?? 'UnknownError'}`,
      false,
      {
        internal_error_code: 'FEISHU_COMMIT_FAILED',
        target_table: 'project',
        field_names: fieldNames,
        ingestion_id: context.ingestionId,
      },
    );
  }
}
