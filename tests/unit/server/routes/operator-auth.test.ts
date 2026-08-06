import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createHmacJwtOperatorResolver } from '../../../../src/server/routes/operator-auth.js';

function createToken(secret: string, payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encode(payload);
  const unsigned = `${header}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

describe('HS256 verified operator resolver', () => {
  it('returns the signed subject and rejects tampered or expired tokens', async () => {
    const secret = 'unit-test-production-pilot-secret';
    const resolver = createHmacJwtOperatorResolver(secret);
    const app = Fastify();
    await app.get('/', async (request) => ({ operator: resolver(request) }));
    const validToken = createToken(secret, {
      sub: 'jwt-operator',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const valid = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });
    expect(valid.json()).toEqual({ operator: 'jwt-operator' });

    const expired = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        authorization: `Bearer ${createToken(secret, {
          sub: 'jwt-operator',
          exp: Math.floor(Date.now() / 1000) - 1,
        })}`,
      },
    });
    expect(expired.json()).toEqual({});

    const tampered = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        authorization: `Bearer ${(() => {
          const [header, payload, signature] = validToken.split('.');
          const replacement = signature.endsWith('a') ? 'b' : 'a';
          return `${header}.${payload}.${signature.slice(0, -1)}${replacement}`;
        })()}`,
      },
    });
    expect(tampered.json()).toEqual({});
    await app.close();
  });
});
