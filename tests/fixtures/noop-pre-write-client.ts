/**
 * No-op PRE_WRITE client — TEST FIXTURE ONLY
 *
 * RF-FIX-02 (GPT R2 verdict): NoOpPreWriteClient must live in tests/fixtures/,
 * NOT in production source. Production code has no NoOp fallback (RF-02).
 *
 * Tests import this fixture explicitly when they need a PRE_WRITE client that
 * unconditionally returns PASS without contacting SOP.
 *
 * Usage:
 *   import { NoOpPreWriteClient } from '../fixtures/noop-pre-write-client';
 *   new IngestionService(repo, reviewRepo, undefined, undefined, new NoOpPreWriteClient());
 */

import type { CandidateV1 } from '../../src/contracts/candidate-v1.js';
import type { PreWriteClient } from '../../src/server/governance/pre-write-client.js';

/**
 * No-op PRE_WRITE client — test fixture.
 *
 * Returns PASS / NOT_ATTEMPTED / 0 violations for every candidate, without
 * contacting SOP. Use in unit tests where PRE_WRITE governance is out of scope.
 */
export class NoOpPreWriteClient implements PreWriteClient {
  async callPreWrite(candidate: CandidateV1): Promise<{
    candidate_id: string;
    decision: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
    write_status: string;
    violations_count: number;
  }> {
    return {
      candidate_id: candidate.candidate_id,
      decision: 'PASS',
      write_status: 'NOT_ATTEMPTED',
      violations_count: 0,
    };
  }
}
