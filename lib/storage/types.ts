/**
 * Image storage lives behind this interface so the implementation can move from
 * the local filesystem to Cloudflare R2 without touching a single caller.
 * Callers only ever see the returned `key` (stored in the DB) and `url`.
 */
export type StoredImage = {
  /** Stable identifier persisted in the database, e.g. "species/abc123.png". */
  key: string;
  /** Public URL for rendering. Derived from the key by the adapter. */
  url: string;
  contentType: string;
  size: number;
};

export type PutImageInput = {
  /** Logical folder, e.g. "species". */
  prefix: string;
  filename: string;
  contentType: string;
  data: ArrayBuffer | Uint8Array;
};

export interface ImageStorage {
  put(input: PutImageInput): Promise<StoredImage>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
