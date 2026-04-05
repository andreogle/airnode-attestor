// Preload script for TLS crypto initialization.
// Load via: node --import=./src/init-crypto.ts
//
// The @reclaimprotocol/tls package ships with an empty crypto object that must
// be initialized before any attestor-core code loads. The zk-symmetric-crypto
// package has a nested copy that also needs initialization.

// TODO: Initialize crypto implementations once dependencies are installed
// import { setCryptoImplementation } from '@reclaimprotocol/tls';
// import { webcryptoCrypto } from '@reclaimprotocol/tls/lib/crypto/webcrypto';
// setCryptoImplementation(webcryptoCrypto);

console.log('init-crypto: TLS crypto initialization (stub)');
