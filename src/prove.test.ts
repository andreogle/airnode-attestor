import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProveRequest, ProveResponse } from './types.ts';

// =============================================================================
// Mocks
// =============================================================================
const mockCreateClaimOnAttestor = vi.fn();

vi.mock('@reclaimprotocol/attestor-core', () => ({
  createClaimOnAttestor: mockCreateClaimOnAttestor,
}));

vi.mock('viem/accounts', () => ({
  generatePrivateKey: vi.fn(() => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
  privateKeyToAccount: vi.fn(() => ({
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  })),
}));

// =============================================================================
// Fixtures
// =============================================================================
const MOCK_CLAIM_SIGNATURE = new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23]);

interface MockClaimResult {
  readonly claim:
    | {
        readonly provider: string;
        readonly parameters: string;
        readonly context: string;
        readonly owner: string;
        readonly timestampS: number;
        readonly epoch: number;
        readonly identifier: string;
      }
    | undefined;
  readonly signatures:
    | {
        readonly attestorAddress: string;
        readonly claimSignature: Uint8Array;
        readonly resultSignature: Uint8Array;
      }
    | undefined;
  readonly error: { readonly message: string } | undefined;
  readonly request: undefined;
}

const makeMockResult = (): MockClaimResult => ({
  claim: {
    provider: 'http',
    parameters: '{"url":"https://api.example.com/price","method":"GET","responseMatches":[],"responseRedactions":[]}',
    context: '{"extractedParameters":{"price":"2064.01"}}',
    owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    timestampS: 1_775_345_832,
    epoch: 1,
    identifier: '0xabc123',
  },
  signatures: {
    attestorAddress: '0x1234567890abcdef1234567890abcdef12345678',
    claimSignature: MOCK_CLAIM_SIGNATURE,
    resultSignature: new Uint8Array([0xff]),
  },
  error: undefined,
  request: undefined,
});

const makeRequest = (overrides: Partial<ProveRequest> = {}): ProveRequest => ({
  url: 'https://api.example.com/price',
  method: 'GET',
  ...overrides,
});

// =============================================================================
// Setup
// =============================================================================

let prove: (request: ProveRequest) => Promise<ProveResponse>;

beforeAll(async () => {
  ({ prove } = await import('./prove.ts'));
});

// =============================================================================
// Tests
// =============================================================================
describe('prove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns formatted claim and hex signature on success', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    const result = await prove(makeRequest());

    expect(result.claim.provider).toBe('http');
    expect(result.claim.owner).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(result.claim.timestampS).toBe(1_775_345_832);
    expect(result.claim.epoch).toBe(1);
    expect(result.claim.identifier).toBe('0xabc123');
    expect(result.signatures.attestorAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.signatures.claimSignature).toBe('0xabcdef0123');
  });

  test('passes headers as secretParams, not params', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    await prove(
      makeRequest({
        headers: { 'x-api-key': 'super-secret-key' },
      })
    );

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(callArgs['secretParams']?.['headers']).toEqual({ 'x-api-key': 'super-secret-key' });
    expect(callArgs['params']?.['headers']).toBeUndefined();
  });

  test('passes responseMatches to params correctly', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    const responseMatches = [{ type: 'regex' as const, value: String.raw`"usd":\s*(?<price>[\d.]+)` }];
    await prove(makeRequest({ responseMatches }));

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(callArgs['params']?.['responseMatches']).toEqual(responseMatches);
  });

  test('passes responseRedactions to params correctly', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    const responseRedactions = [{ jsonPath: 'ethereum.usd' }];
    await prove(makeRequest({ responseRedactions }));

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(callArgs['params']?.['responseRedactions']).toEqual(responseRedactions);
  });

  test('passes body to params when provided', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    await prove(makeRequest({ method: 'POST', body: '{"query":"ethereum"}' }));

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(callArgs['params']?.['body']).toBe('{"query":"ethereum"}');
  });

  test('passes empty body to params when not provided', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    await prove(makeRequest());

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(callArgs['params']?.['body']).toBe('');
  });

  test('uses gnark zkEngine by default', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue(makeMockResult());

    await prove(makeRequest());

    const callArgs = mockCreateClaimOnAttestor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs['zkEngine']).toBe('gnark');
  });

  test('throws on attestor timeout', async () => {
    mockCreateClaimOnAttestor.mockRejectedValue(new Error('WebSocket connection timeout'));

    await expect(prove(makeRequest())).rejects.toThrow('WebSocket connection timeout');
  });

  test('throws on attestor connection failure', async () => {
    mockCreateClaimOnAttestor.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8001'));

    await expect(prove(makeRequest())).rejects.toThrow('ECONNREFUSED');
  });

  test('throws when attestor returns an error', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue({
      ...makeMockResult(),
      claim: undefined,
      signatures: undefined,
      error: { message: 'Claim verification failed' },
    });

    await expect(prove(makeRequest())).rejects.toThrow('Claim verification failed');
  });

  test('throws when attestor returns incomplete response', async () => {
    mockCreateClaimOnAttestor.mockResolvedValue({
      ...makeMockResult(),
      claim: undefined,
      signatures: undefined,
    });

    await expect(prove(makeRequest())).rejects.toThrow('incomplete response');
  });
});
