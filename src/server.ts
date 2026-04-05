import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { go, goSync } from '@api3/promise-utils';
import { ATTESTOR_URL, PORT, VALID_METHODS, validateUrl } from './config.ts';
import { logger, runWithContext } from './logger.ts';
import { prove } from './prove.ts';
import type { HealthResponse, JsonResponse, ProveRequest, SanitizedError } from './types.ts';

// =============================================================================
// Constants
// =============================================================================
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

// =============================================================================
// Request handling
// =============================================================================
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0; // eslint-disable-line functional/no-let
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk); // eslint-disable-line functional/immutable-data
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', reject);
  });

const jsonResponse = (status: number, body: unknown): JsonResponse => ({
  status,
  body: JSON.stringify(body),
});

const isProveRequest = (body: unknown): body is ProveRequest =>
  typeof body === 'object' &&
  body !== null &&
  'url' in body &&
  typeof (body as Record<string, unknown>)['url'] === 'string' &&
  'method' in body &&
  typeof (body as Record<string, unknown>)['method'] === 'string';

const parseBody = (raw: string): ProveRequest | undefined => {
  const result = goSync(() => JSON.parse(raw) as unknown);
  if (!result.success) return undefined;
  if (!isProveRequest(result.data)) return undefined;
  return result.data;
};

const sanitizeError = (error: unknown): SanitizedError => {
  if (!(error instanceof Error)) {
    return { status: 500, message: 'Internal server error' };
  }

  const msg = error.message.toLowerCase();
  if (msg.includes('timeout')) return { status: 504, message: 'Proof generation timed out' };
  if (msg.includes('econnrefused')) return { status: 504, message: 'Attestor connection failed' };
  if (error.message === 'Request body too large') return { status: 413, message: 'Request body too large' };

  logger.error('Proof generation failed', error);
  return { status: 500, message: 'Proof generation failed' };
};

const handleProve = async (req: IncomingMessage): Promise<JsonResponse> => {
  const raw = await readBody(req);
  const request = parseBody(raw);

  if (!request) return jsonResponse(400, { error: 'Invalid JSON body' });
  if (!request.url) return jsonResponse(400, { error: 'Missing required field: url' });
  if (!VALID_METHODS.has(request.method)) return jsonResponse(400, { error: `Invalid method: ${request.method}` });

  const urlCheck = goSync(() => validateUrl(request.url));
  if (!urlCheck.success) return jsonResponse(400, { error: 'Invalid or disallowed URL' });

  if (!request.responseMatches || request.responseMatches.length === 0) {
    return jsonResponse(400, { error: 'responseMatches must contain at least one entry' });
  }

  logger.info(`Proving ${request.method} ${request.url}`);
  const result = await prove(request);
  logger.info('Proof generated successfully');

  return jsonResponse(200, result);
};

const handleHealth = (): JsonResponse =>
  jsonResponse(200, { status: 'ok', attestorUrl: ATTESTOR_URL } satisfies HealthResponse);

// =============================================================================
// Server
// =============================================================================
const sendJson = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, SECURITY_HEADERS);
  res.end(body);
};

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method === 'GET' && req.url === '/v1/health') {
    const { status, body } = handleHealth();
    sendJson(res, status, body);
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/prove') {
    const goResult = await go(() => handleProve(req));
    if (!goResult.success) {
      const { status, message } = sanitizeError(goResult.error);
      sendJson(res, status, JSON.stringify({ error: message }));
      return;
    }
    sendJson(res, goResult.data.status, goResult.data.body);
    return;
  }

  sendJson(res, 404, JSON.stringify({ error: 'Not found' }));
};

const createApp = (): Server => {
  const server = createServer((req, res) => {
    void runWithContext({ requestId: randomUUID() }, () => handleRequest(req, res));
  });
  server.requestTimeout = 60_000; // eslint-disable-line functional/immutable-data
  server.headersTimeout = 10_000; // eslint-disable-line functional/immutable-data
  return server;
};

// =============================================================================
// Start
// =============================================================================
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`airnode-attestor listening on port ${String(PORT)}`);
    logger.info(`attestor: ${ATTESTOR_URL}`);
  });
}

export { createApp };
