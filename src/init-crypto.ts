// Preload script for TLS crypto initialization.
// Load via: node --experimental-strip-types --import=./src/init-crypto.ts
//
// The @reclaimprotocol/tls package ships with an empty crypto object that must
// be initialized before any attestor-core code loads. The zk-symmetric-crypto
// package may have a nested copy that also needs initialization.

import { createRequire } from 'node:module';
import { setCryptoImplementation } from '@reclaimprotocol/tls';
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto';

setCryptoImplementation(webcryptoCrypto);

// The nested copy inside zk-symmetric-crypto doesn't resolve via normal ESM
// imports, so we use createRequire. It may not exist if dependencies are hoisted.
const require = createRequire(import.meta.url);
const NESTED_TLS = '@reclaimprotocol/zk-symmetric-crypto/node_modules/@reclaimprotocol/tls';

interface TlsModule {
  setCryptoImplementation: typeof setCryptoImplementation;
}
interface CryptoModule {
  crypto: typeof webcryptoCrypto;
}

try {
  const nestedTls = require(NESTED_TLS) as TlsModule;
  const nestedCrypto = require(`${NESTED_TLS}/lib/crypto/webcrypto`) as CryptoModule;
  nestedTls.setCryptoImplementation(nestedCrypto.crypto);
} catch {
  // Hoisted — primary initialization above is sufficient.
}

console.info('init-crypto: TLS crypto initialized');
