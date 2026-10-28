export interface GstinData {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  /** Filled when you pass `include: 'profile'`; otherwise usually null. */
  business_constitution: string | null;
  /** ISO 8601 date, e.g. "2017-07-01". */
  registration_date: string | null;
  cancellation_date: string | null;
  state_code: string | null;
  /** Filled when you pass `include: 'profile'`; otherwise usually null. */
  state_jurisdiction: string | null;
  address: string | null;
  pincode: string | null;
  /** Filled when you pass `include: 'profile'`; otherwise usually null. */
  nature_of_business: string[] | null;
  block_status: string | null;
  /** Principal place of business split into parts. Parts the GST network holds no value for are null. */
  address_details?: AddressDetails | null;

  // Present only when the lookup was made with `include: 'profile'`.
  // Null when the profile could not be fetched (see `profile_complete`).
  state_jurisdiction_code?: string | null;
  centre_jurisdiction?: string | null;
  centre_jurisdiction_code?: string | null;
  /** "Yes" or "No": whether the taxpayer is enabled for e-invoicing. */
  einvoice_status?: string | null;
  /** ISO 8601 date the GST network last updated the record. */
  last_updated?: string | null;
  additional_addresses?: AdditionalAddress[] | null;
}

export interface AddressDetails {
  building_number: string | null;
  building_name: string | null;
  floor: string | null;
  street: string | null;
  locality: string | null;
  /** Filled only with `include: 'profile'`. */
  district: string | null;
  /** Filled only with `include: 'profile'`. */
  city: string | null;
  state: string | null;
  landmark: string | null;
  pincode: string | null;
}

export interface AdditionalAddress {
  address: string | null;
  city: string | null;
  pincode: string | null;
  nature: string | null;
}

/** Extra data a lookup can ask for. */
export type LookupInclude = 'profile';

export interface LookupOptions {
  /** `'profile'` adds the taxpayer profile at no extra credit. */
  include?: LookupInclude;
}

export interface LookupResult {
  success: true;
  gstin: string;
  data: GstinData;
  credits_remaining: number;
  response_ms: number;
  /**
   * Present only when `include: 'profile'` was passed. `false` means the
   * lookup succeeded but the profile could not be fetched, so the profile
   * fields are null.
   */
  profile_complete?: boolean;
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
  lookup(gstin: string, options?: LookupOptions): Promise<LookupResult>;
  usage(): Promise<UsageStats>;
  lookupMany(gstins: string[], options?: { concurrency?: number; include?: LookupInclude }): Promise<BatchResult[]>;
}

export function isValidGstin(gstin: string, options?: { checksum?: boolean }): boolean;
export function gstinChecksum(gstin: string): string | null;
export const ERROR_CODES: Record<number, GstinErrorCode>;
