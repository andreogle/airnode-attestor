// Preload script for TLS crypto initialization.
// Load via: node --import=./src/esprima-next-loader.mjs --import=./src/init-crypto.ts
//
// The @reclaimprotocol/tls package ships with an empty crypto object that must
// be initialized before any attestor-core code loads. The zk-symmetric-crypto
// package has a nested copy of @reclaimprotocol/tls in its own node_modules/
// that also needs initialization.

import { createRequire } from 'node:module';
import { setCryptoImplementation } from '@reclaimprotocol/tls';
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto';

setCryptoImplementation(webcryptoCrypto);

// Initialize the nested copy inside zk-symmetric-crypto.
// This nested package doesn't resolve via normal ESM imports,
// so we use createRequire to reach into its node_modules.
const require = createRequire(import.meta.url);

try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const nestedTls = require('@reclaimprotocol/zk-symmetric-crypto/node_modules/@reclaimprotocol/tls');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const nestedCrypto = require('@reclaimprotocol/zk-symmetric-crypto/node_modules/@reclaimprotocol/tls/lib/crypto/webcrypto');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  nestedTls.setCryptoImplementation(nestedCrypto.crypto);
} catch {
  // The nested copy may not exist if dependencies are hoisted.
  // In that case the primary initialization above is sufficient.
}

console.info('init-crypto: TLS crypto initialized');
