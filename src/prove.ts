import type { ProveRequest, ProveResponse } from './types.ts';

const prove = async (_request: ProveRequest): Promise<ProveResponse> => {
  // TODO: Implement proving logic with createClaimOnAttestor
  throw new Error('Not implemented');
};

export { prove };
