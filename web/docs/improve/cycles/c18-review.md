# c18 review (Agent Profile one-screen fit)

Spec verdict: PASS. Quality verdict: PASS with minor notes. No Critical or Important findings.

## (1) Shared Tabs change
- Tabs.tsx:44 adds aria-label only when `collapse` is set. Non-collapse tabs are unchanged (undefined attribute).
- Collapse users: Missions.tsx:163 and AgentProfile.tsx:136 only (grep of every `<Tabs`). Missions count: unselected tab shows a dot (base.css:424), so "Approvals (N)" as accessible name is an improvement. No other page's look changes.
- aria-label replaces content-derived name, so no duplicate name. In wide mode label equals visible text (label-in-name OK). Tooltip title still only on unselected collapsed tabs (Tabs.tsx:42). Playwright name matches are substring by default; no exact tab-name matches found in scripts. c16-accessibility branch exists; did not diff it, so a merge conflict on Tabs.tsx line ~44 is possible but trivial.

## (2) CSS scope
- overview-org-agent.css:320-325 all prefixed `.oa-tabbar` (used only at AgentProfile.tsx:135). Container query is 1180px on the strip, not the viewport. At 1672 the strip is about 1400px wide (screenshot), so labels show and rules are inert there.
- Hero block (css:290-299) is `min-width:1280 and max-height:860`; 1672x941 is excluded by height. Selectors `.oa-hero-*` only used in AgentProfile.tsx. It sits after the max-width:1300 rule (css:197) so the override wins at 1280-1300.
- Note (minor): a viewport of 1440x900 gives a strip near 1160px, so it also gets icon-first; before it likely clipped anyway. Any desktop with height <=860 gets the compact hero, same scope as the pre-existing zoom rule.

## (3) Reachability
- Roving focus/arrow/Home/End logic untouched (Tabs.tsx:13-19). Every tab is a button with aria-label; unselected ones have a title tooltip; selected shows its label. api-improve clicks tabs by role and name (83/83 reported).
- Development stage chip visible in hero at 1366 and 1280 (screenshots).

## (4) Screenshots
- 1366 and 1280: hero in 3 columns, ten tabs on one row, content cards end inside the viewport (1280 cards touch the bottom edge about 748/760, acceptable). 1672: labelled tabs, layout as before.
- Gap (minor): no "before" 1672 image, so "unchanged" rests on the CSS reading above, which I confirmed.

## Minor
- Hidden tab text at narrow widths relies on tooltip; touch users get no tooltip (aria-label covers AT). Acceptable, matches Missions.
- Baseline failures (api-stage6 reload, flows focus-trap flake) are outside this diff; not verified by me.
