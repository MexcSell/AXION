import { describe, it, expect } from 'vitest';
import { createListener } from '../src/events/stream.ts';

describe('C1 LISTEN reconnect', () => {
  it('a refused database gets one retry at a time, not an exponential storm', async () => {
    const l = createListener('postgres://x:y@127.0.0.1:9/none', { retryMs: 50, onWake: () => {} });
    await new Promise((r) => setTimeout(r, 1000));
    const n = l.attempts();
    await l.close();
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThanOrEqual(22); // ≈ 1000 ms / 50 ms, one chain only
  });
});
