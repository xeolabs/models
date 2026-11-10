import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../domain/ModelsError.js';

/**
 * Reject symlinks in every existing component, including ancestors of the root.
 */
export function noLinks(file: string): void {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        fail('PATH_OUTSIDE_ROOT', `Path contains symlink: ${current}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }
}
export function relativeFile(root: string, name: string): string {
  if (
    !name ||
    path.isAbsolute(name) ||
    name.includes('\\') ||
    name.includes(':') ||
    name.split('/').some((p) => p === '..' || p === '.' || p === '')
  )
    fail('PATH_OUTSIDE_ROOT', `Unsafe relative path: ${name}`);
  const file = path.join(root, name);
  noLinks(file);
  return file;
}
