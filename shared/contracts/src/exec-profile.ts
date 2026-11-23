/** Execution profile (c94, R6-1 first slice). A versioned record that says what a task class may touch: files, network, resources,
 *  and the isolation tier it must run in. It is deny by default.
 *
 *  THIS IS A RECORD SHAPE ONLY. A profile is checked by server/src/exec-profile (validator and request decider), which DECIDE
 *  but ENFORCE NOTHING: nothing here starts a sandbox, filters traffic or resolves DNS. Enforcement needs a sandbox and a proxy
 *  (next phase, owner point O1).
 *
 *  Not re-exported from index.ts on purpose: the hash uses node:crypto, and index.ts is imported by the web bundle. */
import { createHash } from 'node:crypto';

export const EXEC_PROFILE_VERSION = 1 as const;

/** Weakest first. A process sandbox shares the host kernel; a container shares it behind namespaces; a microVM has its own kernel. */
export const ISOLATION_TIERS = ['process', 'container', 'microvm'] as const;
export type IsolationTier = (typeof ISOLATION_TIERS)[number];
export const tierRank = (t: IsolationTier): number => ISOLATION_TIERS.indexOf(t);

export interface ExecProfileFilesystem {
  /** Absolute directories the task may write (and read). */
  writablePaths: string[];
  /** Absolute directories the task may read only. */
  readOnlyPaths: string[];
  /** Glob patterns (`**`, `*`, `?`) for credential files that are never readable or writable, whatever the scope says. */
  forbiddenPatterns: string[];
}
export interface ExecProfileNetwork {
  /** Always 'deny'. Anything else is a permissive default and is refused by the validator. */
  default: 'deny';
  /** Exact origins, already granted through site grants (normaliseOrigin form). No wildcards. */
  allowedOrigins: string[];
  /** CIDR ranges that are never reachable (private, loopback, link-local, metadata). */
  blockedRanges: string[];
}
export interface ExecProfileLimits { memoryMb: number; cpuMillis: number; pids: number; wallTimeSec: number }

export interface ExecProfile {
  version: typeof EXEC_PROFILE_VERSION;
  name: string;
  taskClass: string;
  /** True when the class reads content an attacker may have written (web pages, mail, uploaded files). */
  untrustedContent: boolean;
  tier: IsolationTier;
  filesystem: ExecProfileFilesystem;
  network: ExecProfileNetwork;
  limits: ExecProfileLimits;
}

/** Canonical JSON: keys sorted at every level (same rule as approvals digestOf and the browser action digest). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}

/** sha256 (hex) of the canonical JSON of a profile. Array order is part of the hash. Binding this hash into an approval digest is a later item. */
export function execProfileSha256(profile: ExecProfile): string {
  return createHash('sha256').update(canonicalJson(profile)).digest('hex');
}
