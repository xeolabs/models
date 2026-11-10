import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
test('installed-style CLI supports model, package, remote and maintenance workflows', async () => {
  const f = await fixture();
  try {
    const call = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['build/cli.js', '--library', f.directory, '--json', ...args],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      );
    fs.writeFileSync(path.join(f.source, 'part.gltf'), gltf);
    const imported = call('import', path.join(f.source, 'part.gltf'), '--name', 'Test model');
    const id = imported.data.model.id;
    expect(call('show', id).data.id).toBe(id);
    expect(call('search', 'Test').data).toHaveLength(1);
    call('update', id, '--name', 'Changed');
    call('tags', 'add', id, 'demo,example');
    expect(call('tags').data).toHaveLength(2);
    call('tags', 'remove', id, 'example');
    const zip = path.join(f.root, 'export.zip');
    call('export', id, '--output', zip);
    expect(call('import-bundle', zip).data.model.id).not.toBe(id);
    expect(call('providers', 'list').data.map((provider: { id: string }) => provider.id)).toEqual(
      expect.arrayContaining(['buildingsmart', 'buildingsmart-community']),
    );
    expect(call('remote', 'plan', 'list').data.total).toBe(0);
    expect(call('remote', 'job', 'list').data.total).toBe(0);
    expect(call('remote', 'cache', 'stats').ok).toBe(true);
    const triangle = path.join(f.source, 'triangle.obj');
    fs.writeFileSync(triangle, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    const convertible = call('import', triangle).data.model.id;
    expect(
      call('download-formats', convertible).data.formats.some(
        (item: { format: string }) => item.format === 'glb',
      ),
    ).toBe(true);
    const converted = path.join(f.root, 'triangle.glb');
    expect(call('convert', convertible, '--format', 'glb', '--output', converted).data.cached).toBe(
      false,
    );
    expect(fs.readFileSync(converted).subarray(0, 4).toString()).toBe('glTF');
    const secondDownload = path.join(f.root, 'triangle-again.glb');
    expect(
      call('convert', convertible, '--format', 'glb', '--output', secondDownload).data.cached,
    ).toBe(true);
    call('delete', convertible, '--yes');
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', convertible))).toBe(false);
    expect(call('validate').data.ok).toBe(true);
    expect(call('processing', 'settings').data.automaticIFC).toBe(false);
    call('processing', 'settings', '--automatic-ifc', '--paused', '--cpu-cores', '1');
    const ifc = call(
      'import',
      new URL('./fixtures/ifc-providers/Building-Architecture.ifc', import.meta.url).pathname,
    ).data.model;
    const queued = call('processing', 'status', '--model', ifc.id).data.jobs[0];
    expect(queued.status).toBe('queued');
    expect(call('processing', 'prepare', ifc.id).data.id).toBe(queued.id);
    call('processing', 'cancel', queued.id);
    expect(call('processing', 'status', '--model', ifc.id).data.jobs[0].status).toBe('cancelled');
    const retried = call('processing', 'retry', queued.id).data;
    expect(retried.status).toBe('queued');
    call('processing', 'cancel', retried.id);
    call('processing', 'settings', '--no-automatic-ifc', '--no-paused');
    expect(call('processing', 'settings').data).toMatchObject({
      automaticIFC: false,
      paused: false,
    });
    call('delete', ifc.id, '--yes');
    call('delete', id, '--yes');
    expect(call('gc', '--dry-run').ok).toBe(true);
    const missing = spawnSync(
      process.execPath,
      ['build/cli.js', '--library', f.directory, '--json', 'show', id],
      { encoding: 'utf8' },
    );
    expect(missing.status).toBe(3);
    expect(JSON.parse(missing.stdout).error.code).toBe('MODEL_NOT_FOUND');
  } finally {
    await f.close();
  }
});
