import { LocalImageStorage } from './local';
import type { ImageStorage } from './types';

export * from './types';
export { LocalImageStorage } from './local';

/**
 * The only place that decides which storage adapter is in use — the same shape
 * as db/client.ts. When R2 arrives it is selected here and nowhere else; no
 * caller learns which one it got.
 */
let cached: ImageStorage | null = null;

export function imageStorage(): ImageStorage {
  cached ??= new LocalImageStorage();
  return cached;
}
