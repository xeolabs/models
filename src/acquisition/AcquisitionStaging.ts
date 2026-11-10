import fs from 'node:fs';
import path from 'node:path';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';

/**
 * A claimed job owns its staging directory. Resuming replaces only that job's leftovers.
 */
export class AcquisitionStaging {
  readonly root: string;
  constructor(libraryRoot: string, jobId: string) {
    if (!/^[a-f0-9-]{36}$/.test(jobId)) fail('INVALID_PLAN', 'Stage acquisition: invalid job ID');
    this.root = path.join(libraryRoot, '.cache', 'acquisition', jobId);
    noLinks(this.root);
    fs.rmSync(this.root, { recursive: true, force: true });
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  close() {
    noLinks(this.root);
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
