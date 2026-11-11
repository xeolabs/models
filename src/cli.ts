#!/usr/bin/env node
import fs from 'node:fs';
import { migrateSqliteLibrary } from './storage/PostgresMigration.js';
import { registerProcessingCommands } from './cli/processing.js';
import { registerRemoteCommands } from './cli/remote.js';
import { Command, CommanderError } from 'commander';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ModelsLibrary } from './ModelsLibrary.js';
import { ModelsError, fail } from './domain/ModelsError.js';
import { encode } from './domain/schema.js';

import { startModelBrowser } from './server/ModelBrowserServer.js';
const program = new Command()
  .name('models')
  .version('1.0.0')
  .description('Manage a local model file library')
  .option('--library <path>', 'library root')
  .option('--database-schema <name>', 'PostgreSQL schema for initialization or migration')
  .option('--xeoifc-dir <path>', 'XeoIFC runtime directory for IFC conversions')
  .option('--json', 'emit one JSON envelope')
  .exitOverride();
const json = process.argv.includes('--json');
if (json) program.configureOutput({ writeErr: () => {} });
function output(data: unknown) {
  process.stdout.write(encode(json ? { ok: true, data } : data) + '\n');
}
async function use(work: (library: ModelsLibrary) => Promise<unknown>) {
  const library = await ModelsLibrary.open({
    processingWorker: false,
    root: path.resolve(program.opts().library ?? process.cwd()),
    xeoIFC: program.opts().xeoifcDir ? { runtimeDirectory: program.opts().xeoifcDir } : undefined,
  });
  try {
    const data = await work(library);
    output(data ?? {});
  } finally {
    await library.close();
  }
}
registerProcessingCommands(program, use);
async function confirm(yes: boolean | undefined) {
  if (yes) return;
  if (!process.stdin.isTTY || json) fail('CONFLICT', 'Destructive command requires --yes');
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    if ((await prompt.question('Continue? [y/N] ')).toLowerCase() !== 'y')
      fail('CONFLICT', 'Operation cancelled');
  } finally {
    prompt.close();
  }
}
program
  .command('migrate-postgres')
  .description('Copy a stopped SQLite library into an empty PostgreSQL schema')
  .option('--activate', 'bind this asset directory to the verified PostgreSQL catalog')
  .action(async (options) => {
    const root = path.resolve(program.opts().library ?? process.cwd());
    const connectionString = process.env.MODELS_DATABASE_URL;
    if (!connectionString) fail('INVALID_LIBRARY', 'Migration: configure MODELS_DATABASE_URL');
    const binding = path.join(root, 'postgres.json');
    if (options.activate && fs.existsSync(binding))
      fail('LIBRARY_ALREADY_EXISTS', 'Migration: PostgreSQL binding already exists');
    const result = await migrateSqliteLibrary({
      root,
      database: { connectionString, schema: program.opts().databaseSchema },
    });
    if (options.activate)
      fs.writeFileSync(
        binding,
        JSON.stringify({ libraryId: result.libraryId, schema: result.schema }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    output({ ...result, activated: !!options.activate });
  });
program.command('init <path>').action(async (root) => {
  const l = await ModelsLibrary.open({
    root,
    create: true,
    ...(program.opts().databaseSchema
      ? {
          database: {
            connectionString: process.env.MODELS_DATABASE_URL ?? '',
            schema: program.opts().databaseSchema,
          },
        }
      : {}),
  });
  await l.close();
  output({ root: path.resolve(root) });
});
program
  .command('list')
  .option('--limit <n>', 'page size', '50')
  .option('--offset <n>', 'offset', '0')
  .action((o) => use((l) => l.list({ limit: Number(o.limit), offset: Number(o.offset) })));
program
  .command('search [text]')
  .option('--format <format>')
  .option('--provider <provider>')
  .option('--tags <tags>')
  .action((text, o) =>
    use((l) =>
      l.search({ text, format: o.format, provider: o.provider, tags: o.tags?.split(',') }),
    ),
  );
program.command('show <id>').action((id) =>
  use(async (l) => {
    const m = await l.get(id);
    if (!m) fail('MODEL_NOT_FOUND', 'Model does not exist');
    return m;
  }),
);
program
  .command('create')
  .requiredOption('--name <name>')
  .action((o) => use((l) => l.create({ metadata: { name: o.name } })));
program
  .command('update <id>')
  .option('--name <name>')
  .option('--description <description>')
  .action((id, o) => use((l) => l.update(id, { metadata: o })));
program
  .command('delete <id>')
  .option('--yes')
  .action(async (id, o) => {
    await confirm(o.yes);
    await use((l) => l.delete(id));
  });
program
  .command('import <path>')
  .option('--properties <mode>', 'property storage: embedded or external')
  .option('--name <name>')
  .option('--tags <tags>')
  .option('--dry-run')
  .action((p, o) =>
    use((l) =>
      l.importFile({
        path: p,
        name: o.name,
        propertySetMode: o.properties,
        tags: o.tags?.split(','),
        dryRun: o.dryRun,
      }),
    ),
  );
program
  .command('import-directory <path>')
  .requiredOption('--entrypoint <file>')
  .option('--name <name>')
  .option('--dry-run')
  .action((p, o) =>
    use((l) =>
      l.importDirectory({ path: p, entrypoint: o.entrypoint, name: o.name, dryRun: o.dryRun }),
    ),
  );
program
  .command('import-manifest <path>')
  .option('--dry-run')
  .action((p, o) => use((l) => l.importManifest({ manifestPath: p, dryRun: o.dryRun })));
program
  .command('import-bundle <path>')
  .option('--dry-run')
  .action((p, o) => use((l) => l.importBundle({ path: p, dryRun: o.dryRun })));
program
  .command('download-formats <id>')
  .description('Inspect the SDK conversion formats available for a model')
  .action((id) => use((library) => library.downloadFormats(id)));
program
  .command('convert <id>')
  .description('Generate or reuse a cached SDK conversion and save a download')
  .requiredOption('--format <format>')
  .requiredOption('--output <path>')
  .action((id, options) =>
    use((library) =>
      library.exportConvertedModel({
        modelId: id,
        format: options.format,
        outputPath: options.output,
      }),
    ),
  );
program
  .command('export <id>')
  .requiredOption('--output <path>')
  .action((id, o) => use((l) => l.exportModel({ modelId: id, outputPath: o.output })));
const tags = program.command('tags');
tags.action(() => use((l) => l.listTags()));
tags.command('add <id> <tags>').action((id, t) => use((l) => l.addTags(id, t.split(','))));
tags.command('remove <id> <tags>').action((id, t) => use((l) => l.removeTags(id, t.split(','))));
program.command('validate').action(() =>
  use(async (l) => {
    const r = await l.validate();
    if (!r.ok) process.exitCode = 6;
    return r;
  }),
);
program
  .command('gc')
  .option('--dry-run')
  .option('--yes')
  .action(async (o) => {
    if (!o.dryRun && o.yes) await confirm(o.yes);
    await use((l) => l.gc({ dryRun: !o.yes || o.dryRun }));
  });
program
  .command('serve')
  .option('--port <port>', 'HTTP port', '7420')
  .option('--host <host>', 'bind address', '127.0.0.1')
  .option(
    '--allow-origin <origin>',
    'approved read-only viewer origin',
    (v: string, p: string[]) => [...p, v],
    [],
  )
  .option(
    '--allow-picker-origin <origin>',
    'approved Studio origin for the picker and read-only model access',
    (v: string, p: string[]) => [...p, v],
    [],
  )
  .action(async (o) => {
    const server = await startModelBrowser({
      root: path.resolve(program.opts().library ?? process.cwd()),
      xeoIFC: program.opts().xeoifcDir ? { runtimeDirectory: program.opts().xeoifcDir } : undefined,
      port: Number(o.port),
      host: o.host,
      allowedOrigins: o.allowOrigin,
      pickerOrigins: o.allowPickerOrigin,
    });
    output({ url: server.url });
    const stop = () => void server.close().then(() => process.exit(0));
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
registerRemoteCommands(program, { use, output, confirm });
try {
  await program.parseAsync(process.argv);
} catch (e) {
  const code =
    e instanceof ModelsError
      ? e.code
      : e instanceof CommanderError
        ? 'INVALID_MODEL'
        : 'UNEXPECTED_ERROR';
  if (e instanceof CommanderError && e.exitCode === 0) process.exit(0);
  const message = e instanceof Error ? e.message : 'Unexpected error';
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + '\n');
  else process.stderr.write(message + '\n');
  process.exitCode = code.endsWith('NOT_FOUND')
    ? 3
    : code.includes('CONFLICT')
      ? 4
      : code.includes('SCHEMA') || code === 'UNSUPPORTED_FORMAT'
        ? 7
        : code === 'FILE_IO_ERROR'
          ? 5
          : code === 'UNEXPECTED_ERROR'
            ? 1
            : 2;
}
