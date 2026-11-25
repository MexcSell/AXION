import type { CloudModelCheck, CloudUsageWindow } from '../../../shared/contracts/src/index.ts';

const labels: Record<string, string> = {
  five_hour: '5-hour session', seven_day: 'Weekly limit', seven_day_overage_included: 'Weekly limit · Fable',
  seven_day_opus: 'Weekly limit · Opus', seven_day_sonnet: 'Weekly limit · Sonnet',
};

function resetTime(value: unknown): string | null {
  const ms = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value * 1000 : NaN;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Read only the named account and quota fields. CLI transcripts and provider error messages stay on the server. */
export function providerCheck(output: string, exitCode: number | null): CloudModelCheck {
  const check: CloudModelCheck = { checkedAt: new Date().toISOString(), status: 'unavailable', resetsAt: null, account: null, windows: [] };
  const windows = new Map<string, CloudUsageWindow>();
  const add = (label: string, percent: unknown, reset: unknown) => {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return;
    windows.set(label, { label, percent: Math.round(percent * 100) / 100, resetsAt: resetTime(reset) });
  };
  let rejected = false;
  for (const line of output.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'control_response' && event.response?.subtype === 'success') {
      const reply = event.response.response;
      if (event.response.request_id === 'account' && typeof reply?.account?.email === 'string') check.account = reply.account.email;
      if (event.response.request_id === 'usage') {
        const limits = reply?.rate_limits;
        for (const [key, label] of Object.entries(labels)) add(label, limits?.[key]?.utilization, limits?.[key]?.resets_at);
        if (Array.isArray(limits?.model_scoped)) for (const bucket of limits.model_scoped) {
          if (typeof bucket?.display_name === 'string') add('Weekly limit · ' + bucket.display_name, bucket.utilization, bucket.resets_at);
        }
      }
    }
    if (event?.type === 'rate_limit_event' && event.rate_limit_info) {
      const info = event.rate_limit_info;
      rejected = info.status === 'rejected';
      check.resetsAt = rejected ? resetTime(info.resetsAt) : null;
      for (const [key, label] of Object.entries(labels)) {
        const bucket = info.unifiedWindows?.[key] ?? (info.rateLimitType === key ? info : null);
        if (typeof bucket?.utilization === 'number') add(label, bucket.utilization * 100, bucket.resetsAt);
      }
    }
    if (event?.type === 'assistant' && event.error === 'rate_limit') rejected = true;
    if (event?.type === 'result' && exitCode === 0 && event.is_error === false) check.status = 'available';
  }
  check.windows = [...windows.values()];
  if (check.status !== 'available') {
    const full = check.windows.filter(w => w.percent >= 100 && (w.label === labels.five_hour || w.label === labels.seven_day));
    if (rejected || full.length) {
      check.status = 'limited';
      check.resetsAt ??= full.flatMap(w => w.resetsAt ? [w.resetsAt] : []).sort().at(-1) ?? null;
    }
  }
  return check;
}
