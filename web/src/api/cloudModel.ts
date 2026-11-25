import { useCallback, useEffect, useState } from 'react';
import type { CloudCompletionDto, CloudModelFormat, CloudModelAction, CloudModelsDto } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { plainError } from '@/lib/plainError';

/**
 * The live cloud models (owner 2026-11-24), api mode only: one per CLAUDE_CODE_OAUTH_TOKEN<n> on the server.
 * GET /cloud-models lists them (never a token); POST /cloud-models/:id/complete sends one prompt (administrators only) and returns the real answer.
 * Demo mode never calls them.
 */
export interface CloudModelsRead { data: CloudModelsDto | null; error: string | null; refresh: () => void; manage: (id: string, action: CloudModelAction) => Promise<void> }
export function useCloudModels(active = true): CloudModelsRead {
  const [n, setN] = useState(0);
  const [st, setSt] = useState<{ data: CloudModelsDto | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!active || !isApi()) return;
    let live = true;
    api<CloudModelsDto>('GET', '/cloud-models')
      .then((d) => {
        if (!live) return;
        if (d.models.some(m => typeof m.enabled !== 'boolean')) {
          setSt({ data: null, error: 'Provider management needs the updated AXION API. Restart the API and reload this page.' });
          return;
        }
        setSt({ data: d, error: null });
      })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: plainError(e) })); });
    return () => { live = false; };
  }, [active, n]);
  const manage = async (id: string, action: CloudModelAction) => {
    let data: CloudModelsDto;
    try { data = await api<CloudModelsDto>('POST', `/cloud-models/${encodeURIComponent(id)}/manage`, { action }); }
    catch (e) {
      if (e instanceof ApiFailure && (e.status === 404 || e.status === 409)) setN(x => x + 1);
      throw e;
    }
    const model = data.models.find(m => m.id === id);
    // Independent actions on different cards may finish out of order.
    setSt(prev => {
      if (!prev.data) return { error: null, data };
      const models = model
        ? prev.data.models.map(m => m.id === id ? model : m)
        : prev.data.models.filter(m => m.id !== id);
      return { error: null, data: { ...prev.data, models } };
    });
  };
  return { ...st, manage, refresh: useCallback(() => setN((x) => x + 1), []) };
}

export type CloudRun = { ok: true; value: CloudCompletionDto } | { ok: false; message: string };
export async function runCloudPrompt(id: string, prompt: string, format: CloudModelFormat): Promise<CloudRun> {
  try { return { ok: true, value: await api<CloudCompletionDto>('POST', `/cloud-models/${encodeURIComponent(id)}/complete`, { prompt, format }) }; }
  catch (e) { return { ok: false, message: providerError(e) }; }
}

export function providerError(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === 'FORBIDDEN') return 'Only administrators can manage live models.';
    if (e.code === 'NOT_FOUND') return 'This model is no longer registered. The provider list has been refreshed.';
    if (e.code.startsWith('MODEL_') || e.code === 'ACTION_NOT_ALLOWED') return e.message;
  }
  return plainError(e);
}
