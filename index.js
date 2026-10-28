'use strict';

const BASE_URL = 'https://www.gstinapi.in';
const USER_AGENT = 'gstinapi-node/1.1.0 (+https://www.gstinapi.in)';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Error thrown for any non-2xx response. `status` and `code` let you branch. */
class GstinError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.name = 'GstinError';
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

/**
 * The 15th character of a GSTIN is a checksum over the first 14. Verifying it
 * locally catches the common transcription slips — a swapped pair, a mistyped
 * digit — without spending a credit on a request that cannot succeed.
 */
function gstinChecksum(gstin) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHECKSUM_ALPHABET.indexOf(gstin[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHECKSUM_ALPHABET[(36 - (sum % 36)) % 36];
}

/**
 * True when `gstin` is structurally a valid GSTIN.
 * @param {string} gstin
 * @param {{ checksum?: boolean }} [options] set `checksum: false` to check the
 *   pattern only, matching exactly what the API itself accepts.
 */
function isValidGstin(gstin, options = {}) {
  const { checksum = true } = options;
  if (typeof gstin !== 'string') return false;
  const value = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(value)) return false;
  if (!checksum) return true;
  return gstinChecksum(value) === value[14];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Values the API understands for ?include=. Checked locally because the API
// ignores an unknown value: a typo would otherwise come back as a plain
// lookup, charged, with the extra fields silently missing.
const INCLUDE_VALUES = ['profile'];

function includeQuery(include) {
  if (include === undefined || include === null) return '';
  if (!INCLUDE_VALUES.includes(include)) {
    throw new TypeError(`include must be one of: ${INCLUDE_VALUES.map(v => `'${v}'`).join(', ')}`);
  }
  return `?include=${include}`;
}

class GstinApi {
  /**
   * @param {object} options
   * @param {string} options.apiKey       from https://www.gstinapi.in/api-keys
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout]    per-attempt timeout in ms (default 15000)
   * @param {number} [options.retries]    retries for 429/502 only (default 2)
   * @param {boolean} [options.validateChecksum] reject bad checksums locally (default true)
   */
  constructor(options = {}) {
    const { apiKey, baseUrl = BASE_URL, timeout = 15000, retries = 2, validateChecksum = true } = options;
    if (!apiKey) throw new TypeError('apiKey is required — get one at https://www.gstinapi.in/api-keys');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = timeout;
    this.retries = retries;
    this.validateChecksum = validateChecksum;
  }

  async _request(path) {
    // Only 429 and 502 are worth repeating. A 402 will not become a 200 by
    // asking again, and retrying a 404 just burns time.
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      let res, body;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          headers: {
            'x-api-key': this.apiKey,
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          signal: controller.signal,
        });
        body = await res.json().catch(() => ({}));
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new GstinError(`Request timed out after ${this.timeout}ms`, { code: 'TIMEOUT' });
        throw new GstinError(err.message, { code: 'NETWORK' });
      }
      clearTimeout(timer);

      if (res.ok) return body;

      const retryable = res.status === 429 || res.status === 502;
      if (retryable && attempt < this.retries) {
        await sleep(2 ** attempt * 500);
        attempt++;
        continue;
      }
      throw new GstinError(body.error || `Request failed with status ${res.status}`, {
        status: res.status,
        code: ERROR_CODES[res.status] || 'HTTP_ERROR',
        response: body,
      });
    }
  }

  /**
   * Look up one GSTIN.
   * @param {string} gstin
   * @param {{ include?: 'profile' }} [options] `include: 'profile'` adds the
   *   taxpayer profile (constitution, jurisdictions, nature of business,
   *   e-invoice status, additional places of business) at no extra credit.
   * @returns {Promise<object>} `{ success, gstin, data, credits_remaining, response_ms }`,
   *   plus `profile_complete` when a profile was requested
   */
  async lookup(gstin, options = {}) {
    if (typeof gstin !== 'string' || !gstin.trim()) throw new TypeError('gstin must be a non-empty string');
    const query = includeQuery((options || {}).include);
    const value = gstin.trim().toUpperCase();
    if (!isValidGstin(value, { checksum: this.validateChecksum })) {
      throw new GstinError(`"${value}" is not a valid GSTIN`, { status: 400, code: 'INVALID_FORMAT' });
    }
    return this._request(`/v1/gstin/${encodeURIComponent(value)}${query}`);
  }

  /** Today's usage for this key. Does not consume a credit. */
  async usage() {
    return this._request('/v1/gstin/stats/me');
  }

  /**
   * Look up many GSTINs with bounded concurrency, resolving to one settled
   * entry per input so a single bad number cannot sink the batch.
   * @param {string[]} gstins
   * @param {{ concurrency?: number, include?: 'profile' }} [options]
   * @returns {Promise<Array<{ gstin: string, ok: boolean, data?: object, error?: GstinError }>>}
   */
  async lookupMany(gstins, options = {}) {
    if (!Array.isArray(gstins)) throw new TypeError('gstins must be an array');
    const { concurrency = 5, include } = options || {};
    // Fail the whole call up front on a bad include, rather than once per row.
    includeQuery(include);
    const results = new Array(gstins.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < gstins.length) {
        const index = cursor++;
        const gstin = gstins[index];
        try {
          results[index] = { gstin, ok: true, data: await this.lookup(gstin, { include }) };
        } catch (error) {
          results[index] = { gstin, ok: false, error };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, gstins.length) }, worker));
    return results;
  }
}

const ERROR_CODES = {
  400: 'INVALID_FORMAT',
  401: 'UNAUTHORIZED',
  402: 'INSUFFICIENT_CREDITS',
  403: 'ACCOUNT_DEACTIVATED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
  502: 'PROVIDER_UNAVAILABLE',
};

module.exports = { GstinApi, GstinError, isValidGstin, gstinChecksum, ERROR_CODES };
