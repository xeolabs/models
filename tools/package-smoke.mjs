import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
