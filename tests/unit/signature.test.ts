import { describe, it, expect } from 'vitest';
import {
  computeSignature,
  verifySignature,
  generateSignatureHeaders,
} from '../../src/server/security/signature.js';

const SECRET = 'test-secret';

describe('signature', () => {
  it('computes a stable signature', () => {
    const sig1 = computeSignature('payload', '1234567890', SECRET);
    const sig2 = computeSignature('payload', '1234567890', SECRET);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates valid headers', () => {
    const { timestamp, signature } = generateSignatureHeaders('payload', SECRET);
    const result = verifySignature('payload', timestamp, signature, SECRET);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifySignature('payload', timestamp, 'invalid', SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('rejects missing signature or timestamp', () => {
    expect(verifySignature('payload', '123', '', SECRET).valid).toBe(false);
    expect(verifySignature('payload', '', 'sig', SECRET).valid).toBe(false);
  });

  it('rejects expired requests', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const signature = computeSignature('payload', timestamp, SECRET);
    const result = verifySignature('payload', timestamp, signature, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Request expired');
  });

  it('rejects future timestamps', () => {
    const timestamp = String(Math.floor(Date.now() / 1000) + 6 * 60);
    const signature = computeSignature('payload', timestamp, SECRET);
    const result = verifySignature('payload', timestamp, signature, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Timestamp too far in future');
  });
});
