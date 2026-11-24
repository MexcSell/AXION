import { useCallback, useEffect, useState } from 'react';
import type { CloudCompletionDto, CloudModelFormat, CloudModelsDto } from '@contracts';
import { api } from './client';
import { isApi } from './mode';
import { plainError } from '@/lib/plainError';

/**
 * The live cloud models (owner 2026-11-24), api mode only: one per CLAUDE_CODE_OAUTH_TOKEN<n> on the server.
 * GET /cloud-models lists them (never a token); POST /cloud-models/:id/complete sends one prompt (administrators only) and returns the real answer.
 * Demo mode never calls them.
 */
export interface CloudModelsRead { data: CloudModelsDto | null; error: string | null; refresh: () => void }
export function useCloudModels(): CloudModelsRead {
  const [n, setN] = useState(0);
  const [st, setSt] = useState<{ data: CloudModelsDto | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    api<CloudModelsDto>('GET', '/cloud-models')
      .then((d) => { if (live) setSt({ data: d, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: plainError(e) })); });
    return () => { live = false; };
  }, [n]);
  return { ...st, refresh: useCallback(() => setN((x) => x + 1), []) };
}

export type CloudRun = { ok: true; value: CloudCompletionDto } | { ok: false; message: string };
export async function runCloudPrompt(id: string, prompt: string, format: CloudModelFormat): Promise<CloudRun> {
  try { return { ok: true, value: await api<CloudCompletionDto>('POST', `/cloud-models/${encodeURIComponent(id)}/complete`, { prompt, format }) }; }
  catch (e) { return { ok: false, message: plainError(e) }; }
}

/** The Playground's id for a live model (`live:claude-1`), so it never collides with a catalog (demo) entry. */
export const LIVE_PREFIX = 'live:';
