/**
 * /core - pure domain logic.
 *
 * Hard rule: nothing in this folder may import from Next.js, React, the DB
 * layer, or any storage client. A second game will reuse this folder as-is, so
 * it stays framework-free and storage-free. Data comes in as arguments,
 * results go out as return values.
 *
 * Nothing here reads the clock or generates randomness on its own: `now` and
 * `random` are always parameters. That is what makes the server the only
 * authority and every edge case testable.
 */
export * from './elements';
export * from './effects';
export * from './schemas';
export * from './affinity';
export * from './health';
export * from './stamina';
export * from './objectives';
export * from './eggs';
export * from './match3';
export * from './balance';
export * from './fields';
export * from './battle';
