import { expect, test, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import https from 'node:https';
import { HttpsTransport } from '../src/providers/HttpsTransport.js';
import { resolvePublic } from '../src/providers/HostPolicy.js';
vi.mock('../src/providers/HostPolicy.js', async (original) => ({
  ...(await original<any>()),
  resolvePublic: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
}));
const options = {
  headers: { 'User-Agent': 'test' },
  connectTimeoutMs: 50,
  inactivityTimeoutMs: 50,
  overallTimeoutMs: 500,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(resolvePublic).mockResolvedValue({ address: '8.8.8.8', family: 4 });
});
function mockRequest(behavior: (req: any) => void) {
  const requests: any[] = [];
  vi.spyOn(https, 'request').mockImplementation(((_url: any, configuration: any) => {
    const req: any = new EventEmitter();
    req.configuration = configuration;
    req.setTimeout = (_ms: number, callback: () => void) => {
      req.inactive = callback;
    };
    req.destroy = (error?: Error) => {
      req.response?.destroy(error);
      if (error) req.emit('error', error);
    };
    req.end = () => queueMicrotask(() => behavior(req));
    requests.push(req);
    return req;
  }) as any);
  return requests;
}
test('HTTPS pins the validated address while retaining TLS hostname and closes its streams', async () => {
  const requests = mockRequest((req) => {
    const response: any = Readable.from([Buffer.from('ok')]);
    response.statusCode = 200;
    response.headers = { etag: 'test' };
    req.response = response;
    req.emit('response', response);
  });
  const result = await new HttpsTransport().request(
    new URL('https://api.polyhaven.com/info/oak'),
    options,
  );
  let text = '';
  for await (const chunk of result.body) text += chunk.toString();
  expect(text).toBe('ok');
  result.close();
  expect(requests[0].configuration.family).toBe(4);
  let resolved: unknown;
  requests[0].configuration.lookup(
    'api.polyhaven.com',
    {},
    (...args: unknown[]) => (resolved = args),
  );
  expect(resolved).toEqual([null, '8.8.8.8', 4]);
});
test('HTTPS establishment, inactivity, overall and DNS timeouts terminate the request', async () => {
  mockRequest(() => {});
  await expect(
    new HttpsTransport().request(new URL('https://api.polyhaven.com/x'), {
      ...options,
      connectTimeoutMs: 5,
    }),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' });
  vi.restoreAllMocks();
  mockRequest((req) => {
    const response: any = new Readable({ read() {} });
    response.statusCode = 200;
    response.headers = {};
    req.response = response;
    req.emit('response', response);
    queueMicrotask(() => req.inactive());
  });
  const inactive = await new HttpsTransport().request(
    new URL('https://api.polyhaven.com/x'),
    options,
  );
  await expect(
    (async () => {
      for await (const _c of inactive.body) {

        /*
         * Read until failure.
         */
      }
    })(),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' });
  inactive.close();
  vi.restoreAllMocks();
  mockRequest((req) => {
    const response: any = new Readable({ read() {} });
    response.headers = {};
    req.response = response;
    req.emit('response', response);
  });
  const overall = await new HttpsTransport().request(new URL('https://api.polyhaven.com/x'), {
    ...options,
    overallTimeoutMs: 5,
  });
  await expect(
    (async () => {
      for await (const _c of overall.body) {

        /*
         * Read until failure.
         */
      }
    })(),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' });
  overall.close();
  vi.mocked(resolvePublic).mockImplementationOnce(() => new Promise(() => {}));
  await expect(
    new HttpsTransport().request(new URL('https://api.polyhaven.com/x'), {
      ...options,
      connectTimeoutMs: 5,
    }),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' });
});
