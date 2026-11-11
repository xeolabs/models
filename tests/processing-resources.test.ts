import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, test, vi } from 'vitest';
import { WorkerResources } from '../src/processing/WorkerResources.js';
import { Database } from '../src/storage/Database.js';
import { ProcessingRepository } from '../src/processing/ProcessingRepository.js';
import { fixture } from './helpers.js';

const settings = {
  automaticIFC: false,
  paused: false,
  memoryLimitMiB: 2048,
  reserveMemoryMiB: 256,
  cpuCores: 1,
  timeoutMinutes: 60,
};
test.skipIf(process.platform !== 'linux')(
  'worker controls confine CPU threads, lower priority and include native memory in the limit',
  async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      await once(child, 'spawn');
      const limits = new WorkerResources(child.pid!, settings);
      const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8');
      expect(status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]).toMatch(/^\d+$/);
      expect(os.getPriority(child.pid!)).toBe(os.constants.priority.PRIORITY_LOW);
      for (const thread of fs.readdirSync(`/proc/${child.pid}/task`)) {
        const threadStatus = fs.readFileSync(`/proc/${child.pid}/task/${thread}/status`, 'utf8');
        expect(threadStatus.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]).toMatch(/^\d+$/);
      }
      await vi.waitFor(() => expect(limits.sample().memoryBytes).toBeGreaterThan(1024 ** 2));
      const tiny = new WorkerResources(child.pid!, { ...settings, memoryLimitMiB: 1 });
      expect(() => tiny.sample()).toThrow('memory limit');
      const free = vi.spyOn(os, 'freemem').mockReturnValue(0);
      try {
        expect(() => limits.sample()).toThrow('free system memory');
      } finally {
        free.mockRestore();
      }
    } finally {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
  },
);

test('low memory defers PostgreSQL claims and invalid settings are rejected', async () => {
  const f = await fixture(),
    db = new Database(f.directory),
    repo = new ProcessingRepository(db);
  try {
    expect((await repo.settings()).automaticIFC).toBe(false);
    await expect(repo.configure({ memoryLimitMiB: 0 })).rejects.toThrow('invalid value');
    const free = vi.spyOn(os, 'freemem').mockReturnValue(0);
    try {
      expect(await repo.claim()).toBeNull();
    } finally {
      free.mockRestore();
    }
    expect((await db.one('SELECT count(*) n FROM library_info'))!.n).toBe(1);
  } finally {
    await db.close();
    await f.close();
  }
});
