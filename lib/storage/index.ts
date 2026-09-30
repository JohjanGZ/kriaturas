import { CloudinaryImageStorage, cloudinaryFromEnv } from './cloudinary';
import { LocalImageStorage } from './local';
import type { ImageStorage } from './types';

export * from './types';
export { LocalImageStorage } from './local';
export { CloudinaryImageStorage, cloudinaryFromEnv } from './cloudinary';

/**
 * The only place that decides which storage adapter is in use — the same shape
 * as db/client.ts, and for the same reason: no caller learns which one it got.
 *
 * The ENVIRONMENT chooses, exactly like `DATABASE_URL` chooses the driver.
 * Cloudinary when its three credentials are present, the local disk otherwise.
 * That ordering is deliberate: a laptop keeps writing to `public/uploads` and
 * needs no account, while a hosted deploy — which has no writable disk at all —
 * gets Cloudinary by having the variables set. Neither one has a flag to forget.
 */
let cached: ImageStorage | null = null;

export function imageStorage(): ImageStorage {
  if (cached) return cached;

  const cloudinary = cloudinaryFromEnv();
  cached = cloudinary ? new CloudinaryImageStorage(cloudinary) : new LocalImageStorage();
  return cached;
}

/** Which adapter is live, for a deploy to be able to say so out loud. */
export function storageKind(): 'cloudinary' | 'local' {
  return cloudinaryFromEnv() ? 'cloudinary' : 'local';
}
