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

  feishuAppId: z.string().optional(),
  feishuAppSecret: z.string().optional(),
  feishuBaseAppToken: z.string().optional(),
  feishuIngestionTableId: z.string().optional(),
  feishuReviewTableId: z.string().optional(),
  feishuWriteLogTableId: z.string().optional(),
  feishuCustomerTableId: z.string().optional(),

  defaultTimezone: z.string().default('Asia/Shanghai'),
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

    feishuAppId: env.FEISHU_APP_ID,
    feishuAppSecret: env.FEISHU_APP_SECRET,
    feishuBaseAppToken: env.FEISHU_BASE_APP_TOKEN,
    feishuIngestionTableId: env.FEISHU_INGESTION_TABLE_ID,
    feishuReviewTableId: env.FEISHU_REVIEW_TABLE_ID,
    feishuWriteLogTableId: env.FEISHU_WRITE_LOG_TABLE_ID,
    feishuCustomerTableId: env.FEISHU_CUSTOMER_TABLE_ID,

    defaultTimezone: env.DEFAULT_TIMEZONE,
  };

  return configSchema.parse(raw);
}
