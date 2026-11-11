import { providerIds, providerInfo, acquisitionProviderIds } from '../providers/ProviderInfo.js';
import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import type { ModelsLibrary } from '../ModelsLibrary.js';
import type { ResolutionSelection } from '../acquisition/types.js';
import type { ModelAcquisitionService } from '../acquisition/ModelAcquisitionService.js';
import type { ProviderId } from '../providers/types.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { fail, wrap } from '../domain/ModelsError.js';
import { noLinks } from '../storage/paths.js';
interface CliContext {
  use(work: (library: ModelsLibrary) => Promise<unknown>): Promise<void>;
  output(value: unknown): void;
  confirm(yes?: boolean): Promise<void>;
}
export function parseBytes(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|KB|MB|GB)?$/i.exec(value);
  if (!match) fail('INVALID_PLAN', 'Plan budget: use bytes, MiB or GiB');
  const factor: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
  };
  const bytes = Number(match[1]) * factor[(match[2] ?? 'b').toLowerCase()];
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    fail('INVALID_PLAN', 'Plan budget: expected a positive whole byte count');
  return bytes;
}
function resolutions(
  options: { resolution?: string; resolutions?: string; allResolutions?: boolean },
  fallback?: string,
): ResolutionSelection {
  if (
    [
      options.resolution !== undefined,
      options.resolutions !== undefined,
      !!options.allResolutions,
    ].filter(Boolean).length > 1
  )
    fail('INVALID_PLAN', 'Select one of --resolution, --resolutions or --all-resolutions');
  if (options.allResolutions) return { resolutions: 'all' };
  if (options.resolutions !== undefined) return { resolutions: options.resolutions.split(',') };
  const resolution = options.resolution ?? fallback;
  if (!resolution) fail('INVALID_PLAN', 'Choose --resolution, --resolutions or --all-resolutions');
  return { resolution };
}
function provider(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId))
    fail('PROVIDER_NOT_FOUND', 'Provider must be ' + providerIds.join(', '));
  return value as ProviderId;
}
function providers(value: string, acquisition = false): ProviderId[] {
  return value === 'all'
    ? [...(acquisition ? acquisitionProviderIds : providerIds)]
    : value.split(',').map(provider);
}
function readPlan(file: string) {
  try {
    noLinks(file);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 8 * 1024 ** 2)
      fail('INVALID_PLAN', 'Import plan: expected a JSON file below 8 MiB');
    const text = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      fail('INVALID_PLAN', 'Import plan: invalid JSON');
    }
  } catch (error) {
    throw wrap(error, 'Import plan');
  }
}

/**
 * Command handlers only coordinate input/output; all acquisition behavior lives in the service.
 */
export function registerRemoteCommands(program: Command, context: CliContext) {
  const { use, output, confirm } = context;
  const acquire = (work: (a: ModelAcquisitionService) => Promise<unknown>) =>
    use(async (library) =>
      work(
        await library.acquisition({
          userAgent: program.opts().userAgent ?? process.env.MODELS_USER_AGENT,
        }),
      ),
    );
  program.option('--user-agent <agent>', 'identifiable provider API User-Agent');
  program
    .command('providers')
    .command('list')
    .action(() => output(new ProviderRegistry().list().map((p) => providerInfo[p.id])));
  const remote = program
    .command('remote')
    .description('Discover, plan and explicitly acquire free provider models');
  remote
    .command('search [query]')
    .option('--provider <provider>', providerIds.join(', ') + ' or all', 'all')
    .option('--limit <count>', 'bounded discovery limit', '20')
    .option('--tags <tags>')
    .option('--categories <categories>')
    .action((query, o) =>
      acquire(
        async (a) =>
          await a.search({
            text: query,
            providers: providers(o.provider),
            limit: Number(o.limit),
            tags: o.tags?.split(','),
            categories: o.categories?.split(','),
          }),
      ),
    );
  remote
    .command('show <provider> <id>')
    .action((p, id) => acquire(async (a) => await a.getModel(provider(p), id)));
  remote
    .command('downloads <provider> <id>')
    .action((p, id) => acquire(async (a) => await a.getDownloads(provider(p), id)));
  const plan = remote.command('plan');
  plan
    .command('create')
    .option('--provider <provider>', 'selected providers', 'all')
    .option('--query <query>')
    .option('--tags <tags>')
    .option('--categories <categories>')
    .option('--resolution <resolution>', 'one provider size (default: 2k)')
    .option('--resolutions <sizes>', 'comma-separated provider sizes')
    .option('--all-resolutions', 'every available provider size')
    .option('--format <format>', 'gltf, glb, fbx, blend or ifc')
    .option('--max-models <count>', 'maximum selected models', '20')
    .option('--max-bytes <bytes>', 'hard transfer budget including retries', '2GiB')
    .option('--no-skip-existing', 'import another copy')
    .option('--allow-unknown-sizes', 'allow conservative 256 MiB reservations for unknown files')
    .action((o) =>
      acquire(
        async (a) =>
          await a.createPlan({
            providers: providers(o.provider, true),
            query: o.query,
            tags: o.tags?.split(','),
            categories: o.categories?.split(','),
            ...resolutions(o, '2k'),
            format: o.format,
            maxModels: Number(o.maxModels),
            maxTotalBytes: parseBytes(o.maxBytes),
            skipExisting: o.skipExisting,
            allowUnknownSizes: !!o.allowUnknownSizes,
          }),
      ),
    );
  plan
    .command('list')
    .option('--limit <count>', 'page size', '50')
    .option('--offset <count>', 'offset', '0')
    .action((o) =>
      acquire(async (a) => await a.listPlans({ limit: Number(o.limit), offset: Number(o.offset) })),
    );
  plan.command('show <id>').action((id) =>
    acquire(async (a) => {
      const value = await a.getPlan(id);
      if (!value) fail('PLAN_NOT_FOUND', 'Plan does not exist');
      return value;
    }),
  );
  plan.command('items <id>').action((id) => acquire(async (a) => await a.getPlanItems(id)));
  plan
    .command('execute <id>')
    .option('--yes')
    .option('--concurrency <count>', 'parallel models, 1–4', '2')
    .option('--stop-on-error')
    .action(async (id, o) => {
      await confirm(o.yes);
      await acquire(
        async (a) =>
          await a.executePlan(id, {
            concurrency: Number(o.concurrency),
            continueOnError: !o.stopOnError,
          }),
      );
    });
  plan
    .command('export <id>')
    .requiredOption('--output <path>')
    .action((id, o) =>
      acquire(async (a) => {
        const value = await a.exportPlan(id),
          file = path.resolve(o.output);
        noLinks(file);
        if (fs.existsSync(file)) fail('CONFLICT', 'Export plan: destination exists');
        fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { outputPath: file };
      }),
    );
  plan
    .command('import <path>')
    .action((file) => acquire(async (a) => await a.importPlan(readPlan(file))));
  const job = remote.command('job');
  job
    .command('list')
    .option('--limit <count>', 'page size', '50')
    .option('--offset <count>', 'offset', '0')
    .action((o) =>
      acquire(async (a) => await a.listJobs({ limit: Number(o.limit), offset: Number(o.offset) })),
    );
  job.command('status <id>').action((id) =>
    acquire(async (a) => {
      const job = await a.getJob(id);
      if (!job) fail('JOB_NOT_FOUND', 'Job does not exist');
      return { ...job, items: await a.getJobItems(id) };
    }),
  );
  job
    .command('resume <id>')
    .option('--yes')
    .action(async (id, o) => {
      await confirm(o.yes);
      await acquire(async (a) => await a.resumeJob(id));
    });
  job.command('cancel <id>').action((id) =>
    acquire(async (a) => {
      await a.cancelJob(id);
      return { requested: true, job: await a.getJob(id) };
    }),
  );
  remote
    .command('import <provider> <id>')
    .option('--resolution <resolution>', 'one provider size')
    .option('--resolutions <sizes>', 'comma-separated provider sizes')
    .option('--all-resolutions', 'every available provider size')
    .option('--format <format>')
    .option('--tags <tags>')
    .option('--force', 'create another local model')
    .action((p, id, o) =>
      acquire(
        async (a) =>
          await a.acquire({
            provider: provider(p),
            remoteId: id,
            ...resolutions(o),
            format: o.format,
            tags: o.tags?.split(','),
            force: o.force,
          }),
      ),
    );
  const cache = remote.command('cache');
  cache.command('stats').action(() => acquire(async (a) => await a.cacheStats()));
  cache
    .command('clear')
    .option('--yes')
    .action(async (o) => {
      await confirm(o.yes);
      await acquire(async (a) => await a.clearCache());
    });
}
