import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { build } from 'vite';

/**
 * An already-open tab must still be able to import its original lazy module after
 * an app update. Build twice with different content and check both module graphs.
 */
test('rebuilding the app preserves lazy modules referenced by an older page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'models-app-build-'));
  try {
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    );
    await fs.writeFile(
      path.join(root, 'main.js'),
      "globalThis.openViewer = () => import('./viewer.js');",
    );
    await fs.writeFile(path.join(root, 'client.js'), "export const client = 'api';");
    const viewer = path.join(root, 'viewer.js');
    const outDir = path.join(root, 'dist');
    const compile = () =>
      build({
        configFile: path.resolve('app/vite.config.ts'),
        root,
        logLevel: 'silent',
        build: {
          outDir,
          rollupOptions: {
            input: {
              index: path.join(root, 'index.html'),
              'models-client': path.join(root, 'client.js'),
            },
          },
        },
      });
    await fs.writeFile(viewer, "export const version = 'first';");
    await compile();
    const oldPage = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
    const assets = path.join(outDir, 'assets');
    const oldFiles = await fs.readdir(assets);
    const oldBytes = await Promise.all(
      oldFiles.map((name) => fs.readFile(path.join(assets, name))),
    );
    const oldViewer = oldFiles.find((name) => name.startsWith('viewer-'))!;
    expect(oldViewer).toBeTruthy();
    await fs.writeFile(viewer, "export const version = 'second';");
    await compile();
    expect(await fs.readFile(path.join(outDir, 'index.html'), 'utf8')).not.toBe(oldPage);
    for (let i = 0; i < oldFiles.length; i++) {
      expect(await fs.readFile(path.join(assets, oldFiles[i]))).toEqual(oldBytes[i]);
    }
    const viewers = (await fs.readdir(assets)).filter((name) => name.startsWith('viewer-'));
    expect(viewers).toHaveLength(2);
    expect(await fs.readFile(path.join(assets, oldViewer), 'utf8')).toContain('first');
    expect(
      await fs.readFile(
        path.join(
          assets,
          viewers.find((name) => name !== oldViewer)!,
        ),
        'utf8',
      ),
    ).toContain('second');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
