import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signParams } from '@/lib/storage/cloudinary';

/**
 * The SIGNATURE is the only part of the Cloudinary adapter worth testing
 * without a network, and it is also the only part that fails silently-ish: a
 * wrong signature comes back as "Invalid Signature" and nothing else, with no
 * hint whether the bug was the sorting, an unsigned parameter that got signed,
 * or the secret.
 *
 * So the rules are pinned here rather than trusted to reading.
 */
describe('signParams', () => {
  const secret = 'abcd';

  it('sorts the parameters by name, whatever order they arrive in', () => {
    const one = signParams({ timestamp: 1315060510, public_id: 'sample' }, secret);
    const other = signParams({ public_id: 'sample', timestamp: 1315060510 }, secret);
    expect(one).toBe(other);
  });

  it('is the SHA-1 of "k=v&k=v" plus the secret, in that exact shape', () => {
    /** Cloudinary's own documented recipe, spelled out so a change is visible. */
    const expected = createHash('sha1')
      .update('public_id=sample&timestamp=1315060510abcd')
      .digest('hex');

    expect(signParams({ public_id: 'sample', timestamp: 1315060510 }, secret)).toBe(expected);
  });

  it('never signs file, api_key, resource_type or cloud_name', () => {
    const bare = signParams({ public_id: 'x', timestamp: 1 }, secret);
    const noisy = signParams(
      {
        public_id: 'x',
        timestamp: 1,
        file: 'ignored',
        api_key: '254579537742669',
        resource_type: 'image',
        cloud_name: 'demo',
      },
      secret,
    );
    expect(noisy).toBe(bare);
  });

  it('changes when any signed value changes', () => {
    const base = signParams({ public_id: 'x', timestamp: 1 }, secret);
    expect(signParams({ public_id: 'y', timestamp: 1 }, secret)).not.toBe(base);
    expect(signParams({ public_id: 'x', timestamp: 2 }, secret)).not.toBe(base);
    expect(signParams({ public_id: 'x', timestamp: 1 }, 'otro')).not.toBe(base);
  });

  it('is a 40-character hex digest, which is what the API accepts', () => {
    expect(signParams({ public_id: 'x', timestamp: 1 }, secret)).toMatch(/^[0-9a-f]{40}$/);
  });
});
