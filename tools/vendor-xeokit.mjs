import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.XEOKIT_SDK_PATH;
if (!sdk) throw new Error('Set XEOKIT_SDK_PATH to the SDK v3 source checkout.');
const sdkRoot = path.resolve(sdk);
const output = process.env.MODELS_CONVERTER_DIRECTORY ?? path.join(root, 'vendor/xeokit');
await fs.mkdir(output, { recursive: true });
let previousRevision;
try {
  const previous = JSON.parse(await fs.readFile(path.join(output, 'provenance.json'), 'utf8'));
  previousRevision = previous.previousRevision ?? previous.revision;
} catch {}
const result = await build({
  entryPoints: [path.join(root, 'tools/xeokit-converter.ts')],
  outfile: path.join(output, 'converter.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  minify: false,
  metafile: true,
  alias: { '@xeokit/sdk': path.join(sdkRoot, 'src') },
  plugins: [
    {
      name: 'node-ifc-export',
      setup(build) {
        build.onResolve({ filter: /getInitializedIFCAPI$/ }, () => ({
          path: path.join(root, 'tools/xeokit-node-ifc.ts'),
        }));
        build.onResolve({ filter: /^web-ifc$/ }, () => ({
          path: createRequire(path.join(sdkRoot, 'package.json')).resolve('web-ifc'),
        }));
      },
    },
  ],
});
const wasm = path.join(
  path.dirname(createRequire(path.join(sdkRoot, 'package.json')).resolve('web-ifc')),
  'web-ifc-node.wasm',
);
await fs.copyFile(wasm, path.join(output, 'web-ifc-node.wasm'));
await fs.copyFile(path.join(sdkRoot, 'LICENSE.md'), path.join(output, 'LICENSE.md'));
const inputs = Object.keys(result.metafile.inputs).sort();
const hash = createHash('sha256');
hash.update(await fs.readFile(wasm));
for (const input of inputs) hash.update(await fs.readFile(path.resolve(input)));
// Retain the license text for every dependency included in the generated bundle.
const packages = new Map();
for (const input of inputs.filter((name) => name.includes('node_modules/'))) {
  let directory = path.dirname(path.resolve(input));
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    try {
      const info = JSON.parse(await fs.readFile(manifest, 'utf8'));
      if (info.name && info.version)
        packages.set(info.name + '@' + info.version, { directory, info });
      break;
    } catch {
      directory = path.dirname(directory);
    }
  }
}
const notices = [
  '# Bundled dependency notices',
  'The converter also includes xeokit SDK v3; see LICENSE.md.',
];
for (const [name, { directory, info }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  notices.push(
    '## ' + name,
    'Declared license: ' + JSON.stringify(info.license ?? info.licenses ?? 'See source package'),
  );
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[sc]e|copying|notice)/i.test(entry.name)) {
      notices.push(
        '### ' + entry.name,
        await fs.readFile(path.join(directory, entry.name), 'utf8'),
      );
    }
  }
}
await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.md'), notices.join('\n\n') + '\n');
const sdkPackage = JSON.parse(await fs.readFile(path.join(sdkRoot, 'package.json'), 'utf8'));
await fs.writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      sdk: sdkPackage.name,
      version: sdkPackage.version,
      description: sdkPackage.description,
      revision: hash.digest('hex'),
      previousRevision,
      sourceFiles: inputs
        .filter((name) => path.resolve(name).startsWith(sdkRoot + '/'))
        .map((name) => path.relative(sdkRoot, path.resolve(name))),
    },
    null,
    2,
  ) + '\n',
);
console.log('Updated the standalone SDK v3 conversion bundle with XeoIFC input support.');
