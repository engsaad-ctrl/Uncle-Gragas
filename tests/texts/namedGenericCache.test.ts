import { expect, it, vi } from 'vitest';

const tap = vi.hoisted(() => ({ fresh: undefined as ((entry: { key?: string }) => boolean) | undefined }));
vi.mock('../../src/diskCache.js', () => ({
  getJson: vi.fn(async () => { throw new Error('offline fixture'); }),
  diskCache: vi.fn(async (_path, fresh) => {
    tap.fresh = fresh;
    return { data: { version: 'fixture', augments: [], pools: {} }, stale: true };
  }),
}));

import { loadAugments } from '../../src/texts/augmentsLoader.js';

it('does not treat the pre-naming cache as fresh while accepting the new naming generation', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('network forbidden'); });
  await loadAugments({ cacheDir: '__unused_no_io__', fetchImpl });
  expect(tap.fresh).toBeTypeOf('function');
  expect(tap.fresh!({ key: '18:fixture' })).toBe(false);
  expect(tap.fresh!({ key: '19:fixture' })).toBe(true);
  expect(fetchImpl).not.toHaveBeenCalled();
});
