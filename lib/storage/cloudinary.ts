import { createHash, randomUUID } from 'node:crypto';
import {
  ALLOWED_IMAGE_TYPES,
  type ImageStorage,
  MAX_IMAGE_BYTES,
  type PutImageInput,
  type StoredImage,
} from './types';

/**
 * Cloudinary adapter — what a hosted deploy uses instead of the disk.
 *
 * A server has no writable filesystem, so `LocalImageStorage` cannot work up
 * there. This is the swap the `ImageStorage` interface existed for: one new
 * file, chosen in `lib/storage/index.ts`, and not a single caller changes.
 *
 * NO SDK. The upload API is one signed POST and the delete is another, so a
 * dependency would buy nothing and carry its own update treadmill. `fetch`,
 * `FormData` and `node:crypto` are all already there.
 *
 * WHAT IS STORED IS THE `public_id`, not a URL. A URL in the database freezes
 * today's host, today's CDN and today's transformation; an id lets `urlFor`
 * decide all three at render time — which is how `f_auto,q_auto` can be added
 * to every image ever uploaded without a migration.
 */

export type CloudinaryCredentials = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Everything lands under this, so one account can host several projects. */
  folder?: string;
};

/**
 * THE SIGNATURE, which is the only part worth getting exactly right.
 *
 * Cloudinary signs the parameters you send, sorted by name, joined as
 * `k=v&k=v`, with the API secret appended — SHA-1 of that string. Three
 * parameters are never signed: `file` (it is the payload), `api_key` (it is the
 * identity, sent alongside) and `resource_type` (it is part of the URL). Signing
 * one of those, or forgetting to sort, fails with a message that says only
 * "Invalid Signature" and gives no hint which of the two it was.
 */
export function signParams(
  params: Readonly<Record<string, string | number>>,
  apiSecret: string,
): string {
  const unsigned = new Set(['file', 'api_key', 'resource_type', 'cloud_name']);
  const payload = Object.keys(params)
    .filter((key) => !unsigned.has(key))
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');

  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

/** Keeps a prefix to one harmless path segment, like the local adapter does. */
function sanitisePrefix(prefix: string): string {
  const clean = prefix.replace(/[^a-z0-9-]/gi, '');
  return clean.length > 0 ? clean : 'misc';
}

export class CloudinaryImageStorage implements ImageStorage {
  constructor(private readonly credentials: CloudinaryCredentials) {}

  async put(input: PutImageInput): Promise<StoredImage> {
    /**
     * Re-validated HERE, not only in the form. The adapter is what talks to the
     * outside world, and it is reachable from any action that can be addressed
     * on its own.
     */
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.contentType)) {
      throw new Error(`Formato no admitido: ${input.contentType}`);
    }

    const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }

    /**
     * The id is a server-generated UUID under a fixed folder — never the
     * uploaded filename. User input must not decide where a file lands, here no
     * less than on a disk: a `public_id` is a path on somebody else's server.
     */
    const folder = [this.credentials.folder, sanitisePrefix(input.prefix)]
      .filter(Boolean)
      .join('/');
    const publicId = `${folder}/${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const signed = { public_id: publicId, timestamp };
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: input.contentType }),
      input.filename,
    );
    form.append('api_key', this.credentials.apiKey);
    form.append('public_id', publicId);
    form.append('timestamp', String(timestamp));
    form.append('signature', signParams(signed, this.credentials.apiSecret));

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.credentials.cloudName}/image/upload`,
      { method: 'POST', body: form },
    );

    if (!response.ok) {
      /**
       * Cloudinary's errors are legible, so they are passed through rather than
       * flattened into "algo falló": "Invalid Signature" and "Invalid cloud
       * name" need completely different fixes, and hiding which one it was
       * sends whoever sees it looking in the wrong place.
       */
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Cloudinary rechazó la subida (${response.status}). ${detail.slice(0, 300)}`,
      );
    }

    const body = (await response.json()) as { public_id?: string; bytes?: number };
    const key = body.public_id ?? publicId;

    return {
      key,
      url: this.urlFor(key),
      contentType: input.contentType,
      size: body.bytes ?? bytes.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.append('api_key', this.credentials.apiKey);
    form.append('public_id', key);
    form.append('timestamp', String(timestamp));
    form.append(
      'signature',
      signParams({ public_id: key, timestamp }, this.credentials.apiSecret),
    );

    /**
     * A failed delete is LOGGED, not thrown. The caller is deleting a species
     * or replacing a drawing, and refusing to do that because a file somewhere
     * else could not be tidied up would be the wrong trade — the orphan costs
     * nothing but storage.
     */
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.credentials.cloudName}/image/destroy`,
      { method: 'POST', body: form },
    );
    if (!response.ok) {
      console.error(`Cloudinary no borró ${key}: ${response.status}`);
    }
  }

  /**
   * `f_auto,q_auto` is free and it is the whole reason to store an id instead of
   * a URL: Cloudinary picks the format the asking browser prefers (WebP, AVIF)
   * and a quality it cannot tell from the original. On a phone over mobile data
   * — which is what this game is for — that is the difference between artwork
   * that appears and artwork that loads.
   */
  urlFor(key: string): string {
    const clean = key.replace(/^\/+/, '');
    return `https://res.cloudinary.com/${this.credentials.cloudName}/image/upload/f_auto,q_auto/${clean}`;
  }
}

/**
 * Reads the credentials from the environment, or null when they are not all
 * there.
 *
 * All three or none: a cloud name with no secret cannot sign, and an adapter
 * that half-configures itself fails later, inside an upload, instead of at the
 * only moment anybody is looking.
 */
export function cloudinaryFromEnv(): CloudinaryCredentials | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;

  return {
    cloudName,
    apiKey,
    apiSecret,
    folder: process.env.CLOUDINARY_FOLDER ?? 'kriaturas',
  };
}
