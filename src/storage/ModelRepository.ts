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
  private async records(ids: string[]): Promise<ModelRecord[]> {
    if (!ids.length) return [];
    const rows = await this.db.all(
      `SELECT m.*,
      COALESCE((SELECT json_agg(tag ORDER BY tag) FROM model_tags WHERE model_id=m.id),'[]') tags,
      COALESCE((SELECT json_agg(json_build_object('path',f.path,'assetId',f.asset_id,'bytes',a.bytes) ORDER BY f.path)
        FROM model_files f JOIN assets a ON a.id=f.asset_id WHERE model_id=m.id),'[]') files
      FROM models m WHERE m.id=ANY($1::text[])`,
      [ids],
    );
    const records = new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id as string,
          metadata: {
            name: row.name as string,
            description: row.description as string,
            source: JSON.parse(row.source_json as string),
            tags: row.tags as string[],
          },
          entrypoint: row.entrypoint as string | null,
          format: row.format as ModelFormat | null,
          warnings: JSON.parse(row.warnings_json as string),
          files: (row.files as ModelFile[]).map((file) => ({ ...file, mime: mime(file.path) })),
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        },
      ]),
    );
    return ids.flatMap((id) => (records.has(id) ? [records.get(id)!] : []));
  }
  async get(id: string): Promise<ModelRecord | null> {
    return (await this.records([id]))[0] ?? null;
  }
  async require(id: string) {
    return (await this.get(id)) ?? fail('MODEL_NOT_FOUND', 'Model does not exist: ' + id);
  }
  async create(
    input: unknown,
    entrypoint: string | null = null,
    format: ModelFormat | null = null,
    warnings: string[] = [],
  ) {
    const metadata = parse(metadataSchema, input),
      id = randomUUID(),
      now = new Date().toISOString();
    await this.db.query('INSERT INTO models VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      id,
      metadata.name,
      metadata.description,
      JSON.stringify(metadata.source),
      entrypoint,
      format,
      JSON.stringify(warnings),
      now,
      now,
    ]);
    await this.tags(id, metadata.tags);
    await this.index(id);
    return await this.require(id);
  }
  async update(id: string, input: unknown) {
    await this.db.lock('model:' + id);
    const current = await this.require(id);
    const patch = parse(metadataSchema.partial(), input);
    const metadata = parse(metadataSchema, { ...current.metadata, ...patch });
    await this.db.query(
      'UPDATE models SET name=$1,description=$2,source_json=$3,updated_at=$4 WHERE id=$5',
      [
        metadata.name,
        metadata.description,
        JSON.stringify(metadata.source),
        new Date().toISOString(),
        id,
      ],
    );
    await this.tags(id, metadata.tags);
    await this.index(id);
    return await this.require(id);
  }
  async tags(id: string, tags: string[]) {
    await this.db.lock('tags');
    tags = parse(tagsSchema, tags);
    await this.db.query('DELETE FROM model_tags WHERE model_id=$1', [id]);
    for (const tag of tags) {
      await this.db.query('INSERT INTO tags VALUES($1) ON CONFLICT DO NOTHING', [tag]);
      await this.db.query('INSERT INTO model_tags VALUES($1,$2)', [id, tag]);
    }
    await this.db.query(
      'DELETE FROM tags WHERE NOT EXISTS(SELECT 1 FROM model_tags WHERE tag=tags.name)',
      [],
    );
  }
  async index(id: string) {
    const model = await this.require(id);
    await this.db.query('DELETE FROM model_search WHERE id=$1', [id]);
    await this.db.query(
      'INSERT INTO model_search(id,name,description,tags,provider,format) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        model.metadata.name,
        model.metadata.description,
        model.metadata.tags.join(' '),
        model.metadata.source.provider ?? '',
        model.format ?? '',
      ],
    );
  }
  async list(input: ModelQuery = {}) {
    const q = parse(querySchema, input),
      clauses: string[] = [],
      params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return '$' + params.length;
    };
    if (q.text?.trim()) {
      const text = bind(q.text.trim());
      clauses.push(`id IN (SELECT id FROM model_search WHERE document @@
        to_tsquery('simple',(SELECT string_agg(quote_literal(term)||':*',' & ')
          FROM unnest(tsvector_to_array(to_tsvector('simple',lower(${text} COLLATE catalog_text)))) term)))`);
    }
    if (q.provider) clauses.push(`source_json::json->>'provider'=${bind(q.provider)}`);
    if (q.format) clauses.push(`format=${bind(q.format)}`);
    if (q.formats) clauses.push(`format=ANY(${bind(q.formats)}::text[])`);
    for (const tag of q.tags ?? [])
      clauses.push(`id IN (SELECT model_id FROM model_tags WHERE tag=${bind(tag)})`);
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const sort = {
      name: 'lower(name COLLATE catalog_text) COLLATE "C"',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }[q.sort];
    const total = Number((await this.db.one('SELECT count(*) n FROM models' + where, params))!.n);
    const limit = bind(q.limit),
      offset = bind(q.offset);
    const rows = await this.db.all(
      `SELECT id FROM models${where} ORDER BY ${sort} ${q.direction},id LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      items: await this.records(rows.map((row) => row.id as string)),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }
  async delete(id: string) {
    await this.db.lock('tags');
    await this.require(id);
    await this.db.query('DELETE FROM model_search WHERE id=$1', [id]);
    await this.db.query('DELETE FROM models WHERE id=$1', [id]);
    await this.db.query(
      'DELETE FROM tags WHERE NOT EXISTS(SELECT 1 FROM model_tags WHERE tag=tags.name)',
      [],
    );
  }
  async listTags() {
    return (await this.db.all(
      'SELECT tag name,count(*) count FROM model_tags GROUP BY tag ORDER BY tag',
      [],
    )) as unknown as { name: string; count: number }[];
  }
}
