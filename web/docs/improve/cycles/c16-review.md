# Cycle 16 review (independent)

Spec: PASS. Quality: PASS with minor notes. No Critical, no Important findings.

## 1. Modal (web/src/components/ui/Modal.tsx)
- FOCUSABLE (line 9) now ends `[tabindex]:not([tabindex="-1"]):not([disabled])`. `[disabled]` is an attribute match, so it only drops native-disabled elements (the motion/Tip buttons carrying tabindex=0). `aria-disabled` is not handled; it is not needed (aria-disabled controls should stay focusable). A Tip wrapper span with tabindex=0 around a disabled button stays focusable, which is the intended pattern.
- Autofocus (line 34): `[data-autofocus]:not([disabled])`, then first body focusable, then the dialog element itself. If the only body control is disabled, focus lands on the dialog (tabIndex=-1) and the header Close button stays in the trap list (querySelectorAll runs on the whole dialog, line 58), so `items` is never empty in practice; there is no regression. Small caveat: a data-autofocus control that becomes enabled after mount (30 ms timer) is not refocused; was equally true before.
- Nested popovers/help: onKeyDown (55-62) and onEsc (40-46) are untouched, so the Radix/role=dialog/menu layering logic is unchanged. Focus restore (line 49) unchanged and asserted by the script for all 53 dialogs. The script does not cover the "help popover inside dialog" flow; that is covered only by the existing u1/Stage 1 flows (verify-all green per report).
- The trap check in the script only asserts focus stays inside, not that Tab wraps first<->last. Acceptable.

## 2. Form Field (web/src/components/ui/Form.tsx:8-14)
- Skips when `htmlFor` is set, or the control has an id, aria-label or aria-labelledby, so no double labelling of already-labelled controls. The label span id is used only through aria-labelledby, so the HelpTrigger inside the label is not folded into the name. Only the first matching control is named; a second control in one Field (e.g. slider plus number) stays as before. Effect runs every render with no deps (cheap querySelector; React does not strip the attribute), fine.
- Minor: a control with an id whose label is not wired (id but no htmlFor) is skipped and stays unnamed. The checker would catch it, and it found none.
- Checkbox/radio excluded on purpose (they normally carry their own label text).

## 3. Reclassification honesty
- 15 LIVE: "Running"/"Working" chips are status text, not busy indicators; requiring a trailing ellipsis is correct (script line ~96). 21+2 NOTAB: disabled and remounted nodes are not tabbable, so those are legitimate checker fixes. I accept both.
- Residual gap (Minor): the busy-text check only sees text present at the moment of audit and only leaf nodes. Real api-mode loading messages such as "Loading instances…" (Agents.tsx:278, AgentProfile.tsx:198/483), "Loading proposals…" (ServerProposals.tsx:147) and "Loading results…" (JobSearch.tsx:173) sit in plain divs with no role=status; they are transient so the run reported 0. Not hidden by the reclassification, but "0 live-region violations" is weaker than it reads. Suggest a backlog item.

## 4. No visual change
- Only Form.tsx and Modal.tsx under components/ui changed (13 insertions, 5 deletions). The label text is wrapped in an inline span inside a flex label (base.css:272), where the text was already a flex item, so layout is the same. Screenshot diff in the report (251 / 1 / 0 pixels of 1.57 M) is consistent with animation only. The stat for src/theme in a diff against main reflects main's drift, not this cycle (the c16 commit touches no CSS).

## 5. Script
- web/scripts/a11y-check.mjs: header comment documents demo and api invocations, A11Y_FAST, exit code 1 on violations. Uses the existing _session.mjs helpers and Playwright. Not wired into package.json or verify-all (140 s, justified; documented in the report). It requires the `axion.testhook` localStorage flag set by the script itself.
- Minor: hard-coded chrome path default (overridable with PW_CHROME); the dialog bag is generic, so some dialogs may render a "not found" variant (declared in the report). No api-mode "before" baseline (declared). I did not run the script (read-only review, no servers).
