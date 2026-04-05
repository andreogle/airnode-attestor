import { go } from '@api3/promise-utils';
import type { proto } from '@reclaimprotocol/attestor-core';
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core';
import { toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ATTESTOR_URL, PROVE_TIMEOUT_MS, ZK_ENGINE } from './config.ts';
import { logger } from './logger.ts';
import type { ProveRequest, ProveResponse } from './types.ts';

// =============================================================================
// Helpers
// =============================================================================
const generateOwnerKey = (): { readonly privateKey: `0x${string}`; readonly address: string } => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
};

const buildClaimRequest = (request: ProveRequest, ownerPrivateKey: `0x${string}`): Record<string, unknown> => ({
  name: 'http' as const,
  params: {
    url: request.url,
    method: request.method,
    responseMatches: request.responseMatches ?? [],
    responseRedactions: request.responseRedactions ?? [],
  },
  secretParams: { headers: request.headers ?? {} },
  ownerPrivateKey,
  client: { url: ATTESTOR_URL },
  zkEngine: ZK_ENGINE,
});

const extractResult = (result: proto.ClaimTunnelResponse): ProveResponse => {
  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.claim || !result.signatures) {
    throw new Error('Attestor returned an incomplete response');
  }

  return {
    claim: {
      provider: result.claim.provider,
      parameters: result.claim.parameters,
      context: result.claim.context,
      owner: result.claim.owner,
      timestampS: result.claim.timestampS,
      epoch: result.claim.epoch,
      identifier: result.claim.identifier,
    },
    signatures: {
      attestorAddress: result.signatures.attestorAddress,
      claimSignature: toHex(result.signatures.claimSignature),
    },
  };
};

// =============================================================================
// Main
// =============================================================================
const prove = async (request: ProveRequest): Promise<ProveResponse> => {
  const owner = generateOwnerKey();
  logger.debug(`Owner address: ${owner.address}`);

  const claimRequest = buildClaimRequest(request, owner.privateKey);
  const result = await go(() => createClaimOnAttestor(claimRequest), { totalTimeoutMs: PROVE_TIMEOUT_MS });

  if (!result.success) {
    throw result.error;
  }

  return extractResult(result.data as proto.ClaimTunnelResponse);
};

export { prove };
