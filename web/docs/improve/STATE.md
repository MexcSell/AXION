# Improvement loop state (resume from here)

- Start: 2026-11-21T11:36:18Z · End: 2026-11-22T17:36:18Z (30 h) · Last start allowed: 2026-11-22T16:06:18Z
- Branch: `improve-30h` (from `main` = `release_1.0.0` = b621fbb). Never push or move the tag without the owner.
- Live: web dev 127.0.0.1:5190 (serves the working tree), API 127.0.0.1:5191 (real `axion` DB, Stage 6 code, migrations 1–12, restarted 2026-11-21 ~11:05Z; logs server/data/api.log). Nobody signed in yet.
- Migrations 0001–0012 frozen; 0013 = org_proposals (cycle 1); next new migration 0014.
- Process: PROCESS.md. Controller: session axion-53. Subagents: implementer (sonnet/opus) + independent reviewer per cycle, max 1 fix round.

## Current (parallel lanes since 15:55Z; owner: "use all resources, process multiple cycles at the same time")
- Main tree /home/luca/AXION [improve-30h]: cycles 1–3 done + live (46c1c45). Next: merge lanes as they pass review.
- Lane w2 /home/luca/AXION-w2 [c04-org-history]: cycle 4 A2+A3 · e2e 5292/5293 · axion_e2e2 · dev 5290 · migration 0014.
- Lane w3 /home/luca/AXION-w3 [c05-version-proposals]: cycle 5 C2 · e2e 5392/5393 · axion_e2e3 · dev 5390 · migration 0015.
- Lane w4 /home/luca/AXION-w4 [c06-department-facts]: cycle 6 B3 · e2e 5492/5493 · axion_e2e4 · dev 5490 · migration 0016.
- Lane .env files point DATABASE_URL at axion_lane_disabled (no real-DB access). Lanes branch from f7c7bca.
- Lane w5 /home/luca/AXION-w5 [c07-bundle-split]: cycle 7 H2 bundle split · e2e 5592/5593 · axion_e2e5 · dev 5590/preview 5591 · branched from e1ea9bf.
- Owner 16:30Z: "add 10 more workers; if there is no work, find a new way to update" → lanes w6–w15 (branched from 2ed66e9), rules in LANES.md, heavy runs gated by /home/luca/AXION-lanes/heavy.sh (3 slots; shared Postgres max_connections=100):
  w6 c08 flaky checks · w7 c09 server minors · w8 c10 DB indexes + scale (0017) · w9 c11 staffing follows org (0019) · w10 c12 throughput trend (0020) · w11 c13 experiment verdict (0021) · w12 c14 security hardening (0022) · w13 c15 contract tests · w14 c16 accessibility · w15 c17 owner guide.
- Integration: review each lane, then merge into improve-30h (controller), full suite on the merged tree, then live restart.
- Live API 5191: cycles 1–3 (46c1c45), migration 13, restarted 16:10Z.
