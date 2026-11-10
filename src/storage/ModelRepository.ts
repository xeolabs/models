import { mime } from './AssetStore.js';
import { randomUUID } from 'node:crypto';
import { Database } from './Database.js';
import { metadataSchema, querySchema, parse, tagsSchema } from '../domain/schema.js';
import type { ModelRecord, ModelQuery, ModelFormat, ModelFile } from '../domain/types.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Keeps catalog changes, tags and the search index in the same transaction.
 */
export class ModelRepository {
  constructor(readonly db: Database) {}
  get(id: string): ModelRecord | null {
    const row = this.db.sql.prepare('SELECT * FROM models WHERE id=?').get(id);
    if (!row) return null;
    return {
      id: row.id as string,
      metadata: {
        name: row.name as string,
        description: row.description as string,
        source: JSON.parse(row.source_json as string),
        tags: this.db.sql
          .prepare('SELECT tag FROM model_tags WHERE model_id=? ORDER BY tag')
          .all(id)
          .map((r) => r.tag as string),
      },
      entrypoint: row.entrypoint as string | null,
      format: row.format as ModelFormat | null,
      warnings: JSON.parse(row.warnings_json as string),
      files: (
        this.db.sql
          .prepare(
            'SELECT f.path,f.asset_id assetId,a.bytes,a.mime FROM model_files f JOIN assets a ON a.id=f.asset_id WHERE model_id=? ORDER BY path',
          )
          .all(id) as unknown as ModelFile[]
      ).map((file) => ({ ...file, mime: mime(file.path) })),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
  require(id: string) {
    return this.get(id) ?? fail('MODEL_NOT_FOUND', 'Model does not exist: ' + id);
  }
  create(
    input: unknown,
    entrypoint: string | null = null,
    format: ModelFormat | null = null,
    warnings: string[] = [],
  ) {
    const metadata = parse(metadataSchema, input),
      id = randomUUID(),
      now = new Date().toISOString();
    this.db.sql
      .prepare('INSERT INTO models VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        metadata.name,
        metadata.description,
        JSON.stringify(metadata.source),
        entrypoint,
        format,
        JSON.stringify(warnings),
        now,
        now,
      );
    this.tags(id, metadata.tags);
    this.index(id);
    return this.require(id);
  }
  update(id: string, input: unknown) {
    const current = this.require(id);
    const patch = parse(metadataSchema.partial(), input);
    const metadata = parse(metadataSchema, { ...current.metadata, ...patch });
    this.db.sql
      .prepare('UPDATE models SET name=?,description=?,source_json=?,updated_at=? WHERE id=?')
      .run(
        metadata.name,
        metadata.description,
        JSON.stringify(metadata.source),
        new Date().toISOString(),
        id,
      );
    this.tags(id, metadata.tags);
    this.index(id);
    return this.require(id);
  }
  tags(id: string, tags: string[]) {
    tags = parse(tagsSchema, tags);
    this.db.sql.prepare('DELETE FROM model_tags WHERE model_id=?').run(id);
    for (const tag of tags) {
      this.db.sql.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      this.db.sql.prepare('INSERT INTO model_tags VALUES(?,?)').run(id, tag);
    }
    this.db.sql
      .prepare('DELETE FROM tags WHERE NOT EXISTS(SELECT 1 FROM model_tags WHERE tag=tags.name)')
      .run();
  }
  index(id: string) {
    const model = this.require(id);
    this.db.sql.prepare('DELETE FROM model_search WHERE id=?').run(id);
    this.db.sql
      .prepare('INSERT INTO model_search VALUES(?,?,?,?,?,?)')
      .run(
        id,
        model.metadata.name,
        model.metadata.description,
        model.metadata.tags.join(' '),
        model.metadata.source.provider ?? '',
        model.format ?? '',
      );
  }
  list(input: ModelQuery = {}) {
    const q = parse(querySchema, input),
      clauses: string[] = [],
      params: (string | number)[] = [];
    if (q.text?.trim()) {
      clauses.push('id IN (SELECT id FROM model_search WHERE model_search MATCH ?)');
      params.push(
        q.text
          .trim()
          .split(/\s+/)
          .map((t) => '"' + t.replaceAll('"', '""') + '"*')
          .join(' AND '),
      );
    }
    if (q.provider) {
      clauses.push("json_extract(source_json,'$.provider')=?");
      params.push(q.provider);
    }
    if (q.format) {
      clauses.push('format=?');
      params.push(q.format);
    }
    if (q.formats) {
      clauses.push('format IN (' + q.formats.map(() => '?').join(',') + ')');
      params.push(...q.formats);
    }
    for (const tag of q.tags ?? []) {
      clauses.push('id IN (SELECT model_id FROM model_tags WHERE tag=?)');
      params.push(tag);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
      sort = { name: 'name COLLATE NOCASE', createdAt: 'created_at', updatedAt: 'updated_at' }[
        q.sort
      ];
    const total = Number(
      this.db.sql.prepare('SELECT count(*) n FROM models' + where).get(...params)!.n,
    );
    const items = this.db.sql
      .prepare(
        'SELECT id FROM models' +
          where +
          ' ORDER BY ' +
          sort +
          ' ' +
          q.direction +
          ',id LIMIT ? OFFSET ?',
      )
      .all(...params, q.limit, q.offset)
      .map((r) => this.require(r.id as string));
    return { items, total, limit: q.limit, offset: q.offset };
  }
  delete(id: string) {
    this.require(id);
    this.db.sql.prepare('DELETE FROM model_search WHERE id=?').run(id);
    this.db.sql.prepare('DELETE FROM models WHERE id=?').run(id);
    this.db.sql
      .prepare('DELETE FROM tags WHERE NOT EXISTS(SELECT 1 FROM model_tags WHERE tag=tags.name)')
      .run();
  }
  listTags() {
    return this.db.sql
      .prepare('SELECT tag name,count(*) count FROM model_tags GROUP BY tag ORDER BY tag')
      .all() as unknown as { name: string; count: number }[];
  }
}
