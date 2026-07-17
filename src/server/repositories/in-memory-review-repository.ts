// in-memory-review-repository.ts
// TASK-002: 内存版审核仓库，单元测试与服务层 TDD 使用。
// 不透明 review_record_id 由 randomUUID 生成，不依赖 rec_review_ 前缀。

import { randomUUID } from 'crypto';
import type {
  NewReviewRecord,
  ReviewRecord,
  ReviewRepository,
} from './review-repository.js';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly byReviewId = new Map<string, ReviewRecord>();
  private readonly byIngestionId = new Map<string, string>();

  async findByIngestionId(ingestionId: string): Promise<ReviewRecord | null> {
    const reviewId = this.byIngestionId.get(ingestionId);
    if (!reviewId) return null;
    const record = this.byReviewId.get(reviewId);
    if (!record) return null;
    // Defensive deep-copy on read: callers must not mutate internal state.
    return deepClone(record);
  }

  async create(record: NewReviewRecord): Promise<ReviewRecord> {
    // Idempotent: if a review already exists for this ingestion_id, return it.
    const existingReviewId = this.byIngestionId.get(record.ingestion_id);
    if (existingReviewId) {
      const existing = this.byReviewId.get(existingReviewId);
      if (existing) return deepClone(existing);
    }

    const reviewRecordId = randomUUID();
    const stored: ReviewRecord = {
      ...deepClone(record),
      review_record_id: reviewRecordId,
    };
    this.byReviewId.set(reviewRecordId, stored);
    this.byIngestionId.set(record.ingestion_id, reviewRecordId);
    return deepClone(stored);
  }

  async save(record: ReviewRecord): Promise<void> {
    // Defensive deep-copy on write: subsequent caller mutations must not leak.
    const stored = deepClone(record);
    this.byReviewId.set(record.review_record_id, stored);
    this.byIngestionId.set(record.ingestion_id, record.review_record_id);
  }

  // Test helpers (not part of ReviewRepository contract)
  clear(): void {
    this.byReviewId.clear();
    this.byIngestionId.clear();
  }

  size(): number {
    return this.byReviewId.size;
  }
}
