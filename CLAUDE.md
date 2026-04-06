## Overview

airnode-attestor is an HTTP service that generates TLS proofs for API responses using Reclaim Protocol. It sits between
Airnode and a Reclaim attestor, exposing a simple `POST /v1/prove` endpoint that Airnode calls when proof mode is enabled.

The service is operated by ChainAPI — Airnode operators don't run this. They configure `proof.gatewayUrl` in their
Airnode config and the gateway handles everything.

## Runtime

Node.js 22+ (not Bun). The Reclaim attestor-core SDK has native modules (`re2`, gnark FFI) that require Node.js.

- `node --experimental-strip-types` for running TypeScript directly (no transpiler needed)
- `npm install` for dependency management
- Use TypeScript with ESM (`"type": "module"` in package.json)

## Scripts

```bash
npm run dev          # start with --watch for development
npm start            # start the server
npm test             # run tests with vitest
npm run test:watch   # run tests in watch mode
npm run lint         # check formatting (prettier) + linting (eslint)
npm run fmt          # auto-fix formatting + linting
npm run typecheck    # run tsc --noEmit
npm run setup        # alias for npm install
npm run docker:up    # docker compose up --build
npm run docker:down  # docker compose down
```

## License

**AGPL-3.0.** This is required because `@reclaimprotocol/attestor-core` is AGPL-3.0 licensed. The AGPL boundary is why
this is a separate repo from Airnode (which is MIT). Airnode communicates with this service over HTTP — no code linkage.

## Architecture

```
Airnode (Bun, MIT)                    airnode-attestor (Node.js, AGPL)
  │                                     │
  │  POST /v1/prove                     │
  │  { url, method, headers, ... }      │
  │────────────────────────────────────▶│
  │                                     │  WebSocket tunnel
  │                                     │──────────────────▶ Reclaim Attestor (Docker)
  │                                     │                     │
  │                                     │                     │── TLS tunnel to upstream API
  │                                     │                     │── ZK proof generation (gnark)
  │                                     │                     │── Attestor signs the claim
  │                                     │◀──────────────────  │
  │                                     │
  │◀────────────────────────────────────│
  │  { claim, signatures }              │
```

Three processes:

1. **airnode-attestor** — this service. HTTP API that wraps the Reclaim client SDK.
2. **Reclaim attestor** — Docker container (`ghcr.io/reclaimprotocol/attestor-core`). Runs the MPC-TLS notary.
3. **Upstream API** — the API being proven (e.g., CoinGecko). Called through the attestor's TLS tunnel.

## Dependencies

| Package                                | License        | Purpose                                                |
| -------------------------------------- | -------------- | ------------------------------------------------------ |
| `@api3/promise-utils`                  | MIT            | `go()`/`goSync()` for error handling without try/catch |
| `@reclaimprotocol/attestor-core`       | AGPL-3.0       | Client SDK for creating claims on the attestor         |
| `@reclaimprotocol/tls`                 | GitHub (check) | TLS crypto implementation (webcrypto backend)          |
| `@reclaimprotocol/zk-symmetric-crypto` | (check)        | ZK proof generation (gnark backend)                    |
| `viem`                                 | MIT            | Ethereum primitives (key generation, hashing)          |

### Known setup quirks

- `@reclaimprotocol/tls` is a GitHub dependency that needs its dev deps installed and built separately:
  ```bash
  npm install --prefix node_modules/@reclaimprotocol/tls
  npm run --prefix node_modules/@reclaimprotocol/tls build
  ```
- ZK circuit files must be downloaded before first use:
  ```bash
  node node_modules/@reclaimprotocol/zk-symmetric-crypto/lib/scripts/download-files.js
  ```
- `@reclaimprotocol/tls` ships with an empty crypto object that must be initialized at startup via
  `setCryptoImplementation(webcryptoCrypto)`. The `zk-symmetric-crypto` package has a **nested copy** of
  `@reclaimprotocol/tls` in its own `node_modules/` — both instances must be initialized. Use a preload script
  (`--experimental-strip-types --import=./src/init-crypto.ts`) to handle this before any attestor-core code loads.

## Project structure

```
src/
  config.ts             Environment variable parsing and validation
  init-crypto.ts        TLS crypto initialization (preloaded via --import)
  logger.ts             Structured logging with AsyncLocalStorage request context
  prove.ts              Core proving logic — wraps createClaimOnAttestor
  prove.test.ts         Tests for prove.ts
  server.ts             HTTP server (POST /v1/prove, GET /v1/health)
  server.test.ts        Tests for server.ts
  types.ts              Request/response types
.github/workflows/ci.yml  CI: lint, typecheck, test
docker-compose.yml        Reclaim attestor container + this service
Dockerfile                Multi-stage Node 22 image
.env.example              Attestor private key, port config
```

Key conventions:

- No catch-all folders like `utils/` or `helpers/`. Place files directly in `src/` with clear names.
- **Explicit over implicit**: config fields should be required with no defaults, unless a default is genuinely universal.

## Expected API

### `POST /v1/prove`

Request:

```json
{
  "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  "method": "GET",
  "headers": {
    "x-cg-pro-api-key": "secret-api-key"
  },
  "body": "",
  "responseMatches": [
    {
      "type": "regex",
      "value": "\"usd\":\\s*(?<price>[\\d.]+)"
    }
  ],
  "responseRedactions": [
    {
      "jsonPath": "ethereum.usd"
    }
  ]
}
```

- `url` (required) — upstream API URL to call through the attestor tunnel. Must be http/https, no private IPs.
- `method` (required) — HTTP method (GET, POST, PUT, PATCH)
- `headers` (optional) — headers to send with the upstream request. These are treated as **secret** — redacted from the
  proof via TLS 1.3 KeyUpdate. The attestor never sees them in plaintext.
- `body` (optional) — request body to send with the upstream request. Defaults to empty string.
- `responseMatches` (required) — regex patterns the response must match. Must contain at least one entry. Named capture
  groups (e.g., `(?<price>...)`) populate `extractedParameters` in the proof context.
- `responseRedactions` (optional) — which parts of the response to reveal to the attestor. `jsonPath` selects specific
  JSON fields. If omitted, the full response is revealed.

Response (200):

```json
{
  "claim": {
    "provider": "http",
    "parameters": "{\"url\":\"...\",\"method\":\"GET\",\"responseMatches\":[...]}",
    "context": "{\"extractedParameters\":{\"price\":\"2064.01\"}}",
    "owner": "0x...",
    "timestampS": 1775345832,
    "epoch": 1,
    "identifier": "0x..."
  },
  "signatures": {
    "attestorAddress": "0x...",
    "claimSignature": "0x..."
  }
}
```

- `claim.identifier` = `keccak256(provider + "\n" + parameters + "\n" + context)`
- `claim.parameters` = canonical JSON of the public request config (URL, method, matches — NOT secret headers)
- `claim.context` = JSON with `extractedParameters` from regex named capture groups
- `signatures.claimSignature` = EIP-191 personal sign over
  `identifier + "\n" + owner + "\n" + timestampS + "\n" + epoch`
- `signatures.attestorAddress` = Ethereum address of the Reclaim attestor that signed the claim

Error response (4xx/5xx):

```json
{
  "error": "Description of what went wrong"
}
```

### `GET /v1/health`

Response (200):

```json
{
  "status": "ok",
  "attestorUrl": "ws://attestor:8001/ws"
}
```

## How proving works

1. Service receives `POST /prove` with URL, method, headers, and extraction config.
2. Generates a throwaway owner key for this request.
3. Calls `createClaimOnAttestor()` from `@reclaimprotocol/attestor-core` with:
   - `name: 'http'` (the built-in HTTP provider)
   - `params`: URL, method, responseMatches, responseRedactions (public — committed to in the claim identifier)
   - `secretParams.headers`: the secret headers from the request (redacted via TLS KeyUpdate)
   - `zkEngine: 'gnark'` (native Go backend, ~2x faster than snarkjs)
   - `client: { url: ATTESTOR_WS_URL }` (WebSocket URL of the Reclaim attestor)
4. The attestor-core client:
   - Opens a WebSocket to the Reclaim attestor
   - Creates a TLS tunnel to the upstream API
   - Sends the HTTP request through the tunnel (with KeyUpdate around secret headers)
   - Captures the response
   - Generates ZK proofs (gnark) proving the response is authentic without revealing secret data
   - Submits the claim to the attestor for signing
5. Returns the signed claim to this service, which returns it to Airnode.

## Configuration

Environment variables:

| Variable           | Required | Default                  | Description                                    |
| ------------------ | -------- | ------------------------ | ---------------------------------------------- |
| `PORT`             | No       | `5177`                   | HTTP server port                               |
| `ATTESTOR_URL`     | No       | `ws://localhost:8001/ws` | WebSocket URL of the Reclaim attestor          |
| `ZK_ENGINE`        | No       | `gnark`                  | ZK proof engine: `gnark`, `snarkjs`, or `stwo` |
| `PROVE_TIMEOUT_MS` | No       | `30000`                  | Timeout for proof generation in milliseconds   |

The Reclaim attestor itself is configured via the shared `.env` file. Its only required env var is
`PRIVATE_KEY` — the Ethereum private key used to sign claims.

## Docker deployment

```bash
cp .env.example .env   # fill in PRIVATE_KEY
npm run docker:up      # builds gateway + pulls attestor
npm run docker:down    # tear down
```

Both services share a single `.env` file. The gateway reads all env vars from it; the attestor only needs `PRIVATE_KEY`.

## Testing

- Unit tests with vitest (not Bun — native module compatibility)
- Mock the Reclaim attestor for unit tests (mock `createClaimOnAttestor`)
- Integration tests should spin up a real attestor Docker container
- Each source file should have a co-located `.test.ts` file (e.g. `prove.ts` -> `prove.test.ts`)
- Tests must assert exact values, not just shapes
- Test cases:
  - Successful proof generation with a public API (CoinGecko)
  - API key redaction (secret headers not in proof output)
  - JSON field extraction via regex named capture groups
  - Gateway timeout handling
  - Attestor connection failure
  - Invalid request validation (missing URL, bad method)

## Code style

- Always order `scripts` in `package.json` alphabetically.
- Functions must never exceed 3 levels of nesting, preferably 2 at most. Extract nested logic into named functions.
- Always use early returns. Never use `else` blocks — invert the condition and return early.
- Use single quotes. Backticks only when interpolating.
- Wrap numeric values in `String()` in template literals: `` `Chain ${String(chain.id)}` ``.
- All interface properties are `readonly`. Arrays use `readonly T[]` or `ReadonlyArray<T>`. Maps use `ReadonlyMap`.
- No mutations. Use `map`, `filter`, `reduce`, `Object.fromEntries`, spread. When a mutation is necessary (loops,
  `Map.set`), annotate with an eslint-disable comment.
- Don't use non-null assertions (`!`). Use narrowing or optional chaining.
- Prefer readability over cleverness. Break complex expressions into named intermediate values.
- Use `go()` and `goSync()` from `@api3/promise-utils` instead of try/catch. These return `{ success, data, error }`
  discriminated unions. Only use try/catch in test files or when re-throwing is the only path.
- Named exports at the bottom of files with separate `export type { ... }` blocks.
- Use multilevel section comments to separate logical sections. No empty line after the closing `=` line:
  ```ts
  // =============================================================================
  // Section name
  // =============================================================================
  const foo = ...
  ```
  77 `=` signs at top-level (80 chars total with `// `). 75 when indented.

## Formatting and linting

Use Prettier for formatting and ESLint for linting (matching airnode-v2):

```bash
prettier . --write && eslint . --fix   # format + lint + fix
prettier . --check && eslint .         # check without writing
```

Prettier config (`.prettierrc`):

- Print width: 120
- Single quotes
- 2-space indent
- Trailing commas: es5

ESLint config (`eslint.config.mjs`):

- `typescript-eslint` strict type-checked
- `eslint-plugin-functional` (immutable data, no let, no loops)
- `eslint-plugin-unicorn` recommended
- `eslint-plugin-import` (alphabetical ordering, no cycles)
- `eslint-plugin-promise` recommended

After finishing writing code, always run `npm run fmt`.

## CI

GitHub Actions runs on push/PR to `main` (`.github/workflows/ci.yml`):

1. `npm run lint` — Prettier + ESLint checks
2. `npm run typecheck` — `tsc --noEmit`
3. `npm test` — vitest

All three run in a single job on Node 22.

## Git

Do not add `Co-authored-by` trailers referencing Claude in commit messages.

## Proof verification

Consumers can verify proofs off-chain:

```typescript
import { keccak256, toHex, recoverAddress, hashMessage } from 'viem';

// 1. Verify identifier hash
const computed = keccak256(toHex(claim.provider + '\n' + claim.parameters + '\n' + claim.context));
assert(computed === claim.identifier);

// 2. Verify attestor signature
const signData = [claim.identifier, claim.owner, String(claim.timestampS), String(claim.epoch)].join('\n');
const recovered = await recoverAddress({ hash: hashMessage(signData), signature: claimSignature });
assert(recovered === signatures.attestorAddress);
```

On-chain verification is available via Reclaim's deployed `verifyProof()` contracts on Ethereum, Polygon, Arbitrum,
BNB Chain, and others. See `@reclaimprotocol/verifier-solidity-sdk`.

## Performance

Benchmarked on M1 MacBook Pro with local Docker attestor:

| Phase                                 | Time      |
| ------------------------------------- | --------- |
| WebSocket connect + TLS tunnel        | ~0.5s     |
| ZK proof generation (2 proofs, gnark) | ~1.9s     |
| Attestor verification + signing       | ~1.0s     |
| **Total**                             | **~3.5s** |

gnark (native Go) is the default. snarkjs (JavaScript) takes ~3.3s for proofs alone.

Concurrent requests queue on the ZK proof generation step (CPU-bound). Scale horizontally by running multiple
gateway + attestor pairs behind a load balancer.

## Relationship to Airnode

Airnode calls this service when `settings.proof` is configured:

```yaml
# Airnode config.yaml
settings:
  proof:
    type: reclaim
    gatewayUrl: https://prove.chainapi.com
```

The proof is attached to Airnode's response alongside the existing EIP-191 signature:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1700000000,
  "data": "0x...",
  "signature": "0x...",
  "proof": {
    "claim": { ... },
    "signatures": { ... }
  }
}
```

The EIP-191 signature proves the airnode operator endorsed the data. The TLS proof proves the data actually came from
the upstream API. Together they provide both operator accountability and data provenance.

## Design context

### Users

ChainAPI operators deploying the attestor infrastructure. They are internal team members, technical, and value
reliability over features.

### Brand

Part of the API3 ecosystem (api3.org, market.api3.org). Technical, Trustworthy, Minimal.
