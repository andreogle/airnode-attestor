import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { go, goSync } from '@api3/promise-utils';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { ATTESTOR_URL, PORT, VALID_METHODS, validateUrl } from './config.ts';
import { prove } from './prove.ts';
import type { HealthResponse, ProveRequest, SanitizedError } from './types.ts';

// =============================================================================
// Constants
// =============================================================================
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 60_000;
const HEADERS_TIMEOUT_MS = 10_000;

// =============================================================================
// Validation
// =============================================================================
const isProveRequest = (body: unknown): body is ProveRequest =>
  typeof body === 'object' &&
  body !== null &&
  'url' in body &&
  typeof (body as Record<string, unknown>)['url'] === 'string' &&
  'method' in body &&
  typeof (body as Record<string, unknown>)['method'] === 'string';

const sanitizeError = (error: unknown): SanitizedError => {
  if (!(error instanceof Error)) {
    return { status: 500, message: 'Internal server error' };
  }

  const msg = error.message.toLowerCase();
  if (msg.includes('timeout')) return { status: 504, message: 'Proof generation timed out' };
  if (msg.includes('econnrefused')) return { status: 504, message: 'Attestor connection failed' };

  console.error('Proof generation failed', error);
  return { status: 500, message: 'Proof generation failed' };
};

// =============================================================================
// App
// =============================================================================
const createApp = (): Hono => {
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    await next();
    c.header('cache-control', 'no-store');
  });

  app.get('/v1/health', (c) => c.json({ status: 'ok', attestorUrl: ATTESTOR_URL } satisfies HealthResponse));

  app.post(
    '/v1/prove',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
    async (c) => {
      const parsed = await go(() => c.req.json<unknown>());
      if (!parsed.success || !isProveRequest(parsed.data)) {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      const request = parsed.data;

      if (!VALID_METHODS.has(request.method)) {
        return c.json({ error: `Invalid method: ${request.method}` }, 400);
      }

      const urlCheck = goSync(() => validateUrl(request.url));
      if (!urlCheck.success) return c.json({ error: 'Invalid or disallowed URL' }, 400);

      if (!request.responseMatches || request.responseMatches.length === 0) {
        return c.json({ error: 'responseMatches must contain at least one entry' }, 400);
      }

      console.info(`Proving ${request.method} ${request.url}`);
      const result = await go(() => prove(request));
      if (!result.success) {
        const { status, message } = sanitizeError(result.error);
        return c.json({ error: message }, status);
      }
      console.info('Proof generated successfully');
      return c.json(result.data);
    }
  );

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  return app;
};

// =============================================================================
// Start
// =============================================================================
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    console.info(`airnode-attestor listening on port ${String(PORT)}`);
    console.info(`attestor: ${ATTESTOR_URL}`);
  }) as Server;
  /* eslint-disable functional/immutable-data */
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  /* eslint-enable functional/immutable-data */
}

export { createApp };
