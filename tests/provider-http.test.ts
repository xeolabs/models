import { expect, test } from 'vitest';
import { ProviderHttpClient, retryAfter } from '../src/providers/ProviderHttpClient.js';
import { providerUrl, publicAddress, resolvePublic } from '../src/providers/HostPolicy.js';
import type { HttpTransport, HttpResponse } from '../src/providers/HttpsTransport.js';
function response(status = 200, body = '{}', headers = {}): HttpResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield Buffer.from(body);
    })(),
    close() {},
  };
}
const url = 'https://api.polyhaven.com/info/test';
const options = { pacing: { polyhaven: 0 }, retryBaseMs: 0 };
test('provider HTTP validates hosts, pins public DNS policy and rejects encoded paths', async () => {
  for (const value of [
    'http://api.polyhaven.com/x',
    'https://127.0.0.1/x',
    'https://api.polyhaven.com.evil.test/x',
    'https://u:p@api.polyhaven.com/x',
    'https://api.polyhaven.com:444/x',
    'https://dl.polyhaven.org/file/other/x',
    'https://api.polyhaven.com/%2fx',
  ])
    expect(() => providerUrl('polyhaven', value)).toThrow();
  expect(providerUrl('polyhaven', url).hostname).toBe('api.polyhaven.com');
  for (const ip of [
    '0.1.2.3',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.20.0.1',
    '192.168.0.1',
    '100.64.1.1',
    '198.18.0.1',
    '203.0.113.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
    'bad',
  ])
    expect(publicAddress(ip), ip).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  await expect(
    resolvePublic('test', (async () => [{ address: '127.0.0.1', family: 4 }]) as any),
  ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
});
test('metadata retries transient responses, honors conditional cache and rejects unsafe redirects', async () => {
  let calls = 0;
  const sent: any[] = [];
  const transport: HttpTransport = {
    async request(_url, o) {
      sent.push(o.headers);
      calls++;
      return calls === 1
        ? response(429, '', { 'retry-after': '0' })
        : calls === 2
          ? response(503)
          : calls === 3
            ? response(200, '{"ok":true}', { etag: 'v1' })
            : response(304);
    },
  };
  const client = new ProviderHttpClient({ ...options, transport });
  expect(await client.json('polyhaven', url)).toEqual({ ok: true });
  expect(calls).toBe(3);
  await client.json('polyhaven', url);
  expect(calls).toBe(3);
  client.refresh();
  await client.json('polyhaven', url);
  expect(sent[3]['If-None-Match']).toBe('v1');
  const unsafe = new ProviderHttpClient({
    ...options,
    transport: {
      async request() {
        return response(302, '', { location: 'https://127.0.0.1/private' });
      },
    },
  });
  await expect(unsafe.json('polyhaven', url)).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  expect(retryAfter('2')).toBe(2000);
  expect(retryAfter(undefined)).toBe(0);
});
test('provider failures expose typed errors and cancellation without retrying invalid input', async () => {
  for (const [status, code] of [
    [404, 'REMOTE_MODEL_NOT_FOUND'],
    [403, 'PROVIDER_API_ERROR'],
    [429, 'RATE_LIMITED'],
  ] as const) {
    let calls = 0;
    const client = new ProviderHttpClient({
      ...options,
      retries: 0,
      transport: {
        async request() {
          calls++;
          return response(status);
        },
      },
    });
    await expect(client.json('polyhaven', url)).rejects.toMatchObject({ code });
    expect(calls).toBe(1);
  }
  const client = new ProviderHttpClient({
    ...options,
    transport: {
      async request() {
        return response(200, 'bad json');
      },
    },
  });
  await expect(client.json('polyhaven', url)).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.transfer('polyhaven', url, async () => 0, controller.signal),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELLED' });
});
