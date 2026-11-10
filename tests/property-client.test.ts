import { afterEach, expect, test, vi } from 'vitest';
import { ServerPropertiesClient } from '../src/browser/ServerPropertiesClient.js';
import { PropertyValueCache } from '../src/browser/PropertyValueCache.js';

const revision = 'a'.repeat(64);
const definition = (id: string) => ({
  id,
  name: id,
  type: 'IfcPropertySet',
  properties: [{ name: 'Value', value: 3 }],
});
afterEach(() => vi.unstubAllGlobals());

test('concurrent callers share one batched request and cannot mutate cached values', async () => {
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const input = JSON.parse(options.body as string);
    return Response.json({
      ok: true,
      data: { revision, propertySets: input.ids.map(definition), missingIds: [] },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new ServerPropertiesClient('https://models.example');
  const [first, second] = await Promise.all([
    client.getPropertySets('model', { revision, ids: ['a', 'b'] }),
    client.getPropertySets('model', { revision, ids: ['b', 'c'] }),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string).ids).toEqual(['a', 'b', 'c']);
  first[1].properties[0].value = 'changed';
  expect(second[0].properties[0].value).toBe(3);
  expect(
    (await client.getPropertySets('model', { revision, ids: ['b'] }))[0].properties[0].value,
  ).toBe(3);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('cancelling one caller preserves shared work, while the last cancellation aborts transport', async () => {
  let finish: ((value: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve, reject) => {
        finish = resolve;
        signal!.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        );
      });
    }),
  );
  const client = new ServerPropertiesClient('https://models.example');
  const cancelled = new AbortController();
  const first = client.getPropertySets('model', { revision, ids: ['a'], signal: cancelled.signal });
  const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = client.getPropertySets('model', { revision, ids: ['a'] });
  await Promise.resolve();
  cancelled.abort();
  await rejection;
  expect(signal!.aborted).toBe(false);
  finish!(
    Response.json({
      ok: true,
      data: { revision, propertySets: [definition('a')], missingIds: [] },
    }),
  );
  expect(await second).toEqual([definition('a')]);
  const last = new AbortController();
  const next = client.getPropertySets('model', { revision, ids: ['b'], signal: last.signal });
  const nextRejection = expect(next).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  last.abort();
  await nextRejection;
  expect(signal!.aborted).toBe(true);
});

test('cache eviction respects its budget and revisions do not share values', async () => {
  const value = definition('a');
  const cache = new PropertyValueCache(new TextEncoder().encode(JSON.stringify(value)).length);
  cache.set('a', value);
  cache.set('b', definition('b'));
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBeDefined();
  const fetcher = vi.fn(async (_url, options) => {
    const query = JSON.parse(options.body);
    return Response.json({
      ok: true,
      data: { revision: query.revision, propertySets: query.ids.map(definition), missingIds: [] },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new ServerPropertiesClient('https://models.example');
  await client.getPropertySets('model', { revision, ids: ['a'] });
  await client.getPropertySets('model', { revision: 'b'.repeat(64), ids: ['a'] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('bulk iteration waits for consumption and rejects stale server revisions', async () => {
  const fetcher = vi.fn(async (_url, options) => {
    const query = JSON.parse(options.body);
    return Response.json({
      ok: true,
      data: {
        revision: query.revision,
        propertySets: [definition(query.cursor ? 'b' : 'a')],
        missingIds: [],
        ...(query.cursor ? {} : { nextCursor: 1 }),
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new ServerPropertiesClient('https://models.example');
  const iterator = client.iteratePropertySets('model', { revision, ids: ['a', 'b'] });
  expect((await iterator.next()).value).toEqual([definition('a')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await iterator.next()).value).toEqual([definition('b')]);
  expect((await iterator.next()).done).toBe(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ok: true,
        data: { revision: 'b'.repeat(64), propertySets: [], missingIds: [] },
      }),
    ),
  );
  await expect(client.getPropertySets('model', { revision, ids: ['c'] })).rejects.toMatchObject({
    code: 'PROPERTY_REVISION_MISMATCH',
  });
});
