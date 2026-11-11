import { XeoIFCRuntime } from './XeoIFCRuntime.js';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { ModelsError } from '../domain/ModelsError.js';
import { WorkerResources } from '../processing/WorkerResources.js';
import type { ProcessingSettings, ProcessingProgress } from '../processing/types.js';
import type { ConversionRequest } from './types.js';

export const converterDirectory = path.resolve(
  process.env.MODELS_CONVERTER_DIRECTORY ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../vendor/xeokit'),
);
const converterProvenance = JSON.parse(
  fs.readFileSync(path.join(converterDirectory, 'provenance.json'), 'utf8'),
);
export const converterRevision = converterProvenance.revision as string;
export const previousConverterRevision = converterProvenance.previousRevision as string | undefined;

/**
 * The persistent queue admits one worker. This class owns only that worker's
 * lifetime, filesystem permissions, progress messages and resource limits.
 */
export class ConversionRunner {
  constructor(
    private readonly xeoIFC = new XeoIFCRuntime(),
    private readonly settings: () => ProcessingSettings | Promise<ProcessingSettings> = () => ({
      automaticIFC: false,
      paused: false,
      memoryLimitMiB: 2048,
      reserveMemoryMiB: 1024,
      cpuCores: 1,
      timeoutMinutes: 60,
    }),
  ) {}
  async run(
    request: ConversionRequest,
    inputRoot: string,
    signal: AbortSignal,
    report: (progress: ProcessingProgress) => void = () => {},
  ): Promise<unknown> {
    const runtime = request.sourceFormat === 'ifc' ? this.xeoIFC.resolve() : undefined;
    const settings = await this.settings();
    return new Promise((resolve, reject) => {
      const child = fork(path.join(converterDirectory, 'converter.cjs'), [], {
        cwd: inputRoot,
        env: {
          NODE_ENV: 'production',
          UV_THREADPOOL_SIZE: '1',
          OMP_NUM_THREADS: String(settings.cpuCores),
          RAYON_NUM_THREADS: String(settings.cpuCores),
          ...(runtime
            ? {
                MODELS_XEOIFC_DIR: runtime.directory,
                MODELS_XEOIFC_LICENSE_KEY: runtime.licenceKey,
              }
            : {}),
        },
        execArgv: [
          '--permission',
          ...(runtime ? ['--allow-fs-read=' + runtime.directory] : []),
          '--max-old-space-size=' + Math.max(128, Math.floor(settings.memoryLimitMiB * 0.75)),
          '--allow-fs-read=' + converterDirectory,
          '--allow-fs-read=' + inputRoot,
          ...(request.propertyDatabaseFile
            ? ['--allow-fs-read=' + request.propertyDatabaseFile]
            : []),
          '--allow-fs-read=' + request.output,
          '--allow-fs-write=' + request.output,
        ],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let reply: { ok?: boolean; result?: unknown; error?: string } | undefined;
      let error: Error | undefined;
      let stderr = '';
      let resources: WorkerResources | undefined;
      const stop = (reason: Error) => {
        error ??= reason;
        child.kill('SIGKILL');
      };
      const abort = () => stop(new ModelsError('CONVERSION_CANCELLED', 'Convert model: cancelled'));
      const timer = setTimeout(
        () =>
          stop(
            new ModelsError(
              'CONVERSION_TIMEOUT',
              `Convert model: exceeded the ${settings.timeoutMinutes}-minute limit`,
            ),
          ),
        settings.timeoutMinutes * 60000,
      );
      const monitor = setInterval(() => {
        try {
          if (resources) report(resources.sample());
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
            stop(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }, 250);
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-8192);
      });
      child.on('message', (value: unknown) => {
        const message = value as {
          progress?: ProcessingProgress;
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        if (message.progress)
          report({ phase: String(message.progress.phase ?? 'Working').slice(0, 200) });
        else reply = message;
      });
      child.once('error', (cause) => {
        error = cause;
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        clearInterval(monitor);
        signal.removeEventListener('abort', abort);
        if (error)
          return reject(
            error instanceof ModelsError
              ? error
              : new ModelsError('CONVERSION_FAILED', 'Convert model: ' + error.message, {
                  cause: error,
                }),
          );
        if (code !== 0 || !reply?.ok) {
          const detail = (reply?.error || stderr || 'SDK conversion process failed')
            .replaceAll(inputRoot, '[package]')
            .replaceAll(converterDirectory, '[converter]')
            .replaceAll(runtime?.licenceKey || '\x00', '[license key]');
          return reject(new ModelsError('CONVERSION_FAILED', 'Convert model: ' + detail));
        }
        resolve(reply.result);
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else {
        try {
          if (!child.pid) throw new Error('Worker did not start');
          resources = new WorkerResources(child.pid, settings);
          child.send(request, (cause) => {
            if (cause) stop(cause);
          });
        } catch (cause) {
          stop(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }
    });
  }
}
