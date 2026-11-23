import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.ts';
import type { Tx } from '../db.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { advisoryXactLock } from '../locks.ts';
import { ARTIFACT_MAX_BYTES, ARTIFACT_PRODUCER_KINDS, type ArtifactDetailDto, type ArtifactDto, type ArtifactVersionDto, type ArtifactsDto } from '../../../shared/contracts/src/index.ts';

/**
 * Artifact METADATA (c76 A1; PARKED for owner decision Q11). Administrators only.
 * HARD RULE: records only. No route stores, accepts, serves or signs a file: there is no upload, no download and no ticket. A version is a claim
 * (sha256, size, media type, producer) and, once recorded, never changes: a changed file is a new version, numbered by the server.
 */
const VersionIn = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().min(0).max(ARTIFACT_MAX_BYTES),
  mediaType: z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/),
  producer: z.string().trim().min(1).max(120),
  producerKind: z.enum(ARTIFACT_PRODUCER_KINDS),
}).strict();
const CreateIn = z.object({ name: z.string().trim().min(1).max(200), version: VersionIn }).strict();
const ID = /^ART-[0-9A-F]{32}$/;
const iso = (d: unknown) => new Date(d as string).toISOString();

const versionDto = (r: Record<string, any>): ArtifactVersionDto => ({
  version: r.version, sha256: r.sha256, sizeBytes: Number(r.size_bytes), mediaType: r.media_type, producer: r.producer, producerKind: r.producer_kind,
  recordedBy: r.recorded_by, recordedByName: r.by_name ?? r.recorded_by, createdAt: iso(r.created_at),
});
const VERSIONS = `select v.*, u.name as by_name from artifact_versions v left join users u on u.id = v.recorded_by`;
const ARTIFACT = `select a.*, u.name as by_name, (select count(*)::int from artifact_versions x where x.artifact_id = a.id) as version_count,
  (select max(version) from artifact_versions x where x.artifact_id = a.id) as latest_version from artifacts a left join users u on u.id = a.created_by`;
type Q = { query: Tx['query'] };

async function artifactDtos(q: Q, rows: Record<string, any>[]): Promise<ArtifactDto[]> {
  if (!rows.length) return [];
  const latest = (await q.query(`${VERSIONS} where (v.artifact_id, v.version) in (select unnest($1::text[]), unnest($2::int[]))`, [rows.map((r) => r.id), rows.map((r) => r.latest_version)])).rows;
  const by = new Map(latest.map((r) => [r.artifact_id, r]));
  return rows.map((r) => ({ id: r.id, name: r.name, createdBy: r.created_by, createdByName: r.by_name ?? r.created_by, createdAt: iso(r.created_at), versionCount: r.version_count, latest: versionDto(by.get(r.id)!) }));
}

export default async function artifactRoutes(app: FastifyInstance) {
  app.get('/artifacts', async (req): Promise<ArtifactsDto> => {
    const ctx = await requireAdmin(req);
    const rows = (await app.db.query(`${ARTIFACT} where a.tenant_id=$1 order by a.created_at desc, a.id limit 200`, [ctx.tenantId])).rows;
    return { artifacts: await artifactDtos(app.db, rows) };
  });

  app.get('/artifacts/:id', async (req): Promise<ArtifactDetailDto> => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const row = ID.test(id) ? (await app.db.query(`${ARTIFACT} where a.id=$1 and a.tenant_id=$2`, [id, ctx.tenantId])).rows[0] : undefined;
    if (!row) throw notFound('No such artifact.');
    const versions = (await app.db.query(`${VERSIONS} where v.artifact_id=$1 order by v.version desc`, [id])).rows;
    return { artifact: (await artifactDtos(app.db, [row]))[0], versions: versions.map(versionDto) };
  });

  app.post('/artifacts', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(CreateIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await advisoryXactLock(c, `artifact-name:${ctx.tenantId}:${b.name}`);
      if ((await c.query('select 1 from artifacts where tenant_id=$1 and name=$2', [ctx.tenantId, b.name])).rowCount) throw new ApiError('CONFLICT', 409, `An artifact named "${b.name}" already exists. Record a new version of it instead.`);
      const id = 'ART-' + randomBytes(16).toString('hex').toUpperCase();
      await c.query('insert into artifacts(id, tenant_id, name, created_by) values ($1,$2,$3,$4)', [id, ctx.tenantId, b.name, ctx.user.id]);
      await insertVersion(c, ctx, id, 1, b.version);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'artifact.create', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { name: b.name, sha256: b.version.sha256, sizeBytes: b.version.sizeBytes, recordOnly: true } });
      const row = (await c.query(`${ARTIFACT} where a.id=$1`, [id])).rows[0];
      return { status: 201, body: { artifact: (await artifactDtos(c, [row]))[0] } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.post('/artifacts/:id/versions', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(VersionIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      if (!ID.test(id) || !(await c.query('select 1 from artifacts where id=$1 and tenant_id=$2', [id, ctx.tenantId])).rowCount) throw notFound('No such artifact.');
      await advisoryXactLock(c, `artifact:${id}`); // one number at a time per artifact
      const last = (await c.query('select version, sha256 from artifact_versions where artifact_id=$1 order by version desc limit 1', [id])).rows[0];
      if (last.sha256 === b.sha256) throw new ApiError('CONFLICT', 409, 'The newest version already has this hash. A new version needs a changed file.');
      await insertVersion(c, ctx, id, last.version + 1, b);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'artifact.version', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { version: last.version + 1, sha256: b.sha256, sizeBytes: b.sizeBytes, recordOnly: true } });
      return { status: 201, body: { version: versionDto((await c.query(`${VERSIONS} where v.artifact_id=$1 and v.version=$2`, [id, last.version + 1])).rows[0]) } };
    });
    return reply.status(out.status).send(out.body);
  });
}

async function insertVersion(c: Tx, ctx: { tenantId: string; user: { id: string } }, artifactId: string, version: number, v: z.infer<typeof VersionIn>) {
  await c.query(`insert into artifact_versions(artifact_id, version, tenant_id, sha256, size_bytes, media_type, producer, producer_kind, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [artifactId, version, ctx.tenantId, v.sha256, v.sizeBytes, v.mediaType, v.producer, v.producerKind, ctx.user.id]);
}
