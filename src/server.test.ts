import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================
const mockProve = vi.fn();

vi.mock('./prove.ts', () => ({
  prove: mockProve,
}));

// =============================================================================
// Types
// =============================================================================
interface JsonBody {
  readonly [key: string]: unknown;
  readonly claim?: {
    readonly provider: string;
    readonly identifier: string;
  };
  readonly signatures?: {
    readonly claimSignature: string;
  };
  readonly status?: string;
  readonly attestorUrl?: string;
  readonly error?: string;
}

// =============================================================================
// Server setup
// =============================================================================

let app: Server;

let baseUrl: string;

beforeAll(async () => {
  const { createApp } = await import('./server.ts');
  app = createApp();
  await new Promise<void>((resolve) => {
    app.listen(0, () => {
      const addr = app.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://localhost:${String(addr.port)}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    app.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Fixtures
// =============================================================================
const MOCK_PROVE_RESULT = {
  claim: {
    provider: 'http',
    parameters: '{"url":"https://api.example.com/price","method":"GET"}',
    context: '{"extractedParameters":{"price":"2064.01"}}',
    owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    timestampS: 1_775_345_832,
    epoch: 1,
    identifier: '0xabc123',
  },
  signatures: {
    attestorAddress: '0x1234567890abcdef1234567890abcdef12345678',
    claimSignature: '0xabcdef0123',
  },
};

const VALID_REQUEST = {
  url: 'https://api.example.com/price',
  method: 'GET',
  responseMatches: [{ type: 'regex', value: String.raw`"price":\s*(?<price>[\d.]+)` }],
};

// =============================================================================
// GET /health
// =============================================================================
describe('GET /health', () => {
  test('returns 200 with status ok and attestor URL', async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.attestorUrl).toBe('ws://localhost:8001/ws');
  });

  test('includes security headers', async () => {
    const res = await fetch(`${baseUrl}/v1/health`);

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

// =============================================================================
// POST /prove
// =============================================================================
describe('POST /prove', () => {
  test('returns 200 with proof on success', async () => {
    mockProve.mockResolvedValue(MOCK_PROVE_RESULT);

    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.claim?.provider).toBe('http');
    expect(body.claim?.identifier).toBe('0xabc123');
    expect(body.signatures?.claimSignature).toBe('0xabcdef0123');
  });

  test('returns 400 for missing url and method', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  test('returns 400 for invalid method', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, method: 'DELETE' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid method: DELETE');
  });

  test('returns 400 for malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not valid json',
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  test('returns 400 for missing responseMatches', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://api.example.com/price', method: 'GET' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('responseMatches must contain at least one entry');
  });

  test('returns 400 for empty responseMatches', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, responseMatches: [] }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('responseMatches must contain at least one entry');
  });

  test('returns 400 for private/internal URLs', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, url: 'http://169.254.169.254/latest/meta-data/' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid or disallowed URL');
  });

  test('returns 400 for localhost URLs', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, url: 'http://localhost:8001/ws' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid or disallowed URL');
  });

  test('returns 400 for file:// scheme URLs', async () => {
    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, url: 'file:///etc/passwd' }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid or disallowed URL');
  });

  test('returns sanitized error on prove failure', async () => {
    mockProve.mockRejectedValue(new Error('Something internal went wrong'));

    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe('Proof generation failed');
  });

  test('returns 504 on timeout errors', async () => {
    mockProve.mockRejectedValue(new Error('Proof generation timeout'));

    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(504);
    expect(body.error).toBe('Proof generation timed out');
  });

  test('returns 504 on connection refused', async () => {
    mockProve.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8001'));

    const res = await fetch(`${baseUrl}/v1/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(504);
    expect(body.error).toBe('Attestor connection failed');
  });
});

// =============================================================================
// Unknown routes
// =============================================================================
describe('unknown routes', () => {
  test('returns 404 for unknown path', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(404);
    expect(body.error).toBe('Not found');
  });
});
