'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { GstinApi, GstinError, isValidGstin, gstinChecksum } = require('..');

const VALID = '33AAACC1206D1ZN';
const BAD_CHECKSUM = '22AAAAA0000A1Z5';

/** Swap global fetch for a queue of canned responses; returns the call log. */
function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    // Keep replaying the final entry once the queue runs down, so a test can
    // describe "always fails" with a single response.
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('isValidGstin accepts a real GSTIN', () => {
  assert.equal(isValidGstin(VALID), true);
  assert.equal(isValidGstin(VALID.toLowerCase()), true, 'should be case insensitive');
  assert.equal(isValidGstin(`  ${VALID}  `), true, 'should tolerate surrounding space');
});

test('isValidGstin rejects a bad checksum, but not when checksum is off', () => {
  assert.equal(isValidGstin(BAD_CHECKSUM), false);
  assert.equal(isValidGstin(BAD_CHECKSUM, { checksum: false }), true,
    'pattern-only mode should match what the API itself accepts');
});

test('isValidGstin rejects malformed input', () => {
  for (const bad of ['', 'ABC', '33AAACC1206D1Z', '33AAACC1206D1ZNX', null, undefined, 42]) {
    assert.equal(isValidGstin(bad), false, `expected ${String(bad)} to be invalid`);
  }
});

test('gstinChecksum computes the 15th character', () => {
  assert.equal(gstinChecksum(VALID), 'N');
  assert.notEqual(gstinChecksum(BAD_CHECKSUM), '5');
});

test('constructor requires an apiKey', () => {
  assert.throws(() => new GstinApi({}), TypeError);
  assert.doesNotThrow(() => new GstinApi({ apiKey: 'gak_x' }));
});

test('lookup rejects a bad GSTIN without touching the network', async () => {
  const { calls, restore } = mockFetch([{ status: 200 }]);
  try {
    const client = new GstinApi({ apiKey: 'gak_x' });
    await assert.rejects(() => client.lookup(BAD_CHECKSUM), err => {
      assert.equal(err.code, 'INVALID_FORMAT');
      return true;
    });
    assert.equal(calls.length, 0, 'no credit should be spent on a doomed request');
  } finally { restore(); }
});

test('lookup sends the api key and returns the payload', async () => {
  const payload = { success: true, gstin: VALID, data: { legal_name: 'ACME' }, credits_remaining: 9 };
  const { calls, restore } = mockFetch([{ status: 200, body: payload }]);
  try {
    const client = new GstinApi({ apiKey: 'gak_secret' });
    const result = await client.lookup(VALID.toLowerCase());
    assert.deepEqual(result, payload);
    assert.equal(calls[0].headers['x-api-key'], 'gak_secret');
    assert.ok(calls[0].url.endsWith(`/v1/gstin/${VALID}`), 'should uppercase before sending');
  } finally { restore(); }
});

test('retries a 502 then succeeds', async () => {
  const { calls, restore } = mockFetch([
    { status: 502, body: { error: 'provider down' } },
    { status: 200, body: { success: true } },
  ]);
  try {
    const client = new GstinApi({ apiKey: 'gak_x', retries: 2 });
    const result = await client.lookup(VALID);
    assert.equal(result.success, true);
    assert.equal(calls.length, 2);
  } finally { restore(); }
});

test('does not retry a 402, and surfaces a usable code', async () => {
  const { calls, restore } = mockFetch([{ status: 402, body: { error: 'Insufficient credits.' } }]);
  try {
    const client = new GstinApi({ apiKey: 'gak_x', retries: 3 });
    await assert.rejects(() => client.lookup(VALID), err => {
      assert.ok(err instanceof GstinError);
      assert.equal(err.status, 402);
      assert.equal(err.code, 'INSUFFICIENT_CREDITS');
      assert.match(err.message, /Insufficient credits/);
      return true;
    });
    assert.equal(calls.length, 1, 'retrying a credit failure only wastes time');
  } finally { restore(); }
});

test('gives up after the retry budget', async () => {
  const { calls, restore } = mockFetch([{ status: 429, body: { error: 'slow down' } }]);
  try {
    const client = new GstinApi({ apiKey: 'gak_x', retries: 2 });
    await assert.rejects(() => client.lookup(VALID), err => err.code === 'RATE_LIMITED');
    assert.equal(calls.length, 3, 'one attempt plus two retries');
  } finally { restore(); }
});

test('lookupMany settles every entry independently', async () => {
  const { restore } = mockFetch([
    { status: 200, body: { success: true, gstin: VALID } },
    { status: 404, body: { error: 'GSTIN not found in GST database' } },
  ]);
  try {
    const client = new GstinApi({ apiKey: 'gak_x', retries: 0 });
    const results = await client.lookupMany([VALID, VALID, BAD_CHECKSUM], { concurrency: 1 });
    assert.equal(results.length, 3);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error.code, 'NOT_FOUND');
    assert.equal(results[2].ok, false, 'a locally-invalid GSTIN must not sink the batch');
    assert.equal(results[2].error.code, 'INVALID_FORMAT');
  } finally { restore(); }
});
