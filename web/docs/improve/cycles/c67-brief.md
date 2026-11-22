# c67 brief: Agent Profile fits one screen in api mode (H17)

**Lane:** w65 (`/home/luca/AXION-w65`, branch `c67-profile-fit`), from improve-30h at the commit that adds this brief. That commit includes merged batches 14–18. Ports 11590–11593. E2E DB **axion_e2e8** (reused). No migration. Web only.

**The problem:** the owner's rule is that every page fits one screen at 1366×768. In api mode, fit-check shows 10 BAD views, all `/agents/coder-01?tab=*`, each with `mainOver 48`. This was already true on base 07831cd. The c64 reviewer measured the cause:
- `main` is 688 px tall, and its content is 736 px;
- `.oa-hero` is 360 px and the tabbar is 54 px;
- `.fit-scroll` starts at 516 with a 300 px minimum, so it ends at 816 against a page bottom of 750.

Demo mode fits because its data is shorter.

## Items
1. **RED:** run api-mode fit-check at 1366×768 and record the 10 BAD lines, with their numbers.
2. **Fix it the polished way.** Don't just clip:
   - make the hero more compact at heights under about 800 px, for example a tighter stat grid or a collapsible secondary line;
   - and/or lower the profile's fit-scroll minimum, so long content scrolls inside the panel.

   Keep everything reachable, keep the owner's look (icons, `?` help, motion) and check both themes. No information may disappear. Anything moved behind a disclosure must be one click away and have a `?`.
3. **GREEN:**
   - api-mode fit-check is ALL FIT at 1366×768 and at 1280×760;
   - demo-mode fit-check is still ALL FIT;
   - verify-all is 10/10;
   - a11y is clean in both modes;
   - api-mobile shows no new FAIL.
4. **Add api-mode fit-check to the standard checks.** Document the exact command in your report, so the integrator can add it to QUEUE.md's standard checks. Don't edit QUEUE.md yourself.

## Report
`cycles/c67-report.md` in your worktree, with before and after screenshots of the profile at 1366×768 in both themes. Follow the LANES.md Finishing rule.
