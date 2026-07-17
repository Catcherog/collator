import type { Config } from '../config.js';
import type { TaskRepository } from './task-repository.js';
import { InMemoryTaskRepository } from './in-memory-task-repository.js';
import { FeishuTaskRepository } from './feishu-task-repository.js';
import { FeishuClient } from '../feishu/feishu-client.js';

/**
 * Build the production TaskRepository based on `config.taskRepository`.
 *
 * - `memory` (default): returns InMemoryTaskRepository.
 * - `feishu`: returns FeishuTaskRepository backed by a FeishuClient pointed at
 *   the real Feishu Base. All required Feishu credentials are validated at
 *   config-load time (see `config.ts` superRefine), so by the time we get here
 *   a missing-config error has already surfaced as a ZodError — there is no
 *   silent fallback to InMemoryTaskRepository.
 *
 * This factory is the only place production code wires FeishuTaskRepository
 * together, which keeps `app.ts` free of feishu-specific imports.
 */
export function createTaskRepository(config: Config): TaskRepository {
  if (config.taskRepository === 'feishu') {
    // Defensive: config schema already rejects missing values, but assert
    // again so a future caller that bypasses loadConfig still gets a clear
    // error rather than a "cannot read property of undefined".
    const required = {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      baseToken: config.feishuBaseAppToken,
      ingestionTableId: config.feishuIngestionTableId,
    };
    for (const [k, v] of Object.entries(required)) {
      if (typeof v !== 'string' || v.trim().length === 0) {
        const envName = {
          appId: 'FEISHU_APP_ID',
          appSecret: 'FEISHU_APP_SECRET',
          baseToken: 'FEISHU_BASE_APP_TOKEN',
          ingestionTableId: 'FEISHU_INGESTION_TABLE_ID',
        }[k];
        throw new Error(
          `TASK_REPOSITORY=feishu requires ${envName} to be set (no silent fallback to memory)`
        );
      }
    }
    const client = new FeishuClient({
      appId: required.appId!,
      appSecret: required.appSecret!,
      baseToken: required.baseToken!,
    });
    return new FeishuTaskRepository(client, {
      ingestionTableId: required.ingestionTableId!,
    });
  }
  return new InMemoryTaskRepository();
}
