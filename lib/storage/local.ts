import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ALLOWED_IMAGE_TYPES,
  type ImageStorage,
  MAX_IMAGE_BYTES,
  type PutImageInput,
  type StoredImage,
} from './types';

/**
 * Local filesystem adapter — development only.
 *
 * Writes under public/uploads so Next serves the file directly. This does NOT
 * survive a deploy to Cloudflare Workers (no writable filesystem), which is
 * exactly why every caller goes through the ImageStorage interface: swapping in
 * an R2 adapter later changes this one file and nothing else.
 */

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export class LocalImageStorage implements ImageStorage {
  constructor(
    private readonly root: string = path.join(process.cwd(), 'public', 'uploads'),
    private readonly publicBase: string = '/uploads',
  ) {}

  async put(input: PutImageInput): Promise<StoredImage> {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.contentType)) {
      throw new Error(`Formato no admitido: ${input.contentType}`);
    }

    const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }

    /**
     * The stored name is a random UUID, never the uploaded filename: user input
     * must not decide where a file lands on disk.
     */
    const extension = EXTENSIONS[input.contentType] ?? '.bin';
    const prefix = sanitisePrefix(input.prefix);
    const key = `${prefix}/${randomUUID()}${extension}`;

    const target = path.join(this.root, key);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    } catch (error) {
      /**
       * A HOSTED SERVER HAS NO WRITABLE DISK, and the raw EROFS/EACCES reaches
       * the admin as "algo falló al guardar" — which sends whoever sees it
       * looking for a bug in the form. Say what is actually true instead: this
       * adapter is for a laptop, and uploads need the R2 adapter up there.
       */
      const code = (error as { code?: string }).code;
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          'Este servidor no tiene disco donde escribir, así que no se pueden subir imágenes. ' +
            'Súbelas en local, o configura el almacenamiento remoto (R2).',
        );
      }
      throw error;
    }

    return {
      key,
      url: this.urlFor(key),
      contentType: input.contentType,
      size: bytes.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const target = path.join(this.root, sanitiseKey(key));
    await unlink(target).catch(() => undefined);
  }

  urlFor(key: string): string {
    return `${this.publicBase}/${sanitiseKey(key)}`;
  }
}

/** Keeps a prefix to one harmless path segment. */
function sanitisePrefix(prefix: string): string {
  const clean = prefix.replace(/[^a-z0-9-]/gi, '');
  return clean.length > 0 ? clean : 'misc';
}

/** Refuses traversal in a key coming back from the database. */
function sanitiseKey(key: string): string {
  return key
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
}
