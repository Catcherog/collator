import type { IngestionTask } from '../domain/ingestion.js';
import { digestJson } from '../config/production-pilot.js';

export interface TaskSaveFence {
  expected_task_version: number;
  expected_candidate_digest: string;
  expected_governance_digest: string;
}

export class TaskSaveConflictError extends Error {
  readonly code = 'TASK_VERSION_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'TaskSaveConflictError';
  }
}

function screenshotState(task: IngestionTask): Record<string, unknown> | undefined {
  const evidence = task.pipeline_evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return undefined;
  const state = (evidence as Record<string, unknown>).screenshot_state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  return state as Record<string, unknown>;
}

export function taskCandidateDigest(task: IngestionTask): string {
  return digestJson(screenshotState(task)?.candidate_v1 ?? null);
}

export function taskGovernanceDigest(task: IngestionTask): string {
  return digestJson(screenshotState(task)?.governance_result_v1 ?? null);
}

export function assertTaskSaveFence(
  current: IngestionTask,
  next: IngestionTask,
  fence: TaskSaveFence,
): void {
  if (!Number.isInteger(current.task_version) || current.task_version !== fence.expected_task_version) {
    throw new TaskSaveConflictError('Task version changed before the fenced save');
  }
  if (next.task_version !== fence.expected_task_version) {
    throw new TaskSaveConflictError('Fenced task snapshot was based on a different version');
  }
  if (taskCandidateDigest(current) !== fence.expected_candidate_digest) {
    throw new TaskSaveConflictError('Candidate digest changed before the fenced save');
  }
  if (taskGovernanceDigest(current) !== fence.expected_governance_digest) {
    throw new TaskSaveConflictError('Governance digest changed before the fenced save');
  }
  if (taskCandidateDigest(next) !== fence.expected_candidate_digest) {
    throw new TaskSaveConflictError('Fenced task candidate differs from the expected binding');
  }
  if (taskGovernanceDigest(next) !== fence.expected_governance_digest) {
    throw new TaskSaveConflictError('Fenced task governance differs from the expected binding');
  }
}

export interface TaskRepository {
  findById(ingestionId: string): Promise<IngestionTask | null>;
  findByIdempotencyKey(key: string): Promise<IngestionTask | null>;
  save(task: IngestionTask): Promise<void>;
  /**
   * Atomically persists a pilot task transition only when the expected task
   * version and the server-owned candidate/governance digests still match.
   * Repositories that cannot provide this boundary must leave it undefined;
   * the production-pilot service then fails closed.
   */
  saveWithFence?(task: IngestionTask, fence: TaskSaveFence): Promise<void>;
}
