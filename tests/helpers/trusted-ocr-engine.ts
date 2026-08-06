import type { ScreenshotOcrEngine } from '../../src/server/services/screenshot-ocr-adapter.js';

/**
 * OCR test double that reports a *trusted* engine identity.
 *
 * `assertTrustedRealOcrEvidence` (R3) rejects ingestions whose persisted OCR
 * evidence came from the `mock` engine, so any test whose subject-under-test
 * sits downstream of that gate — the production-pilot state machine,
 * confirmation propagation, and so on — must supply evidence from an approved
 * engine. Those tests are not testing the gate itself; the gate's own reject
 * path is covered explicitly in tests/unit/internal-controlled-write.test.ts
 * using MockOcrEngine.
 *
 * Output is deterministic: the same input always yields the same blocks, so
 * candidate ids and idempotency keys stay stable across runs.
 */
export class DeterministicTrustedOcrEngine implements ScreenshotOcrEngine {
  readonly engine = 'tesseract';

  constructor(private readonly projectType: 'client' | 'creative' = 'client') {}

  async extract() {
    const text_blocks =
      this.projectType === 'creative'
        ? [
            { type: 'text' as const, text: '样片创作项目' },
            { type: 'date' as const, text: '2026年8月15日' },
          ]
        : [
            { type: 'name' as const, text: '李女士' },
            { type: 'text' as const, text: '客片拍摄项目' },
            { type: 'price' as const, text: '预算5000-8000元' },
          ];

    return {
      engine: this.engine,
      ocr_version: 'tesseract-test-double-1',
      text_blocks,
      raw_text: text_blocks.map((block) => block.text).join('\n'),
      confidence: 0.99,
      processed_at: new Date().toISOString(),
    };
  }
}
