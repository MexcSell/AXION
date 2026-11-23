// c94: a known-good execution profile used by the c94 tests. Each test clones it and breaks one thing.
import type { ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';

export const goodProfile = (): ExecProfile => ({
  version: 1,
  name: 'research-browse',
  taskClass: 'web-research',
  untrustedContent: true,
  tier: 'container',
  filesystem: {
    writablePaths: ['/work/out'],
    readOnlyPaths: ['/work/in', '/usr/share/data'],
    forbiddenPatterns: ['**/.env', '**/.aws/credentials', '**/.ssh/**'],
  },
  network: {
    default: 'deny',
    allowedOrigins: ['https://good.com', 'https://api.example.org:8443'],
    blockedRanges: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '0.0.0.0/8', '::1/128', 'fe80::/10', 'fc00::/7'],
  },
  limits: { memoryMb: 512, cpuMillis: 1000, pids: 128, wallTimeSec: 600 },
});
