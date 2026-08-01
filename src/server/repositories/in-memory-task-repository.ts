import type { IngestionTask } from '../domain/ingestion.js';
import {
  assertTaskSaveFence,
  TaskSaveConflictError,
  type TaskRepository,
  type TaskSaveFence,
} from './task-repository.js';

function cloneTask(task: IngestionTask): IngestionTask {
  return JSON.parse(JSON.stringify(task)) as IngestionTask;
}

export class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, IngestionTask>();
  private idempotencyIndex = new Map<string, string>();

  async findById(ingestionId: string): Promise<IngestionTask | null> {
    const task = this.tasks.get(ingestionId);
    return task ? cloneTask(task) : null;
  }

  async findByIdempotencyKey(key: string): Promise<IngestionTask | null> {
    const ingestionId = this.idempotencyIndex.get(key);
    if (!ingestionId) return null;
    const task = this.tasks.get(ingestionId);
    return task ? cloneTask(task) : null;
  }

  async save(task: IngestionTask): Promise<void> {
    const current = this.tasks.get(task.ingestion_id);
    let next = task;
    if (current?.task_version !== undefined) {
      next = { ...task, task_version: current.task_version + 1 };
    }
    this.tasks.set(task.ingestion_id, cloneTask(next));
    this.idempotencyIndex.set(task.idempotency_key, task.ingestion_id);
  }

  async saveWithFence(task: IngestionTask, fence: TaskSaveFence): Promise<void> {
    const current = this.tasks.get(task.ingestion_id);
    if (!current) throw new TaskSaveConflictError('Task disappeared before fenced save');
    assertTaskSaveFence(current, task, fence);
    this.tasks.set(task.ingestion_id, cloneTask({
      ...task,
      task_version: fence.expected_task_version + 1,
    }));
    this.idempotencyIndex.set(task.idempotency_key, task.ingestion_id);
  }

  // Test helpers
  clear(): void {
    this.tasks.clear();
    this.idempotencyIndex.clear();
  }

  size(): number {
    return this.tasks.size;
  }
}
