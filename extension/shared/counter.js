(() => {
  'use strict';
  const LIMIT = 256;
  function total(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  function record(previous, documentId, digest) {
    const sameDocument = previous?.documentId === documentId;
    const seen = sameDocument && Array.isArray(previous.seen)
      ? previous.seen.filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)).slice(-LIMIT)
      : [];
    if (seen.includes(digest)) return {added: false, state: {documentId, seen}};
    return {added: true, state: {documentId, seen: [...seen, digest].slice(-LIMIT)}};
  }
  globalThis.QuietGateCounter = Object.freeze({total, record});
})();
