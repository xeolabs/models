import { Database } from '../storage/Database.js';
import { fail } from '../domain/ModelsError.js';
import { validatePlan } from './planSchema.js';
import type { AcquisitionPlan, PlanListQuery, Page } from './types.js';
export class AcquisitionPlanRepository {
  constructor(private readonly db: Database) {}
  get(id: string): AcquisitionPlan | null {
    const row = this.db.sql.prepare('SELECT * FROM acquisition_plans WHERE id=?').get(id);
    if (!row) return null;
    return validatePlan({
      id: row.id,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      criteria: JSON.parse(row.criteria_json as string),
      summary: JSON.parse(row.summary_json as string),
      fingerprint: row.fingerprint,
      warnings: JSON.parse(row.warnings_json as string),
      items: this.db.sql
        .prepare(
          'SELECT manifest_json FROM acquisition_plan_items WHERE plan_id=? ORDER BY ordinal',
        )
        .all(id)
        .map((r) => JSON.parse(r.manifest_json as string)),
    });
  }
  require(id: string) {
    const p = this.get(id);
    if (!p) fail('PLAN_NOT_FOUND', 'Acquisition plan: plan does not exist');
    return p;
  }
  save(value: unknown) {
    const plan = validatePlan(value);
    return this.db.transaction(() => {
      const existing = this.get(plan.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(plan))
          fail('INVALID_PLAN', 'Import plan: UUID already belongs to another snapshot');
        return existing;
      }
      this.db.sql
        .prepare('INSERT INTO acquisition_plans VALUES(?,?,?,?,?,?,?,?)')
        .run(
          plan.id,
          1,
          plan.createdAt,
          plan.expiresAt ?? null,
          JSON.stringify(plan.criteria),
          JSON.stringify(plan.summary),
          plan.fingerprint,
          JSON.stringify(plan.warnings),
        );
      const insert = this.db.sql.prepare(
        'INSERT INTO acquisition_plan_items VALUES(?,?,?,?,?,?,?,?,?)',
      );
      for (const i of plan.items)
        insert.run(
          i.id,
          plan.id,
          i.ordinal,
          i.provider,
          i.remoteId,
          i.modelName,
          i.resolution,
          i.format,
          JSON.stringify(i),
        );
      return plan;
    });
  }
  list(q: PlanListQuery = {}): Page<AcquisitionPlan> {
    const { limit, offset } = pageQuery(q);
    const total = Number(
      this.db.sql.prepare('SELECT count(*) AS n FROM acquisition_plans').get()!.n,
    );
    return {
      items: this.db.sql
        .prepare('SELECT id FROM acquisition_plans ORDER BY created_at DESC,id LIMIT ? OFFSET ?')
        .all(limit, offset)
        .map((r) => this.require(r.id as string)),
      total,
      limit,
      offset,
    };
  }
  existing(provider: string, remoteId: string, resolution: string, format: string) {
    return this.db.sql
      .prepare(
        'SELECT model_id FROM model_acquisitions WHERE provider=? AND remote_asset_id=? AND resolution=? AND format=? AND model_id IS NOT NULL ORDER BY acquired_at DESC,id LIMIT 1',
      )
      .get(provider, remoteId, resolution, format)?.model_id as string | undefined;
  }
}
export function pageQuery(q: PlanListQuery = {}) {
  const limit = q.limit ?? 50,
    offset = q.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    fail('INVALID_PLAN', 'Acquisition listing: invalid pagination');
  return { limit, offset };
}
