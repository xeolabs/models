import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { ProcessingSettings, ProcessingProgress } from './types.js';
import { ModelsError } from '../domain/ModelsError.js';

/**
 * One low-priority child is the only CPU-intensive process this queue starts.
 * Linux also confines all its threads to a small set of CPUs and monitors RSS,
 * which includes WASM and buffers that the JavaScript heap limit does not cover.
 */
export class WorkerResources {
  private previous?: { ticks: number; time: number };
  private ticksPerSecond = 100;
  constructor(
    private readonly pid: number,
    private readonly settings: ProcessingSettings,
  ) {
    os.setPriority(pid, os.constants.priority.PRIORITY_LOW);
    if (process.platform === 'linux') {
      const allowed = fs
        .readFileSync('/proc/self/status', 'utf8')
        .match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
      if (!allowed) throw new Error('Cannot determine allowed worker CPUs');
      const cpus: number[] = [];
      for (const range of allowed.split(',')) {
        const [start, end] = range.split('-').map(Number);
        for (let cpu = start; cpu <= (end ?? start) && cpus.length < settings.cpuCores; cpu++)
          cpus.push(cpu);
        if (cpus.length >= settings.cpuCores) break;
      }
      execFileSync('taskset', ['-apc', cpus.join(','), String(pid)], {
        stdio: 'ignore',
        timeout: 2000,
      });
      this.ticksPerSecond = Number(
        execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 2000 }).trim(),
      );
    }
  }
  sample(): ProcessingProgress {
    if (process.platform !== 'linux') return {};
    const status = fs.readFileSync(`/proc/${this.pid}/status`, 'utf8');
    const memoryBytes = Number(status.match(/^VmRSS:\s*(\d+)/m)?.[1] ?? 0) * 1024;
    if (memoryBytes > this.settings.memoryLimitMiB * 1024 ** 2)
      throw new ModelsError(
        'CONVERSION_FAILED',
        'Worker reached its memory limit. Increase the limit in Processing and retry.',
      );
    if (os.freemem() < this.settings.reserveMemoryMiB * 1024 ** 2)
      throw new ModelsError(
        'CONVERSION_FAILED',
        'Worker stopped to preserve free system memory. Retry when more memory is available.',
      );
    const fields = fs
      .readFileSync(`/proc/${this.pid}/stat`, 'utf8')
      .split(') ')
      .slice(1)
      .join(') ')
      .split(' ');
    const now = { ticks: Number(fields[11]) + Number(fields[12]), time: Date.now() };
    const cpuPercent = this.previous
      ? Math.max(
          0,
          Math.round(
            ((now.ticks - this.previous.ticks) /
              this.ticksPerSecond /
              ((now.time - this.previous.time) / 1000)) *
              100,
          ),
        )
      : undefined;
    this.previous = now;
    return { memoryBytes, cpuPercent };
  }
}
