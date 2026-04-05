# airnode-attestor

HTTP service that generates TLS proofs for API responses using [Reclaim Protocol](https://reclaimprotocol.org/). It sits between [Airnode](https://github.com/api3dao/airnode) and a Reclaim attestor, providing cryptographic proof that API data is authentic.

## Table of contents

- [Why](#why)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [API](#api)
- [Configuration](#configuration)
- [Development](#development)
- [Proof verification](#proof-verification)
- [License](#license)

## Why

Airnode serves data from off-chain APIs, but consumers have no way to verify that the data actually came from the claimed source. An operator could modify responses before signing them and nobody would know.

This service closes that gap. By routing API calls through a Reclaim attestor, it produces a TLS proof that the response is authentic — cryptographic evidence that the data came directly from the upstream API, unmodified. Combined with Airnode's existing EIP-191 signature, consumers get both operator accountability and data provenance.

## How it works

1. Airnode sends a request to `POST /prove` with a URL, method, headers, and extraction config.
2. This service opens a WebSocket tunnel to a Reclaim attestor.
3. The attestor creates a TLS connection to the upstream API and captures the response.
4. ZK proofs are generated proving the response is authentic without revealing secret data (e.g., API keys).
5. The attestor signs the claim and returns it to Airnode.

```
Airnode ──POST /prove──> airnode-attestor ──WebSocket──> Reclaim Attestor ──TLS──> Upstream API
```

## Prerequisites

- Node.js 18+
- Docker (for running the Reclaim attestor)

## Quick start

```bash
npm run setup          # install deps, build native modules, download ZK circuits
cp .env.example .env   # fill in PRIVATE_KEY
npm run docker:up      # start attestor + gateway
```

The gateway is available at `http://localhost:5177`.

## API

### `POST /prove`

Generate a TLS proof for an API response.

```bash
curl -X POST http://localhost:5177/prove \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    "method": "GET",
    "responseMatches": [
      { "type": "regex", "value": "\"usd\":\\s*(?<price>[\\d.]+)" }
    ]
  }'
```

**Request body:**

| Field                | Type     | Required | Description                                            |
| -------------------- | -------- | -------- | ------------------------------------------------------ |
| `url`                | `string` | Yes      | Upstream API URL (must be http/https, no private IPs)  |
| `method`             | `string` | Yes      | HTTP method (`GET`, `POST`, `PUT`, `PATCH`)            |
| `headers`            | `object` | No       | Secret headers (redacted from proof via TLS KeyUpdate) |
| `responseMatches`    | `array`  | Yes      | Regex patterns the response must match (min 1)         |
| `responseRedactions` | `array`  | No       | JSON paths to selectively reveal to the attestor       |

**Response (200):**

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

### `GET /health`

Returns service status and attestor URL.

## Configuration

| Variable           | Default                  | Description                           |
| ------------------ | ------------------------ | ------------------------------------- |
| `PORT`             | `5177`                   | HTTP server port                      |
| `ATTESTOR_URL`     | `ws://localhost:8001/ws` | WebSocket URL of the Reclaim attestor |
| `ZK_ENGINE`        | `gnark`                  | ZK engine: `gnark`, `snarkjs`, `stwo` |
| `PROVE_TIMEOUT_MS` | `30000`                  | Proof generation timeout (ms)         |

## Development

```bash
npm run setup        # install deps + build native modules + download ZK circuits
npm run dev          # start with hot reload (requires a running attestor)
npm test             # run tests
npm run typecheck    # type check without emitting
npm run lint         # check formatting and linting
npm run fmt          # auto-fix formatting and linting
```

Docker commands:

```bash
npm run docker:up    # build gateway + pull attestor, start both
npm run docker:down  # tear down
```

## Proof verification

Proofs can be verified off-chain using `viem`:

```typescript
import { keccak256, toHex, recoverAddress, hashMessage } from 'viem';

// Verify the claim identifier
const computed = keccak256(toHex(claim.provider + '\n' + claim.parameters + '\n' + claim.context));
assert(computed === claim.identifier);

// Verify the attestor signature
const signData = [claim.identifier, claim.owner, String(claim.timestampS), String(claim.epoch)].join('\n');
const recovered = await recoverAddress({
  hash: hashMessage(signData),
  signature: claimSignature,
});
assert(recovered === signatures.attestorAddress);
```

On-chain verification is available via [`@reclaimprotocol/verifier-solidity-sdk`](https://github.com/reclaimprotocol/solidity-sdk).

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
