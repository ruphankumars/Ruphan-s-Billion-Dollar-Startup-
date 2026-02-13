import { describe, it, expect, vi } from 'vitest';
import {
  generateApiKey,
  verifyApiKey,
  createAuthMiddleware,
} from '../../../src/api/auth.js';

describe('generateApiKey', () => {
  it('creates key with default prefix "ctx"', () => {
    const key = generateApiKey();
    expect(typeof key).toBe('string');
    // Default prefix is 'ctx', format is: ctx_<base64url>
    expect(key.startsWith('ctx_')).toBe(true);
  });

  it('creates key with custom prefix', () => {
    const key = generateApiKey('myapp');
    expect(key.startsWith('myapp_')).toBe(true);
  });

  it('creates unique keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1).not.toBe(key2);
  });
});

describe('verifyApiKey', () => {
  it('returns true for matching keys', () => {
    const key = generateApiKey();
    expect(verifyApiKey(key, key)).toBe(true);
  });

  it('returns false for different keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(verifyApiKey(key1, key2)).toBe(false);
  });

  it('returns false for different length keys', () => {
    expect(verifyApiKey('short', 'a-longer-key')).toBe(false);
    expect(verifyApiKey('', 'ctx_abc')).toBe(false);
    expect(verifyApiKey('ctx_abc', '')).toBe(false);
  });

  it('returns true for two empty strings (same length, timingSafeEqual)', () => {
    // verifyApiKey checks length first, then timingSafeEqual
    // Two empty strings have same length (0) and timingSafeEqual returns true
    expect(verifyApiKey('', '')).toBe(true);
  });
});

describe('createAuthMiddleware', () => {
  const validKey = generateApiKey();
  const middleware = createAuthMiddleware(validKey);

  function createMockReq(path: string, authHeader?: string) {
    return {
      url: path,
      headers: authHeader
        ? { authorization: authHeader, host: 'localhost:3000' }
        : { host: 'localhost:3000' },
    } as any;
  }

  function createMockRes() {
    const res: any = {
      statusCode: 200,
      _headers: {} as Record<string, string>,
      _body: '',
      _ended: false,
      setHeader(name: string, value: string) {
        res._headers[name] = value;
        return res;
      },
      writeHead(code: number) {
        res.statusCode = code;
        return res;
      },
      end(body?: string) {
        res._body = body ?? '';
        res._ended = true;
        return res;
      },
    };
    return res;
  }

  it('skips /api/health', () => {
    const req = createMockReq('/api/health');
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects missing token', () => {
    const req = createMockReq('/api/run');
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid Bearer token', () => {
    const req = createMockReq('/api/run', `Bearer ${validKey}`);
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
