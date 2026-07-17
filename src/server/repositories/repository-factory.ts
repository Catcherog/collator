import type { Config } from '../config.js';
import type { TaskRepository } from './task-repository.js';
import type { ReviewRepository } from './review-repository.js';
import { InMemoryTaskRepository } from './in-memory-task-repository.js';
import { InMemoryReviewRepository } from './in-memory-review-repository.js';
import { FeishuTaskRepository } from './feishu-task-repository.js';
import { FeishuReviewRepository } from './feishu-review-repository.js';
import { FeishuClient } from '../feishu/feishu-client.js';

/**
 * Bundle of production repositories wired by `createRepositories(config)`.
 * `taskRepository` and `reviewRepository` always come as a pair so callers
 * never have to construct a review repository without the matching task
 * repository.
 */
export interface RepositoryBundle {
  taskRepository: TaskRepository;
  reviewRepository: ReviewRepository;
}

interface FeishuRequiredFields {
  appId: string;
  appSecret: string;
  baseToken: string;
  ingestionTableId: string;
  reviewTableId: string;
}

/**
 * Collect and validate the Feishu credentials required by both repositories.
 *
 * The config schema already rejects missing values at load time, but we
 * re-validate here so any future caller that bypasses `loadConfig` (e.g. a
 * test that constructs `Config` directly) still gets a clear error rather
 * than a `cannot read property of undefined`.
 *
 * Returns the field name → env var name mapping so error messages always
 * reference the exact environment variable the operator must set.
 */
function collectFeishuRequired(config: Config): FeishuRequiredFields {
  const required: Array<[keyof FeishuRequiredFields, string, unknown]> = [
    ['appId', 'FEISHU_APP_ID', config.feishuAppId],
    ['appSecret', 'FEISHU_APP_SECRET', config.feishuAppSecret],
    ['baseToken', 'FEISHU_BASE_APP_TOKEN', config.feishuBaseAppToken],
    ['ingestionTableId', 'FEISHU_INGESTION_TABLE_ID', config.feishuIngestionTableId],
    ['reviewTableId', 'FEISHU_REVIEW_TABLE_ID', config.feishuReviewTableId],
  ];
  const result = {} as FeishuRequiredFields;
  for (const [field, envName, value] of required) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `TASK_REPOSITORY=feishu requires ${envName} to be set (no silent fallback to memory)`
      );
    }
    result[field] = value;
  }
  return result;
}

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
 * Kept as a compatibility wrapper for existing callers that only need the
 * task repository. New callers should use `createRepositories` to get the
 * matching review repository at the same time.
 */
export function createTaskRepository(config: Config): TaskRepository {
  if (config.taskRepository === 'feishu') {
    const required = collectFeishuRequired(config);
    const client = new FeishuClient({
      appId: required.appId,
      appSecret: required.appSecret,
      baseToken: required.baseToken,
    });
    return new FeishuTaskRepository(client, {
      ingestionTableId: required.ingestionTableId,
    });
  }
  return new InMemoryTaskRepository();
}

/**
 * Build the production repository bundle used by `buildApp`.
 *
 * Memory mode returns `InMemoryTaskRepository` plus `InMemoryReviewRepository`.
 * Feishu mode constructs one shared `FeishuClient` (so both repositories reuse
 * the same access token cache) and returns `FeishuTaskRepository` plus
 * `FeishuReviewRepository` with their environment-injected table IDs.
 *
 * There is no silent fallback to memory: if any required Feishu credential
 * is missing, this function throws with the exact environment variable name.
 */
export function createRepositories(config: Config): RepositoryBundle {
  if (config.taskRepository === 'feishu') {
    const required = collectFeishuRequired(config);
    const client = new FeishuClient({
      appId: required.appId,
      appSecret: required.appSecret,
      baseToken: required.baseToken,
    });
    return {
      taskRepository: new FeishuTaskRepository(client, {
        ingestionTableId: required.ingestionTableId,
      }),
      reviewRepository: new FeishuReviewRepository(client, {
        reviewTableId: required.reviewTableId,
      }),
    };
  }
  return {
    taskRepository: new InMemoryTaskRepository(),
    reviewRepository: new InMemoryReviewRepository(),
  };
}
