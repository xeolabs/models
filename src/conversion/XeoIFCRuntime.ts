import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ModelsError, fail } from '../domain/ModelsError.js';
import { noLinks } from '../storage/paths.js';

export interface XeoIFCOptions {

  /**
   * Directory containing matching viewer_wasm.js and viewer_wasm_bg.wasm files.
   * These are trusted server code, supplied and licensed by the administrator.
   */
  runtimeDirectory: string;
  licenceKey?: string;
}

/**
 * Resolve the optional IFC engine only when IFC conversion is requested. Normal
 * catalog use and downloads of original IFC files do not require the engine.
 */
export class XeoIFCRuntime {
  private cached?: {
    key: string;
    value: { directory: string; licenceKey: string | undefined; revision: string };
  };
  constructor(private readonly options?: XeoIFCOptions) {}
  resolve() {
    const configured = this.options?.runtimeDirectory ?? process.env.MODELS_XEOIFC_DIR;
    if (!configured)
      fail(
        'CONVERSION_FAILED',
        'IFC conversion requires XeoIFC. Set MODELS_XEOIFC_DIR to a licensed runtime directory containing viewer_wasm.js and viewer_wasm_bg.wasm.',
      );
    const directory = path.resolve(configured);
    const licenceKey = this.options?.licenceKey ?? process.env.MODELS_XEOIFC_LICENSE_KEY;
    try {
      // Thumbnail/status polling should not reread a large WASM binary each time.
      // Nanosecond modification and change times also detect same-size replacements.
      const key = JSON.stringify([
        directory,
        licenceKey,
        ...['viewer_wasm.js', 'viewer_wasm_bg.wasm'].map((name) => {
          const file = path.join(directory, name);
          noLinks(file);
          const stat = fs.statSync(file, { bigint: true });
          return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
        }),
      ]);
      if (this.cached?.key === key) return this.cached.value;
      const fingerprint = createHash('sha256').update('xeoifc-v1');
      for (const name of ['viewer_wasm.js', 'viewer_wasm_bg.wasm']) {
        const filename = path.join(directory, name);
        noLinks(filename);
        const stat = fs.statSync(filename);
        if (!stat.isFile() || stat.size === 0 || stat.size > 128 * 1024 ** 2)
          fail('CONVERSION_FAILED', 'IFC conversion: invalid XeoIFC runtime file');
        const bytes = fs.readFileSync(filename);
        if (
          name.endsWith('.wasm') &&
          !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
        )
          fail('CONVERSION_FAILED', 'IFC conversion: invalid XeoIFC WASM signature');
        fingerprint.update(name).update(bytes);
      }
      // License changes can affect geometry, including evaluation watermarks.
      fingerprint.update(licenceKey ?? '');
      const value = { directory, licenceKey, revision: fingerprint.digest('hex') };
      this.cached = { key, value };
      return value;
    } catch (cause) {
      if (cause instanceof ModelsError && cause.code === 'CONVERSION_FAILED') throw cause;
      throw new ModelsError(
        'CONVERSION_FAILED',
        'IFC conversion: could not read the configured XeoIFC runtime',
        { cause },
      );
    }
  }
}
