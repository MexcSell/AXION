# c94 brief: execution profile validator, deny by default (R6-1, first slice)

**Lane:** w92 (`/home/luca/AXION-w92`, branch `c94-exec-profile`), from improve-30h at the commit that adds this brief. Ports 14290–14293. E2E DB **axion_e2e17** (reused; edit the lane `server/.env` after `new-lane.sh`). **A pure server module plus contracts types and tests. No route, no migration, no `web/` change, no network access, no sandbox, no model calls.**

**Sources:**
- `phase2/research-r6.md` §R6-1 and `phase2/research-r6-verified.md` §R6-1. The verifier's required changes are binding:
  - the validator **decides** requests against a profile but **enforces nothing**, so say so in the header and the report;
  - reuse `normaliseOrigin` / `originOfUrl` from the site-grants code (c36, c56) and add **one** function for a full URL against a granted origin (scheme, host, port, each redirect hop). Don't write a second parser;
  - **no approval-digest binding** in this slice; that needs a digest version change and is a later item;
  - cite E1 only "by analogy" for IP-encoding and redirect checks;
  - about 25 of the cases already exist in `hostile-origins.json`: reuse them, don't duplicate them.
- Read the site-grants code and its fixtures, and the c37 browser action contract.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. No network access from tests: the module must not resolve DNS.

## Items (each RED first, then GREEN, each its own commit)
1. **Schema.** `shared/contracts/src/exec-profile.ts` defines a versioned execution profile:
   - filesystem: writable paths, read-only paths, forbidden credential-file patterns;
   - network: default deny, allowed origins (granted), blocked ranges;
   - resource limits: memory, CPU, pids, wall time;
   - a required isolation tier: process, container or microvm;
   - a task-class "untrusted content" flag.
   It also exports the canonical sha256 of a profile.
2. **Profile validator.** Refuse unsafe profiles:
   - a permissive default;
   - a wildcard origin;
   - a missing resource limit;
   - a missing tier;
   - an untrusted class choosing the weakest tier.
   Threshold (b): 100% of 15 or more fixtures refused. Give each refusal a reason code.
3. **Request decider.** For a list of requested URLs (with redirect chains) and file paths, return allow or deny with a reason per item. Deny:
   - encoded private, loopback, link-local and metadata addresses (octal, hex, decimal, IPv4-mapped IPv6);
   - a redirect hop to a non-granted or internal host;
   - credential-file paths (`.env`, cloud credential files, SSH keys …);
   - path traversal, and paths outside the writable or read-only scope;
   - hostnames differing from the granted origin by case-folding tricks or port.
   Threshold (a): 100% of the must-deny fixtures denied and 100% of the explicitly granted allowed, over 60 or more cases. Reuse the existing hostile-origins cases and add the rest.
4. **Fail closed.** Unknown fields, unparsable URLs and anything unexpected give deny, never allow.

## Pass threshold
- Items 1–4 RED → GREEN.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: the new module(s), contracts, tests and the report; no route, no migration, no web/src.

## Report
`cycles/c94-report.md`, in plain words: "this decides, it does not enforce; enforcement needs a sandbox and proxy (next phase, owner point O1)". **Deadline:** hand back by about 14:30Z.
