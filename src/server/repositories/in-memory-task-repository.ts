import type { IngestionTask } from '../domain/ingestion.js';
import type { TaskRepository } from './task-repository.js';

export class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, IngestionTask>();
  private idempotencyIndex = new Map<string, string>();

  async findById(ingestionId: string): Promise<IngestionTask | null> {
    return this.tasks.get(ingestionId) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<IngestionTask | null> {
    const ingestionId = this.idempotencyIndex.get(key);
    if (!ingestionId) return null;
    return this.tasks.get(ingestionId) ?? null;
  }

  async save(task: IngestionTask): Promise<void> {
    this.tasks.set(task.ingestion_id, task);
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
