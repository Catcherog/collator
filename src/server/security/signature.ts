import { createHmac, timingSafeEqual } from 'crypto';

const SIGNATURE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface SignatureResult {
  valid: boolean;
  reason?: string;
}

export function computeSignature(payload: string, timestamp: string, secret: string): string {
  const data = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function verifySignature(
  payload: string,
  timestamp: string,
  signature: string,
  secret: string,
  nowMs: number = Date.now()
): SignatureResult {
  if (!signature || !timestamp) {
    return { valid: false, reason: 'Missing signature or timestamp' };
  }

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    return { valid: false, reason: 'Invalid timestamp' };
  }

  const age = nowMs - ts * 1000;
  if (age > SIGNATURE_TIMEOUT_MS) {
    return { valid: false, reason: 'Request expired' };
  }

  if (age < -SIGNATURE_TIMEOUT_MS) {
    return { valid: false, reason: 'Timestamp too far in future' };
  }

  const expected = computeSignature(payload, timestamp, secret);

  const expectedBuf = Buffer.from(expected, 'utf-8');
  const actualBuf = Buffer.from(signature, 'utf-8');

  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

export function generateSignatureHeaders(
  payload: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): { timestamp: string; signature: string } {
  return {
    timestamp: String(nowSeconds),
    signature: computeSignature(payload, String(nowSeconds), secret),
  };
}
