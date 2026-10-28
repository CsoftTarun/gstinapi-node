# gstinapi

Node.js client for [gstinapi.in](https://www.gstinapi.in) — search any Indian **GST number (GSTIN)** and get back the legal name, trade name, GST status, taxpayer type and registered address, live from India's official GSP network.

No dependencies. Works with Node 18+.

```bash
npm install gstinapi
```

## Quick start

```js
const { GstinApi } = require('gstinapi');

const client = new GstinApi({ apiKey: process.env.GSTIN_API_KEY });

const result = await client.lookup('33AAACC1206D1ZN');

console.log(result.data.legal_name);   // CENTRAL WAREHOUSING CORPORATION
console.log(result.data.status);       // Active
console.log(result.credits_remaining); // 9
```

ESM works too:

```js
import { GstinApi } from 'gstinapi';
```

Get an API key at [gstinapi.in/register](https://www.gstinapi.in/register) — every account gets up to 100 free lookups, no card required.

## Why use this instead of calling the API directly

**It refuses to spend a credit on a GSTIN that cannot exist.** The 15th character of a GSTIN is a checksum over the first 14. This client verifies it locally before making a request, so a mistyped number fails instantly and for free:

```js
const { isValidGstin } = require('gstinapi');

isValidGstin('33AAACC1206D1ZN'); // true
isValidGstin('22AAAAA0000A1Z5'); // false — pattern is fine, checksum is not
```

The API itself only checks the pattern, so that second number would have cost you a request.

**It retries the right failures.** A 429 or 502 is worth asking again with backoff. A 402 or 404 is not — repeating those only wastes time, so it doesn't.

## Errors

Every failure throws a `GstinError` carrying a `status` and a stable `code`, so you can branch without string-matching:

```js
const { GstinApi, GstinError } = require('gstinapi');

try {
  await client.lookup(gstin);
} catch (err) {
  if (err instanceof GstinError) {
    switch (err.code) {
      case 'NOT_FOUND':            return 'This GST number is not registered.';
      case 'INSUFFICIENT_CREDITS': return 'Out of credits — top up to continue.';
      case 'INVALID_FORMAT':       return 'That does not look like a GST number.';
      default:                     return err.message;
    }
  }
  throw err;
}
```

| `code` | HTTP | Meaning |
|---|---|---|
| `INVALID_FORMAT` | 400 | Not a valid GSTIN. No credit charged. |
| `UNAUTHORIZED` | 401 | Missing or wrong API key. |
| `INSUFFICIENT_CREDITS` | 402 | Out of credits. |
| `ACCOUNT_DEACTIVATED` | 403 | Account disabled. |
| `NOT_FOUND` | 404 | GSTIN is not in the GST database. |
| `RATE_LIMITED` | 429 | Over 60 requests/minute. Retried automatically. |
| `PROVIDER_UNAVAILABLE` | 502 | Upstream GST network hiccup. Retried automatically. |
| `TIMEOUT` / `NETWORK` | — | Request never completed. |

## Taxpayer profile (`include: 'profile'`)

Pass `include: 'profile'` to get the taxpayer's profile in the same call, at no extra credit:

```js
const result = await client.lookup('33AAACC1206D1ZN', { include: 'profile' });

result.data.business_constitution;   // constitution of business
result.data.state_jurisdiction;      // state jurisdiction (and _code)
result.data.centre_jurisdiction;     // centre jurisdiction (and _code)
result.data.nature_of_business;      // array of activities at the principal place
result.data.einvoice_status;         // 'Yes' | 'No'
result.data.last_updated;            // date the GST network last updated the record
result.data.additional_addresses;    // additional places of business
result.data.address_details.city;    // district and city are filled only with the profile
result.profile_complete;             // false = lookup succeeded, profile could not be fetched
```

The profile is best-effort: if it cannot be fetched, the lookup still succeeds, the profile fields come back `null` and `profile_complete` is `false`. It works with bulk lookups too:

```js
await client.lookupMany(gstins, { concurrency: 5, include: 'profile' });
```

## Bulk lookups

`lookupMany` runs with bounded concurrency and settles each entry separately, so one bad number never sinks the batch:

```js
const results = await client.lookupMany(gstins, { concurrency: 5 });

for (const r of results) {
  if (r.ok) console.log(r.gstin, r.data.data.legal_name);
  else      console.warn(r.gstin, r.error.code);
}
```

## Usage stats

```js
await client.usage();
// { total_calls: 42, success: 40, errors: 2, credits_used: 40 }
```

This does not consume a credit.

## Options

```js
new GstinApi({
  apiKey: process.env.GSTIN_API_KEY, // required
  timeout: 15000,                    // per attempt, ms
  retries: 2,                        // 429/502 only
  validateChecksum: true,            // set false to match the API exactly
});
```

## What you get back

```js
{
  success: true,
  gstin: '33AAACC1206D1ZN',
  credits_remaining: 9,
  response_ms: 182,
  data: {
    gstin: '33AAACC1206D1ZN',
    legal_name: 'CENTRAL WAREHOUSING CORPORATION',
    trade_name: 'CENTRAL WAREHOUSING CORPORATION',
    status: 'Active',
    taxpayer_type: 'Regular',
    business_constitution: null,
    registration_date: '2017-07-01',
    cancellation_date: null,
    state_code: '33',
    state_jurisdiction: null,
    address: 'No.4, North Avenue, Saidapet, Chennai',
    pincode: '600015',
    nature_of_business: null,
    block_status: 'Unblocked'
  }
}
```

`business_constitution`, `state_jurisdiction` and `nature_of_business` are usually `null` on a plain lookup. Pass `include: 'profile'` (see above) to have them filled.

## Keep your key on the server

The API key is a credential: anyone holding it can spend your credits. Read it from an environment variable and call this library from your backend, never from browser code.

## Links

- [API documentation](https://www.gstinapi.in/docs)
- [Free GST number search](https://www.gstinapi.in/gst-number-search)
- [Pricing](https://www.gstinapi.in/pricing)

## License

MIT
