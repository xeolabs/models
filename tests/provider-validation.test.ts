import { expect, test } from 'vitest';
import { z } from 'zod';
import { response } from '../src/providers/validation.js';
import { ModelsError } from '../src/domain/ModelsError.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { SketchfabDownloadAccess } from '../src/providers/SketchfabDownloadAccess.js';
import { response as httpResponse } from './acquisition-helpers.js';
import { fixture } from './helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';

function failure(schema: z.ZodTypeAny, value: unknown) {
  try {
    response(schema, value);
  } catch (error) {
    expect(error).toBeInstanceOf(ModelsError);
    expect(error).toHaveProperty('code', 'INVALID_PROVIDER_RESPONSE');
    return (error as ModelsError).message;
  }
  throw Error('Expected validation to fail');
}

test('reports nested fields, array indices, actual types and missing fields together', () => {
  const schema = z.object({
    results: z.array(
      z.object({ name: z.string(), size: z.number(), license: z.object({ id: z.string() }) }),
    ),
  });
  const message = failure(schema, {
    results: [{ name: null, size: 'private-value', license: {} }],
  });
  expect(message).toBe(
    'Provider response: results[0].name: expected string, received null; results[0].size: expected number, received string; results[0].license.id: required field is missing (expected string)',
  );
  expect(message).not.toContain('private-value');
  expect(failure(z.object({}), null)).toBe(
    'Provider response: (response): expected object, received null',
  );
});

test('reports constraints and unknown fields without repeating private values or custom messages', () => {
  const schema = z
    .object({
      url: z.string().url(),
      size: z.number().positive(),
      token: z.enum(['one', 'two']),
      count: z.number().int(),
    })
    .strict();
  const message = failure(schema, {
    url: 'signed-secret',
    size: 0,
    token: 'private-secret',
    count: 1.5,
    unexpected: 'hidden',
  });
  expect(message).toContain('url: expected a valid url');
  expect(message).toContain('size: expected more than 0');
  expect(message).toContain('token: expected one of the allowed values');
  expect(message).toContain('count: expected integer, received float');
  expect(message).toContain('unexpected: unexpected field');
  for (const secret of ['signed-secret', 'private-secret', 'hidden'])
    expect(message).not.toContain(secret);
  expect(
    failure(
      z.string().refine(() => false, 'secret from custom validator'),
      'hidden',
    ),
  ).not.toContain('secret');
});

test('describes fields inside union alternatives and quotes unusual field names', () => {
  const archive = z.object({ size: z.number() });
  const message = failure(z.record(z.union([archive, z.array(archive)])), {
    'gltf.archive': [{ size: 'wrong' }],
  });
  expect(message).toBe(
    'Provider response: ["gltf.archive"][0].size: expected number, received string',
  );
  expect(failure(z.union([z.string(), z.number()]), null)).toContain(
    'expected string, received null',
  );
});

test('bounds long error lists and retains normal parsing and defaults', () => {
  const message = failure(z.array(z.number()), Array(20).fill('private'));
  expect(message).toContain('[9]: expected number, received string');
  expect(message).not.toContain('[10]');
  expect(message).toContain('additional errors omitted');
  expect(response(z.object({ limit: z.number().default(20) }), {})).toEqual({ limit: 20 });
});

test('Sketchfab download validation identifies its response and fields without exposing signed URLs', async () => {
  const client = new ProviderHttpClient({
    pacing: { sketchfab: 0 },
    transport: {
      async request() {
        return httpResponse(
          Buffer.from(JSON.stringify({ gltf: { url: 'signed-private-url', size: 'unknown' } })),
        );
      },
    },
  });
  const access = new SketchfabDownloadAccess(client, () => ({
    method: 'api-token',
    token: 'fixture-token',
  }));
  await expect(access.downloads('c741dcd8720f4a629de8681bdcd4529b')).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
    message:
      'Sketchfab download response: gltf.url: expected a valid url; gltf.size: expected number, received string; gltf.expires: required field is missing (expected number)',
  });
});

test('field diagnostics reach the app through the HTTP error envelope and leave account configuration unchanged', async () => {
  const f = await fixture();
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    acquisition: {
      pacing: { sketchfab: 0 },
      transport: {
        async request() {
          return httpResponse(Buffer.from('{"username":null}'));
        },
      },
    },
  });
  try {
    const result = await fetch(server.url + '/api/acquisition/sketchfab/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Models-Action': 'explicit' },
      body: JSON.stringify({ method: 'api-token', token: 'fixture-token' }),
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PROVIDER_RESPONSE',
        message: 'Sketchfab account response: username: expected string, received null',
      },
    });
    const status = await (await fetch(server.url + '/api/acquisition/sketchfab/auth')).json();
    expect(status.data).toEqual({ configured: false });
  } finally {
    await server.close();
    await f.close();
  }
});
