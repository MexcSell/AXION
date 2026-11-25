import { create } from 'zustand';
import { getMissionControl } from './missionControl';
import { seeded } from './agents';
import { useData } from '@/store/data';
import type { Artifact, ArtifactVersion, Mission } from './types';

/** Shared helpers for Results & Versions pages and dialogs (spec §4.9). */
export interface ArtRef { mission: Mission; artifact: Artifact; }

export function allArtifacts(missions: Mission[] = useData.getState().missions): ArtRef[] {
  return missions.flatMap((m) => getMissionControl(m).artifacts.map((artifact) => ({ mission: m, artifact })));
}
export function findArtifact(missionId?: string, artifactId?: string): ArtRef | undefined {
  const all = allArtifacts();
  return all.find((r) => r.artifact.id === artifactId) ?? all.find((r) => r.mission.id === missionId && r.artifact.runnable) ?? all.find((r) => r.mission.id === missionId) ?? all[0];
}
export const pickVersion = (a: Artifact, v?: string): ArtifactVersion => a.versions.find((x) => x.v === v) ?? a.versions[0];

export const EXT: Record<Artifact['type'], string> = { website: 'zip', document: 'md', image: 'png', dataset: 'csv', code: 'patch', report: 'html', recipe: 'json', screenshot: 'png', video: 'mp4' };

/** Real SHA-256 of the manifest JSON text (Web Crypto) so the "verify hash" demo is genuine. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildManifest(refs: { artifact: Artifact; version: ArtifactVersion }[]) {
  return {
    format: 'axion-artifact-manifest/1',
    generatedBy: 'AXION demo (client-side)',
    note: 'DEMO: this manifest describes retained immutable versions. No artifact bytes are included in the prototype.',
    files: refs.map(({ artifact, version }) => ({
      artifactId: artifact.id, mission: artifact.missionId, name: artifact.name, type: artifact.type, version: version.v,
      file: `${artifact.name.replace(/[^a-z0-9.]+/gi, '-').toLowerCase()}-${version.v}.${EXT[artifact.type]}`,
      checksum: version.hash, size: version.size, verified: version.verified, createdBy: version.by, notes: version.notes,
    })),
  };
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Deterministic pseudo-content for diffing: JSON-ish lines that evolve per version. */
export function contentLines(a: Artifact, v: string): string[] {
  const n = Number(v.replace(/[^0-9]/g, '').slice(1) || '0');
  const r = seeded(a.id + 'c' + n);
  const lines = [
    '{',
    `  "artifact": "${a.name}",`,
    `  "mission": "${a.missionId}",`,
    `  "build": ${100 + n * 3 + (r() > .5 ? 1 : 0)},`,
    `  "theme": "${n > 1 ? 'dark-luminous' : 'dark'}",`,
    `  "pages": ${12 + n * 2},`,
    `  "a11y_score": ${88 + Math.min(9, n * 3)},`,
    n > 0 ? `  "visual_diff": "${(0.9 - n * 0.2).toFixed(1)}%",` : '  "visual_diff": "n/a",',
    `  "csp": "${n > 0 ? "style-src 'nonce-…'" : "style-src 'unsafe-inline'"}",`,
    '  "checks": {',
    `    "unit": ${40 + n * 5},`,
    `    "e2e": ${n > 0 ? 'true' : 'false'},`,
    ...(n > 1 ? ['    "lighthouse": "passed",'] : []),
    `    "owner_review": ${n > 2 ? 'true' : 'false'}`,
    '  },',
    `  "dependencies": ["react@19", "motion@12"${n > 1 ? ', "zod@3"' : ''}]`,
    '}',
  ];
  return lines;
}

export type DiffRow = { kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number };
/** Tiny LCS line diff. */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  const m = a.length, n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) { out.push({ kind: 'del', text: a[i], a: i + 1 }); i++; }
    else { out.push({ kind: 'add', text: b[j], b: j + 1 }); j++; }
  }
  while (i < m) { out.push({ kind: 'del', text: a[i], a: i + 1 }); i++; }
  while (j < n) { out.push({ kind: 'add', text: b[j], b: j + 1 }); j++; }
  return out;
}

export const TYPE_HUE: Record<Artifact['type'], number> = { website: 200, document: 215, image: 320, dataset: 150, code: 280, report: 38, recipe: 175, screenshot: 335, video: 12 };

export const RELEASE_STAGES = ['candidate', 'tested', 'approved', 'deployed', 'rolled back'] as const;
export type ReleaseStage = typeof RELEASE_STAGES[number];

interface ResultsState {
  stage: Record<string, ReleaseStage>; pinned: Record<string, string>; proposals: { id: string; source: string; target: string }[];
  setStage: (artifactId: string, s: ReleaseStage) => void; pin: (artifactId: string, v: string) => void; propose: (source: string, target: string) => void;
}
export const useResults = create<ResultsState>()((set) => ({
  stage: {}, pinned: {}, proposals: [],
  setStage: (id, s) => set((st) => ({ stage: { ...st.stage, [id]: s } })),
  pin: (id, v) => set((st) => ({ pinned: { ...st.pinned, [id]: v } })),
  propose: (source, target) => set((st) => ({ proposals: [...st.proposals, { id: `PR-${120 + st.proposals.length}`, source, target }] })),
}));
/** Default release stage derived from the artifact's position (deterministic demo). */
export function defaultStage(a: Artifact, i: number): ReleaseStage {
  const r = seeded(a.id + 'rel')();
  return r < .2 ? 'candidate' : r < .45 ? 'tested' : r < .65 ? 'approved' : r < .95 ? 'deployed' : i % 2 ? 'rolled back' : 'deployed';
}
