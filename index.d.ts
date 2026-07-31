export interface GstinData {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  /** Always null on the current provider. */
  business_constitution: string | null;
  /** ISO 8601 date, e.g. "2017-07-01". */
  registration_date: string | null;
  cancellation_date: string | null;
  state_code: string | null;
  /** Always null on the current provider. */
  state_jurisdiction: string | null;
  address: string | null;
  pincode: string | null;
  /** Always null on the current provider. */
  nature_of_business: string[] | null;
  block_status: string | null;
}

export interface LookupResult {
  success: true;
  gstin: string;
  data: GstinData;
  credits_remaining: number;
  response_ms: number;
}

export interface UsageStats {
  total_calls: number;
  success: number;
  errors: number;
  credits_used: number;
}

export type GstinErrorCode =
  | 'INVALID_FORMAT'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'ACCOUNT_DEACTIVATED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK';

export class GstinError extends Error {
  name: 'GstinError';
  status?: number;
  code?: GstinErrorCode;
  response?: unknown;
}

export interface GstinApiOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-attempt timeout in ms. Default 15000. */
  timeout?: number;
  /** Retries for 429/502 only. Default 2. */
  retries?: number;
  /** Reject bad checksums before spending a credit. Default true. */
  validateChecksum?: boolean;
}

export interface BatchResult {
  gstin: string;
  ok: boolean;
  data?: LookupResult;
  error?: GstinError;
}

export class GstinApi {
  constructor(options: GstinApiOptions);
  lookup(gstin: string): Promise<LookupResult>;
  usage(): Promise<UsageStats>;
  lookupMany(gstins: string[], options?: { concurrency?: number }): Promise<BatchResult[]>;
}

export function isValidGstin(gstin: string, options?: { checksum?: boolean }): boolean;
export function gstinChecksum(gstin: string): string | null;
export const ERROR_CODES: Record<number, GstinErrorCode>;
