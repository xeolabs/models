import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { fail } from '../domain/ModelsError.js';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { ccBy, remoteIdSchema, response, searchSchema } from './validation.js';
import type {
  ModelProvider,
  ProviderId,
  ProviderModel,
  ProviderDownload,
  ProviderDownloadFile,
  ProviderSearchQuery,
} from './types.js';

const hash = z.string().regex(/^[a-f0-9]{40}$/);
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string().min(1),
        mode: z.string(),
        type: z.string(),
        sha: hash,
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .max(100000),
});
type Entry = z.infer<typeof treeSchema>['tree'][number];
interface Collection {
  id: ProviderId;
  repository: string;
  name: string;
  licenseFile: string;
  folders?: readonly string[];
}
interface Catalog {
  revision: string;
  entries: Entry[];
  models: Entry[];
}
const encodedPath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
const identity = (value: string) => createHash('sha256').update(value).digest('hex');
const ccByNotice = /Creative Commons Attribution 4\.0 International|CC BY 4\.0/i;

/**
 * A small, reviewed GitHub collection is one provider. Commit-pinned URLs keep
 * plans stable. Git LFS pointers supply real byte sizes and SHA-256 checksums;
 * they are never imported as models, and Git blob IDs are never file checksums.
 */
export class GitHubIFCProvider implements ModelProvider {
  readonly id: ProviderId;
  private catalogTask?: Promise<Catalog>;
  private expiresAt = 0;
  private readonly texts = new Map<string, Promise<string>>();
  constructor(
    private readonly collection: Collection,
    private readonly http: ProviderHttpClient,
  ) {
    this.id = collection.id;
  }
  refresh() {
    this.catalogTask = undefined;
    this.texts.clear();
    this.http.refresh();
  }
  private raw(revision: string, name: string) {
    return `https://raw.githubusercontent.com/${this.collection.repository}/${revision}/${encodedPath(name)}`;
  }
  private text(revision: string, entry: Entry): Promise<string> {
    if (entry.size === undefined || entry.size > 65536)
      fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: notice or pointer exceeds 64 KiB');
    const url = this.raw(revision, entry.path);
    let task = this.texts.get(url);
    if (!task) {
      task = this.http.text(this.id, url, 65536);
      this.texts.set(url, task);
      task.catch(() => this.texts.delete(url));
    }
    return task;
  }
  private catalog(): Promise<Catalog> {
    if (!this.catalogTask || Date.now() >= this.expiresAt) {
      this.expiresAt = Date.now() + 86400000;
      this.catalogTask = this.loadCatalog().catch((error) => {
        this.catalogTask = undefined;
        throw error;
      });
    }
    return this.catalogTask;
  }
  private async loadCatalog(): Promise<Catalog> {
    const base = `https://api.github.com/repos/${this.collection.repository}`;
    const commit = response(
      z.object({ sha: hash }),
      await this.http.json(this.id, base + '/commits/main'),
    );
    const tree = response(
      treeSchema,
      await this.http.json(this.id, `${base}/git/trees/${commit.sha}?recursive=1`),
    );
    if (tree.truncated)
      fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: GitHub returned an incomplete file tree');
    const entries = tree.tree.filter((entry) => entry.type === 'blob' && entry.mode === '100644');
    for (const entry of entries) {
      if (
        /^[\/]|[\\:\x00]/.test(entry.path) ||
        entry.path.split('/').some((part) => !part || part === '.' || part === '..')
      )
        fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: unsafe repository path');
    }
    const license = entries.find((entry) => entry.path === this.collection.licenseFile);
    if (!license || !ccByNotice.test(await this.text(commit.sha, license)))
      fail('UNSUPPORTED_LICENSE', 'IFC provider: collection no longer declares CC BY 4.0');
    const models = entries
      .filter(
        (entry) =>
          /\.ifc$/i.test(entry.path) &&
          (!this.collection.folders ||
            this.collection.folders.some((folder) => entry.path.startsWith(folder + '/'))),
      )
      .sort((a, b) => a.path.localeCompare(b.path, 'en'));
    return { revision: commit.sha, entries, models };
  }
  private async find(remoteId: string) {
    response(remoteIdSchema, remoteId);
    const catalog = await this.catalog();
    const entry = catalog.models.find((item) => identity(item.path) === remoteId);
    if (!entry) fail('REMOTE_MODEL_NOT_FOUND', 'IFC provider: model is not in this collection');
    return { catalog, entry };
  }
  private notices(catalog: Catalog, entry: Entry) {
    return catalog.entries.filter(
      (file) =>
        /^(?:readme(?:\.md)?|licen[cs]e(?:\.md|\.txt)?)$/i.test(path.posix.basename(file.path)) &&
        (path.posix.dirname(file.path) === '.' ||
          entry.path.startsWith(path.posix.dirname(file.path) + '/')),
    );
  }
  private async definition(catalog: Catalog, entry: Entry): Promise<ProviderModel> {
    const notices = this.notices(catalog, entry);
    // Curated community folders have their own declaration and original credits.
    if (this.collection.folders) {
      const folder = this.collection.folders.find((folder) => entry.path.startsWith(folder + '/'))!;
      const notice = notices.find(
        (file) =>
          path.posix.dirname(file.path) === folder &&
          /^readme/i.test(path.posix.basename(file.path)),
      );
      if (!notice || !ccByNotice.test(await this.text(catalog.revision, notice)))
        fail(
          'UNSUPPORTED_LICENSE',
          'IFC provider: sample no longer declares the reviewed CC BY 4.0 license',
        );
    }
    // Do not inherit a repository license across a new, unreviewed local override.
    if (
      notices.some(
        (file) =>
          /^licen[cs]e/i.test(path.posix.basename(file.path)) &&
          file.path !== this.collection.licenseFile,
      )
    )
      fail('UNSUPPORTED_LICENSE', 'IFC provider: sample has a separate license that needs review');
    return {
      provider: this.id,
      remoteId: identity(entry.path),
      name: path.posix.basename(entry.path, path.posix.extname(entry.path)).replaceAll('_', ' '),
      description: `${this.collection.name}: ${entry.path}. Sample files may contain invalid or unsupported IFC entities.`,
      tags: ['ifc', 'bim', 'aeco', 'buildingsmart'],
      categories: ['ifc'],
      sourceUrl: `https://github.com/${this.collection.repository}/blob/${catalog.revision}/${encodedPath(entry.path)}`,
      license: ccBy,
      availableResolutions: ['original'],
      metadata: {
        repository: this.collection.repository,
        revision: catalog.revision,
        path: entry.path,
        gitBlob: entry.sha,
        attributionFiles: notices.map((file) => file.path),
      },
    };
  }
  private async download(catalog: Catalog, entry: Entry): Promise<ProviderDownload> {
    const file: ProviderDownloadFile = {
      role: 'entrypoint',
      filename: path.posix.basename(entry.path),
      url: this.raw(catalog.revision, entry.path),
      sizeBytes: entry.size,
    };
    if (entry.size === undefined)
      fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: missing file size');
    if (entry.size <= 1024) {
      const text = await this.text(catalog.revision, entry);
      if (text.startsWith('version https://git-lfs.github.com/spec/v1')) {
        const pointer =
          /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize ([0-9]+)\s*$/.exec(
            text,
          );
        if (!pointer || !Number.isSafeInteger(Number(pointer[2])) || Number(pointer[2]) <= 0)
          fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: invalid Git LFS pointer');
        file.url = `https://media.githubusercontent.com/media/${this.collection.repository}/${catalog.revision}/${encodedPath(entry.path)}`;
        file.sizeBytes = Number(pointer[2]);
        file.checksum = { algorithm: 'sha256', value: pointer[1] };
      }
    }
    const files: ProviderDownloadFile[] = [
      file,
      ...this.notices(catalog, entry).map((notice, index) => ({
        role: 'resource',
        filename: path.posix.basename(notice.path),
        packagePath: `provenance/${index}-${path.posix.basename(notice.path)}`,
        url: this.raw(catalog.revision, notice.path),
        sizeBytes: notice.size,
      })),
    ];
    if (files.some((file) => file.sizeBytes === undefined))
      fail('INVALID_PROVIDER_RESPONSE', 'IFC provider: missing notice size');
    return {
      id: 'original-ifc',
      resolution: 'original',
      format: 'ifc',
      files,
      estimatedBytes: files.reduce((sum, file) => sum + file.sizeBytes!, 0),
    };
  }
  async search(input: ProviderSearchQuery = {}) {
    const query = response(searchSchema, input),
      catalog = await this.catalog();
    const words = query.text?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const selected = catalog.models.filter(
      (entry) =>
        words.every((word) => entry.path.toLowerCase().includes(word)) &&
        [...(query.tags ?? []), ...(query.categories ?? [])].every((tag) =>
          ['ifc', 'bim', 'aeco', 'buildingsmart'].includes(tag.toLowerCase()),
        ),
    );
    const offset = Number(query.cursor ?? 0);
    const items = await Promise.all(
      selected.slice(offset, offset + query.limit).map(async (entry) => {
        const model = await this.definition(catalog, entry),
          download = await this.download(catalog, entry);
        return {
          ...model,
          downloadOptions: [
            {
              id: download.id,
              resolution: download.resolution,
              format: download.format,
              sizeBytes: download.estimatedBytes,
              fileCount: download.files.length,
            },
          ],
        };
      }),
    );
    return {
      items,
      total: selected.length,
      ...(offset + items.length < selected.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    };
  }
  async getModel(remoteId: string) {
    const { catalog, entry } = await this.find(remoteId);
    return this.definition(catalog, entry);
  }
  async getDownloads(remoteId: string) {
    const { catalog, entry } = await this.find(remoteId);
    await this.definition(catalog, entry);
    return [await this.download(catalog, entry)];
  }
}
