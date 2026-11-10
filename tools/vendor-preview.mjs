import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.XEOKIT_SDK_PATH)
  throw new Error('Set XEOKIT_SDK_PATH to the SDK v3 source checkout.');
const sdk = path.resolve(process.env.XEOKIT_SDK_PATH),
  source = path.join(root, 'tools/preview/index.ts');
const output = path.join(root, 'vendor/xeokit/preview');

// Check our adapter against the real SDK types, without claiming that unrelated
// SDK source diagnostics are part of this application's typecheck.
const program = ts.createProgram(
  [source, path.join(root, 'node_modules/@webgpu/types/dist/index.d.ts')],
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    baseUrl: root,
    paths: { '@xeokit/sdk/*': [path.join(sdk, 'src/*')] },
    types: [],
  },
);
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter(
    (d) =>
      d.file &&
      (d.file.fileName.startsWith(path.join(root, 'tools/preview/')) ||
        d.file.fileName.startsWith(path.join(root, 'app/preview/'))),
  );
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (x) => x,
      getNewLine: () => '\n',
    }),
  );
  process.exit(1);
}
const result = await build({
  entryPoints: [source],
  outdir: output,
  entryNames: 'index',
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  bundle: true,
  splitting: true,
  minify: false,
  metafile: true,
  alias: { '@xeokit/sdk': path.join(sdk, 'src') },
  write: false,
});
await fs.mkdir(output, { recursive: true });
// Remove only this generated browser bundle, leaving the Node converter intact.
for (const entry of await fs.readdir(output))
  await fs.rm(path.join(output, entry), { recursive: true, force: true });
for (const file of result.outputFiles) {
  await fs.mkdir(path.dirname(file.path), { recursive: true });
  await fs.writeFile(file.path, file.contents);
}
await fs.writeFile(
  path.join(output, 'index.d.ts'),
  "import type { CreatePreviewEngine } from './PreviewEngine';\nexport declare const createPreviewEngine: CreatePreviewEngine;\n",
);
await fs.copyFile(
  path.join(root, 'app/preview/PreviewEngine.ts'),
  path.join(output, 'PreviewEngine.d.ts'),
);
const files = Object.keys(result.metafile.inputs)
    .filter((file) => !file.startsWith('(disabled):'))
    .sort(),
  hash = createHash('sha256');
for (const file of files) hash.update(await fs.readFile(path.resolve(file)));
await fs.writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      revision: hash.digest('hex'),
      sdkSources: files
        .filter((file) => path.resolve(file).startsWith(sdk + '/'))
        .map((file) => path.relative(sdk, path.resolve(file))),
    },
    null,
    2,
  ) + '\n',
);
// Preserve notices for the dependencies included in this browser-only bundle.
const packages = new Map();
for (const file of files.filter((name) => name.includes('node_modules/'))) {
  let directory = path.dirname(path.resolve(file));
  while (directory !== path.dirname(directory)) {
    try {
      const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      packages.set(info.name + '@' + info.version, { directory, info });
      break;
    } catch {
      directory = path.dirname(directory);
    }
  }
}
const notices = [
  '# Browser preview dependency notices',
  'The xeokit SDK license is in ../LICENSE.md.',
];
for (const [name, { directory, info }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  notices.push(
    '## ' + name,
    'Declared license: ' + JSON.stringify(info.license ?? 'See source package'),
  );
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[sc]e|copying|notice)/i.test(entry.name))
      notices.push(await fs.readFile(path.join(directory, entry.name), 'utf8'));
  }
}
await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.md'), notices.join('\n\n') + '\n');
console.log('Checked and bundled the browser preview against xeokit SDK v3.');
