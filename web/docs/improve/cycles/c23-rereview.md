# Cycle 23 fix-round re-review (diff only, nothing run)

- I1 ADDRESSED: org-proposals.tsx dry run now role=status (:117 area), chips wrapped in role=status (org-proposals.tsx:87, agent-versions.tsx:95); a11y-check.mjs busy/loading scans add `[aria-modal=true] *`. Threshold 2 relabelled "OVERCLAIMED in the first round" in c23-report.md.
- I2 ADDRESSED: a11y-check.mjs probes are now {v, slow, fail} with a LIVEPROBE push to `all` when no matching text sits in [role=status] (slow) or [role=alert] (fail); a deleted region fails. Three mission pages added (hierarchy, task-flow, conversations). Caveat: the `none` escape hatch is supported but unused; slow regexes `/loading/i` are loose.
- Minor ChatView nesting ADDRESSED: ChatView.tsx twin `div.sr-only role=status|alert` is a sibling before .thread-body, outside the role=log. Twin and the aria-hidden share the condition (emptyState && shown.length===0), so the visible block is never hidden without a twin. Props are passed by ChannelChat and Messenger.
- KpiTile ADDRESSED: role comes from new `live` prop (PageFrame.tsx); only the two api-mode tiles in CommandCenter set it, demo tiles unchanged.
- PageSkeleton ADDRESSED: AppShell.tsx:157 has `<span className="sr-only">Loading…</span>`. sr-only (theme/base.css:33) is clip/absolute 1px, not display:none; no visual change.
- CommandCenter ADDRESSED: CommandCenter.tsx scorecard renders `LiveStatus key="err"` or `key="load"` per state, so the role is never flipped on a mounted node.

New breakage:
- Important: ChatView.tsx visible empty block gets aria-hidden=true when emptyState is set, but it contains the error detail and the Retry button (emptyText). The sr-only twin only speaks emptyTitle. Screen readers lose the error message and Retry, and a focusable button sits inside aria-hidden (aria-hidden-focus). Fix: put emptyText in the twin, or aria-hidden only on the icon/"One moment." filler and keep the error block exposed.
- Minor: the dialog scan only covers [aria-modal=true]; if a dialog lacks aria-modal it stays unscanned.
