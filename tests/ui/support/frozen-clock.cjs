'use strict';

// Date.now() alone does not freeze new Date(), which is used by calendar range
// reducers. Keep both consistent, preserving explicit Date constructor values.
// Leases also restore correctly if asynchronous harness calls finish out of order.
const leases = [];

exports.freezeClock = function freezeClock(now) {
  if (!Number.isFinite(now)) throw new RangeError('A finite fixture timestamp is required');
  const original = globalThis.Date;
  const frozen = new Proxy(original, {
    apply: () => new original(now).toString(),
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now], newTarget),
    get: (target, key, receiver) => key === 'now' ? () => now : Reflect.get(target, key, receiver),
  });
  const lease = { original, frozen, released: false };
  leases.push(lease);
  globalThis.Date = frozen;
  return () => {
    lease.released = true;
    while (leases.at(-1)?.released) {
      const completed = leases.pop();
      if (globalThis.Date === completed.frozen) globalThis.Date = completed.original;
    }
  };
};
