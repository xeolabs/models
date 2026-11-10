import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
export interface ExecutionOwner {
  pid: number;
  host: string;
  start?: string;
  boot?: string;
  token: string;
}
function start(pid: number) {
  try {
    return fs
      .readFileSync(`/proc/${pid}/stat`, 'utf8')
      .split(') ')
      .slice(1)
      .join(') ')
      .split(' ')[19];
  } catch {
    return undefined;
  }
}
function boot() {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return undefined;
  }
}
export function executionOwner(): ExecutionOwner {
  return {
    pid: process.pid,
    host: os.hostname(),
    start: start(process.pid),
    boot: boot(),
    token: randomUUID(),
  };
}

/**
 * PID reuse is not ownership. Unknown remote hosts remain untouched.
 */
export function ownerAlive(owner: ExecutionOwner): boolean {
  if (owner.host !== os.hostname()) return true;
  if (owner.boot && boot() && owner.boot !== boot()) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
  const current = start(owner.pid);
  return !(owner.start && current && owner.start !== current);
}
