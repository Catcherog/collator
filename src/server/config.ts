import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().positive().default(8787),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  webhookSecret: z.string().min(1, 'COLLATOR_WEBHOOK_SECRET is required'),
  autoCommitEnabled: z.coerce.boolean().default(false),
  dryRun: z.coerce.boolean().default(true),

  difyBaseUrl: z.string().url().optional(),
  difyWorkflowApiKey: z.string().optional(),
  difyWorkflowId: z.string().optional(),

  // TASK_REPOSITORY selects the production TaskRepository implementation.
  // - `memory` (default): InMemoryTaskRepository, used by tests and dev.
  // - `feishu`: FeishuTaskRepository backed by a real Feishu Base. All
  //   FEISHU_* credentials below must be set, otherwise startup fails. There
  //   is no silent fallback to memory (TASK-001 acceptance).
  taskRepository: z.enum(['memory', 'feishu']).default('memory'),

  feishuAppId: z.string().optional(),
  feishuAppSecret: z.string().optional(),
  feishuBaseAppToken: z.string().optional(),
  feishuIngestionTableId: z.string().optional(),
  feishuReviewTableId: z.string().optional(),
  feishuWriteLogTableId: z.string().optional(),
  feishuCustomerTableId: z.string().optional(),
  // 主线 A1: 截图纵向闭环 — Project/Model/Review Task 表 ID
  feishuProjectTableId: z.string().optional(),
  feishuModelTableId: z.string().optional(),
  feishuReviewTaskTableId: z.string().optional(),

  // 主线 A1: 截图闭环配置
  screenshotUploadDir: z.string().default('./uploads'),
  screenshotOcrEngine: z.enum(['mock', 'tesseract', 'feishu']).default('mock'),
  screenshotMaxCount: z.coerce.number().int().positive().default(10),
  screenshotMaxFileSizeBytes: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  defaultTimezone: z.string().default('Asia/Shanghai'),
}).superRefine((data, ctx) => {
  if (data.taskRepository !== 'feishu') return;
  const required: Array<[keyof typeof data, string]> = [
    ['feishuAppId', 'FEISHU_APP_ID'],
    ['feishuAppSecret', 'FEISHU_APP_SECRET'],
    ['feishuBaseAppToken', 'FEISHU_BASE_APP_TOKEN'],
    ['feishuIngestionTableId', 'FEISHU_INGESTION_TABLE_ID'],
    ['feishuReviewTableId', 'FEISHU_REVIEW_TABLE_ID'],
    ['feishuWriteLogTableId', 'FEISHU_WRITE_LOG_TABLE_ID'],
    ['feishuCustomerTableId', 'FEISHU_CUSTOMER_TABLE_ID'],
  ];
  for (const [key, envName] of required) {
    const v = data[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `TASK_REPOSITORY=feishu requires ${envName} to be set (no silent fallback to memory)`,
      });
    }
  }
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,

    webhookSecret: env.COLLATOR_WEBHOOK_SECRET,
    autoCommitEnabled: env.AUTO_COMMIT_ENABLED,
    dryRun: env.DRY_RUN,

    difyBaseUrl: env.DIFY_BASE_URL,
    difyWorkflowApiKey: env.DIFY_WORKFLOW_API_KEY,
    difyWorkflowId: env.DIFY_WORKFLOW_ID,

    taskRepository: env.TASK_REPOSITORY,

    feishuAppId: env.FEISHU_APP_ID,
    feishuAppSecret: env.FEISHU_APP_SECRET,
    feishuBaseAppToken: env.FEISHU_BASE_APP_TOKEN,
    feishuIngestionTableId: env.FEISHU_INGESTION_TABLE_ID,
    feishuReviewTableId: env.FEISHU_REVIEW_TABLE_ID,
    feishuWriteLogTableId: env.FEISHU_WRITE_LOG_TABLE_ID,
    feishuCustomerTableId: env.FEISHU_CUSTOMER_TABLE_ID,
    feishuProjectTableId: env.FEISHU_PROJECT_TABLE_ID,
    feishuModelTableId: env.FEISHU_MODEL_TABLE_ID,
    feishuReviewTaskTableId: env.FEISHU_REVIEW_TASK_TABLE_ID,

    screenshotUploadDir: env.SCREENSHOT_UPLOAD_DIR,
    screenshotOcrEngine: env.SCREENSHOT_OCR_ENGINE,
    screenshotMaxCount: env.SCREENSHOT_MAX_COUNT,
    screenshotMaxFileSizeBytes: env.SCREENSHOT_MAX_FILE_SIZE_BYTES,

    defaultTimezone: env.DEFAULT_TIMEZONE,
  };

  return configSchema.parse(raw);
}
