import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { demoLedgers, type LedgerVersionPageDto, stallCheck, STALL_POLICY, type LedgerDto, type LedgerKind, type LedgersDto, type LedgerVersionDto, type ProgressBody, type TaskBody } from '@contracts';
import type { Mission } from '@/data/types';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/**
 * Mission ledgers (improvement cycle 39). Api mode reads GET /missions/:id/ledgers and re-reads on every ledger.updated
 * event and stream reconnect (bumpLedgers, from api/events.ts). Demo mode shows a labelled DEMO sample built from the
 * fixture mission; it cannot be edited (editing is stored on the server).
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpLedgers = () => useTick.setState((s) => ({ n: s.n + 1 }));

const SERVER_STATUS: Record<string, string> = { waiting: 'waiting_approval' };
/** The same sample the server seeds, for demo mode: every version flagged demo. */
function demoDto(m: Mission): LedgersDto {
  const rows = demoLedgers({ title: m.title, objective: m.objective, status: SERVER_STATUS[m.status] ?? m.status, criteria: m.criteria });
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const v = { task: 0, progress: 0 };
  const dtos: LedgerDto[] = rows.map((r) => ({ id: `demo-${m.id}-${r.kind}-${v[r.kind] + 1}`, missionId: m.id, kind: r.kind, version: ++v[r.kind], body: r.body, authorId: 'demo', authorName: 'DEMO sample', authorKind: 'system', createdAt: at, demo: true }));
  const of = (k: LedgerKind) => dtos.filter((d) => d.kind === k);
  const meta = (d: LedgerDto): LedgerVersionDto => ({ version: d.version, authorId: d.authorId, authorName: d.authorName, authorKind: d.authorKind, createdAt: d.createdAt, demo: true });
  const last = <B,>(k: LedgerKind) => (of(k).slice(-1)[0] ?? null) as LedgerDto<B> | null;
  return {
    ledgers: { task: last<TaskBody>('task'), progress: last<ProgressBody>('progress') },
    versions: { task: of('task').map(meta).reverse(), progress: of('progress').map(meta).reverse() }, moreVersions: { task: null, progress: null },
    stall: stallCheck(of('progress').map((d) => d.body as ProgressBody)), policy: STALL_POLICY, canEdit: false, demo: true,
  };
}

export interface LedgerRead { data: LedgersDto | null; error: string | null; retry: () => void; sample: boolean }
export function useLedgers(m: Mission): LedgerRead {
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ id: string; data: LedgersDto | null; error: string | null }>({ id: m.id, data: null, error: null });
  const sample = !isApi();
  const demo = useMemo(() => (sample ? demoDto(m) : null), [sample, m]);
  useEffect(() => {
    if (sample) return;
    let live = true;
    api<LedgersDto>('GET', `/missions/${encodeURIComponent(m.id)}/ledgers`)
      .then((r) => { if (live) setSt({ id: m.id, data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ id: m.id, data: x.id === m.id ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [m.id, tick, sample]);
  return sample ? { data: demo, error: null, retry: () => undefined, sample: true } : { data: st.id === m.id ? st.data : null, error: st.error, retry: bumpLedgers, sample: false };
}

/** One stored version (api mode); in demo mode the sample's. */
export async function fetchLedgerVersion(m: Mission, kind: LedgerKind, version: number): Promise<LedgerDto | null> {
  if (!isApi()) { const d = demoDto(m); return (d.ledgers[kind] && d.ledgers[kind]!.version === version ? d.ledgers[kind] : null) as LedgerDto | null ?? null; }
  try { return (await api<{ ledger: LedgerDto }>('GET', `/missions/${encodeURIComponent(m.id)}/ledgers/${kind}/${version}`)).ledger; } catch { return null; }
}

export type LedgerWrite = { ok: true; value: LedgerDto } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
export async function saveLedger(missionId: string, kind: LedgerKind, baseVersion: number, body: unknown): Promise<LedgerWrite> {
  try { const r = await api<{ ledger: LedgerDto }>('POST', `/missions/${encodeURIComponent(missionId)}/ledgers/${kind}`, { baseVersion, body }); bumpLedgers(); return { ok: true, value: r.ledger }; }
  catch (e) { bumpLedgers(); return e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: e.fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' }; }
}
/** The latest stored ledger of a kind (for the editor's conflict handling). */
export async function latestLedger(missionId: string): Promise<{ task: LedgerDto | null; progress: LedgerDto | null } | null> {
  try { return (await api<LedgersDto>('GET', `/missions/${encodeURIComponent(missionId)}/ledgers`)).ledgers; } catch { return null; }
}

/** The next older page of version metadata (api mode), or null on failure. */
export async function fetchVersionsPage(missionId: string, kind: LedgerKind, before: number): Promise<LedgerVersionPageDto | null> {
  try { return await api<LedgerVersionPageDto>('GET', `/missions/${encodeURIComponent(missionId)}/ledgers/${kind}/versions?before=${before}&limit=100`); } catch { return null; }
}
/** One stored version by mission id (for the editor's conflict diff). */
export async function fetchLedgerBody(missionId: string, kind: LedgerKind, version: number): Promise<LedgerDto | null> {
  try { return (await api<{ ledger: LedgerDto }>('GET', `/missions/${encodeURIComponent(missionId)}/ledgers/${kind}/${version}`)).ledger; } catch { return null; }
}
