import type { Command } from 'commander';
import type { ModelsLibrary } from '../ModelsLibrary.js';
import type { ProcessingSettings } from '../processing/types.js';

/**
 * These commands use the same persisted settings and queue as the app.
 */
export function registerProcessingCommands(
  program: Command,
  use: (work: (library: ModelsLibrary) => Promise<unknown>) => Promise<void>,
) {
  const properties = program.command('properties').description('Inspect model property storage');
  properties
    .command('status <model-id>')
    .action((id) => use((library) => library.propertiesInfo(id)));
  properties
    .command('configure <model-id>')
    .requiredOption('--mode <mode>', 'embedded or external')
    .action((id, options) =>
      use((library) => library.configureProperties(id, { mode: options.mode })),
    );
  properties
    .command('sets <model-id>')
    .requiredOption('--revision <revision>')
    .requiredOption('--ids <ids>')
    .action((id, options) =>
      use((library) =>
        library.getPropertySets(id, { revision: options.revision, ids: options.ids.split(',') }),
      ),
    );
  const processing = program
    .command('processing')
    .description('Inspect and control conversion work');
  processing
    .command('status')
    .option('--model <id>')
    .action((options) => use((library) => library.processing(options.model)));
  processing.command('prepare <model-id>').action((id) => use((library) => library.prepareIFC(id)));
  processing
    .command('cancel <job-id>')
    .action((id) => use((library) => library.cancelConversion(id)));
  processing
    .command('retry <job-id>')
    .action((id) => use((library) => library.retryConversion(id)));
  processing
    .command('settings')
    .option('--properties <mode>', 'property storage: embedded or external')
    .option('--automatic-ifc', 'prepare newly imported IFC models')
    .option('--no-automatic-ifc', 'only prepare IFC on demand')
    .option('--paused', 'pause starting new jobs')
    .option('--no-paused', 'resume starting jobs')
    .option('--memory <mib>', 'worker memory limit')
    .option('--reserve-memory <mib>', 'memory to leave available')
    .option('--cpu-cores <n>', 'worker CPU cores, 1 to 4')
    .option('--timeout <minutes>', 'worker deadline')
    .action((options) =>
      use((library) => {
        const patch: Partial<ProcessingSettings> = {};
        if (options.properties !== undefined) patch.propertySetMode = options.properties;
        if (options.automaticIfc !== undefined) patch.automaticIFC = options.automaticIfc;
        if (options.paused !== undefined) patch.paused = options.paused;
        if (options.memory !== undefined) patch.memoryLimitMiB = Number(options.memory);
        if (options.reserveMemory !== undefined)
          patch.reserveMemoryMiB = Number(options.reserveMemory);
        if (options.cpuCores !== undefined) patch.cpuCores = Number(options.cpuCores);
        if (options.timeout !== undefined) patch.timeoutMinutes = Number(options.timeout);
        return Object.keys(patch).length
          ? library.configureProcessing(patch)
          : library.processingSettings();
      }),
    );
}
