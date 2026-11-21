# Cycle 17 — Lane w15 · owner guide: what's new, in the app

## Hypothesis
The owner will come back to many new features: real sign-in, missions on the server, agents, versions, proposals,
history and rollback, scorecard, reliability and channels. The only explanation is in long markdown files. The app's
Help Center (`/help`) and the `?` system are where the owner looks.

Add an in-app **"What's new"** guide in the Help Center. It holds a short, plain-language page per feature: what it
does, where to find it, what is real and what is still DEMO, and a link that deep-links into the feature. Also add light
-mode screenshots for Stage 6 and the improvement-loop features to `web/docs/screenshots/`, since the Stage 6 report
noted they were missing.

## Scope
- Content lives in the existing help registry format (`web/src/help/**`) and the Help page.
- Write in plain language for a non-technical owner. Be honest about DEMO and NOT MET items. Don't promise features that
  don't exist.
- Cover:
  - Stage 5: sign-in, approvals and missions on the server;
  - Stage 6: agents and versions, mission instances, conversations, direct channels;
  - the improvement loop: org proposals, history and rollback; the company scorecard; agent reliability; and,
    clearly marked "coming when merged", version proposals and department facts.
- Screenshots: light-mode versions of the Stage 6 and loop screens, taken with api-mode browser runs on your lane ports
  (reuse the existing screenshot steps, or a new `web/scripts/api-c17-shots.mjs`).

## Measure and pass threshold (fixed now)
- `check-help` is green.
- Every guide page has a working deep link, tested by a browser check that opens each one and lands on the right
  page/tab.
- verify-all is green.
- The Help page still fits one screen.

## Lane
You are lane w15: worktree `/home/luca/AXION-w15`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w15.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
