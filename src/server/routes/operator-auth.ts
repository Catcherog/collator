import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedOperatorResolver } from './screenshots.js';

interface Hs256JwtHeader {
  alg?: unknown;
  typ?: unknown;
}

interface Hs256JwtPayload {
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

const MIN_HS256_SECRET_BYTES = 32;

function decodeJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function hasValidSignature(unsignedToken: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');
  return expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Verifies a compact HS256 JWT and returns its subject as the operator
 * principal. This is the built-in internal-service boundary for deployments
 * that do not inject an OAuth/JWT or trusted reverse-proxy resolver. The
 * secret must be provisioned out-of-band; arbitrary operator headers are never
 * consulted by this resolver.
 */
export function createHmacJwtOperatorResolver(secret: string): AuthenticatedOperatorResolver {
  if (Buffer.byteLength(secret, 'utf8') < MIN_HS256_SECRET_BYTES) {
    throw new Error(`Production pilot JWT secret must be at least ${MIN_HS256_SECRET_BYTES} bytes`);
  }
  return (request: FastifyRequest): string | undefined => {
    const authorization = request.headers.authorization;
    const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!headerValue?.startsWith('Bearer ')) return undefined;
    const token = headerValue.slice('Bearer '.length).trim();
    const parts: string[] = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined;

    const [encodedHeader, encodedPayload, signature] = parts;
    const header = decodeJson<Hs256JwtHeader>(encodedHeader);
    const payload = decodeJson<Hs256JwtPayload>(encodedPayload);
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT' || !payload) return undefined;
    if (!hasValidSignature(`${encodedHeader}.${encodedPayload}`, signature, secret)) return undefined;

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
      return undefined;
    }
    if (payload.nbf !== undefined && (
      typeof payload.nbf !== 'number'
      || !Number.isFinite(payload.nbf)
      || payload.nbf > nowSeconds
    )) {
      return undefined;
    }
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub : undefined;
  };
}
