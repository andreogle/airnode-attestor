// =============================================================================
// Types
// =============================================================================
type ZkEngine = 'gnark' | 'snarkjs' | 'stwo';

// =============================================================================
// Validation
// =============================================================================
const VALID_ZK_ENGINES = new Set<string>(['gnark', 'snarkjs', 'stwo']);
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);

const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^192\.168\./, // RFC 1918
  /^169\.254\./, // link-local
  /^0\./, // "this" network
  /^::1$/, // IPv6 loopback
  /^fc00:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
];

const isPrivateHostname = (hostname: string): boolean =>
  hostname === 'localhost' || PRIVATE_IP_RANGES.some((range) => range.test(hostname));

const validateUrl = (raw: string): string => {
  const parsed = new URL(raw);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme must be http or https, got: ${parsed.protocol.replace(':', '')}`);
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('URL must not target private or internal addresses');
  }

  return raw;
};

const validateZkEngine = (raw: string): ZkEngine => {
  if (!VALID_ZK_ENGINES.has(raw)) {
    throw new Error(`Invalid ZK_ENGINE: ${raw}. Must be one of: gnark, snarkjs, stwo`);
  }
  return raw as ZkEngine;
};

const validatePort = (raw: string): number => {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${raw}. Must be an integer between 1 and 65535`);
  }
  return port;
};

// =============================================================================
// Config
// =============================================================================
const PORT = validatePort(process.env['PORT'] ?? '5177');
const ATTESTOR_URL = process.env['ATTESTOR_URL'] ?? 'ws://localhost:8001/ws';
const ZK_ENGINE = validateZkEngine(process.env['ZK_ENGINE'] ?? 'gnark');
const PROVE_TIMEOUT_MS = Number(process.env['PROVE_TIMEOUT_MS'] ?? '30000');

export { ATTESTOR_URL, PORT, PROVE_TIMEOUT_MS, VALID_METHODS, ZK_ENGINE, validateUrl };
export type { ZkEngine };
