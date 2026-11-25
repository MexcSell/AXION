import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CloudModelCheck } from '../../../shared/contracts/src/index.ts';

const snapshot = z.object({
  checkedAt: z.iso.datetime(),
  status: z.enum(['available', 'unavailable', 'limited', 'timeout']),
  resetsAt: z.iso.datetime().nullable(),
  account: z.string().nullable(),
  windows: z.array(z.object({ label: z.string(), percent: z.number().nonnegative(), resetsAt: z.iso.datetime().nullable() })),
});

/** A restart may reuse this result only for the same model and credential. */
export function checkCache(home: string, model: string, token: string) {
  const identity = createHash('sha256').update(model).update('\0').update(token).digest('hex');
  const path = join(home, 'provider-check.json');
  return {
    read(): CloudModelCheck | null {
      try {
        const stored = JSON.parse(readFileSync(path, 'utf8'));
        if (stored.identity !== identity) return null;
        return snapshot.parse(stored.check);
      } catch { return null; }
    },
    write(check: CloudModelCheck) {
      const temp = path + '.' + randomUUID();
      writeFileSync(temp, JSON.stringify({ identity, check }), { flag: 'wx', mode: 0o600 });
      renameSync(temp, path);
    },
  };
}
