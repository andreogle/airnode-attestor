import { createServer } from 'node:http';
import { prove } from './prove.ts';
import type { ErrorResponse, HealthResponse, ProveRequest } from './types.ts';

// =============================================================================
// Configuration
// =============================================================================

const PORT = Number(process.env.PORT ?? '4000');
const ATTESTOR_URL = process.env.ATTESTOR_URL ?? 'ws://localhost:8001/ws';

// =============================================================================
// Request handling
// =============================================================================

const readBody = (req: import('node:http').IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
};

const handleProve = async (
  req: import('node:http').IncomingMessage
): Promise<{ readonly status: number; readonly body: string }> => {
  const raw = await readBody(req);
  const request = JSON.parse(raw) as ProveRequest;

  if (!request.url || !request.method) {
    const error: ErrorResponse = { error: 'Missing required fields: url, method' };
    return { status: 400, body: JSON.stringify(error) };
  }

  const result = await prove(request);
  return { status: 200, body: JSON.stringify(result) };
};

const handleHealth = (): { readonly status: number; readonly body: string } => {
  const response: HealthResponse = {
    status: 'ok',
    attestorUrl: ATTESTOR_URL,
    attestorAddress: '0x0000000000000000000000000000000000000000',
  };
  return { status: 200, body: JSON.stringify(response) };
};

// =============================================================================
// Server
// =============================================================================

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const { status, body } = handleHealth();
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && req.url === '/prove') {
      const { status, body } = await handleProve(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`airnode-attestor listening on port ${String(PORT)}`);
  console.log(`attestor: ${ATTESTOR_URL}`);
});

export { server };
