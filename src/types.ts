// =============================================================================
// HTTP primitives
// =============================================================================
interface JsonResponse {
  readonly status: number;
  readonly body: string;
}

interface SanitizedError {
  readonly status: number;
  readonly message: string;
}

// =============================================================================
// Request types
// =============================================================================
interface ResponseMatch {
  readonly type: 'regex';
  readonly value: string;
}

interface ResponseRedaction {
  readonly jsonPath: string;
}

interface ProveRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  readonly headers?: Readonly<Record<string, string>>;
  readonly responseMatches?: readonly ResponseMatch[];
  readonly responseRedactions?: readonly ResponseRedaction[];
}

// =============================================================================
// Response types
// =============================================================================
interface Claim {
  readonly provider: string;
  readonly parameters: string;
  readonly context: string;
  readonly owner: string;
  readonly timestampS: number;
  readonly epoch: number;
  readonly identifier: string;
}

interface Signatures {
  readonly attestorAddress: string;
  readonly claimSignature: string;
}

interface ProveResponse {
  readonly claim: Claim;
  readonly signatures: Signatures;
}

interface ErrorResponse {
  readonly error: string;
}

interface HealthResponse {
  readonly status: 'ok';
  readonly attestorUrl: string;
}

export type {
  Claim,
  ErrorResponse,
  HealthResponse,
  JsonResponse,
  ProveRequest,
  ProveResponse,
  ResponseMatch,
  ResponseRedaction,
  SanitizedError,
  Signatures,
};
