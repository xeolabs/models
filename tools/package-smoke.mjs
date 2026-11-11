import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-package-'));
try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      encoding: 'utf8',
    }),
  )[0];
  execFileSync(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefix',
      root,
      path.join(root, packed.filename),
    ],
    { stdio: 'pipe' },
  );
  // Compile against the installed declarations, not the development checkout.
  const consumer = path.join(root, 'consumer.mts');
  fs.writeFileSync(
    consumer,
    `
    import {ModelsLibrary, type PostgresOptions} from '@xeokit/models';
    import {ServerModelsClient} from '@xeokit/models/browser';
    const database: PostgresOptions = {connectionString: 'postgresql://localhost/test'};
    const library = await ModelsLibrary.open({root:'./catalog',database});
    const page = await library.page({limit:20});
    const ids: string[] = page.items.map(model => model.id);
    const browser = await ServerModelsClient.open('http://localhost:7420');
    await browser.search({text:ids.join(' ')});
    await library.close();
  `,
  );
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      consumer,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  const script = fs.readFileSync(new URL('./package-consumer.mjs', import.meta.url), 'utf8');
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    stdio: 'inherit',
  });
  execFileSync(path.join(root, 'node_modules/.bin/models'), ['--version'], { stdio: 'inherit' });
  console.log('Installed package and executable passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
