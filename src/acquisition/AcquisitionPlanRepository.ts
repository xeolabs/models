import { Database } from '../storage/Database.js';
import { fail } from '../domain/ModelsError.js';
import { validatePlan } from './planSchema.js';
import type { AcquisitionPlan, PlanListQuery, Page } from './types.js';
export class AcquisitionPlanRepository {
  constructor(private readonly db: Database) {}
  async get(id: string): Promise<AcquisitionPlan | null> {
    const row = await this.db.one('SELECT * FROM acquisition_plans WHERE id=$1', [id]);
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
      items: (
        await this.db.all(
          'SELECT manifest_json FROM acquisition_plan_items WHERE plan_id=$1 ORDER BY ordinal',
          [id],
        )
      ).map((r) => JSON.parse(r.manifest_json as string)),
    });
  }
  async require(id: string) {
    const p = await this.get(id);
    if (!p) fail('PLAN_NOT_FOUND', 'Acquisition plan: plan does not exist');
    return p;
  }
  async save(value: unknown) {
    const plan = validatePlan(value);
    return await this.db.transaction(async () => {
      await this.db.lock('plan:' + plan.id);
      const existing = await this.get(plan.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(plan))
          fail('INVALID_PLAN', 'Import plan: UUID already belongs to another snapshot');
        return existing;
      }
      await this.db.query('INSERT INTO acquisition_plans VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
        plan.id,
        1,
        plan.createdAt,
        plan.expiresAt ?? null,
        JSON.stringify(plan.criteria),
        JSON.stringify(plan.summary),
        plan.fingerprint,
        JSON.stringify(plan.warnings),
      ]);
      for (const i of plan.items)
        await this.db.query(
          'INSERT INTO acquisition_plan_items VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            i.id,
            plan.id,
            i.ordinal,
            i.provider,
            i.remoteId,
            i.modelName,
            i.resolution,
            i.format,
            JSON.stringify(i),
          ],
        );
      return plan;
    });
  }
  async list(q: PlanListQuery = {}): Promise<Page<AcquisitionPlan>> {
    const { limit, offset } = pageQuery(q);
    const total = Number((await this.db.one('SELECT count(*) AS n FROM acquisition_plans', []))!.n);
    return {
      items: await Promise.all(
        (
          await this.db.all(
            'SELECT id FROM acquisition_plans ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
            [limit, offset],
          )
        ).map(async (r) => await this.require(r.id as string)),
      ),
      total,
      limit,
      offset,
    };
  }
  async existing(provider: string, remoteId: string, resolution: string, format: string) {
    return (
      await this.db.one(
        'SELECT model_id FROM model_acquisitions WHERE provider=$1 AND remote_asset_id=$2 AND resolution=$3 AND format=$4 AND model_id IS NOT NULL ORDER BY acquired_at DESC,id LIMIT 1',
        [provider, remoteId, resolution, format],
      )
    )?.model_id as string | undefined;
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
