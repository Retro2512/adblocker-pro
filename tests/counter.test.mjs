import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared/counter.js';
const {record, total} = globalThis.QuietGateCounter;
const digest = value => value.toString(16).padStart(64, '0');
test('a repeated hold counts once per item and document', () => {
  const first = record(null, 'document1', digest(1));
  assert.equal(first.added, true);
  const repeated = record(first.state, 'document1', digest(1));
  assert.equal(repeated.added, false);
  assert.equal(record(repeated.state, 'document1', digest(2)).added, true);
});
test('a new page visit can count the same item again', () => {
  const first = record(null, 'document1', digest(1));
  const next = record(first.state, 'document2', digest(1));
  assert.equal(next.added, true);
  assert.equal(next.state.seen.length, 1);
});
test('counter deduplication stays bounded without mutating previous state', () => {
  let state;
  for (let n = 0; n < 300; n++) state = record(state, 'document1', digest(n)).state;
  assert.equal(state.seen.length, 256);
  const before = structuredClone(state);
  record(state, 'document1', digest(400));
  assert.deepEqual(state, before);
});
test('invalid stored totals cannot produce a misleading number', () => {
  for (const value of [-1, NaN, Infinity, '999', null, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(total(value), 0);
  assert.equal(total(1234), 1234);
  assert.equal(total(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});
