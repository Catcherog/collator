import type { IngestionTask } from '../domain/ingestion.js';

export interface TaskRepository {
  findById(ingestionId: string): Promise<IngestionTask | null>;
  findByIdempotencyKey(key: string): Promise<IngestionTask | null>;
  save(task: IngestionTask): Promise<void>;
}
