# Cycle 16 report (lane w14): accessibility, keyboard, focus and labels

## Result: PASS (0 violations after, in the checked scope)

## What was built
`web/scripts/a11y-check.mjs` (Playwright, no new deps). Scope: Overview (4 tabs), Missions (10 workspace tabs),
Agents (all 8 sub-tabs plus the cards and hierarchy views), Agent Profile (10 tabs, demo only), Notifications (5), Settings (11),
and all 53 registered dialogs opened through the test hook with a real focused opener.
Checks: accessible name on every visible button, link, input, select, textarea and ARIA control; icon-only controls named by
aria-label or title; img alt; no control taken out of the Tab order (tabindex=-1) outside composite widgets; a real Tab walk reaches
every tabbable control (every third view plus the dense ones: assignments, conversations, appearance); busy text ("Loading…",
"Saving…") inside an aria-live/status region; a live region exists on the page; per dialog: focus moves in, Tab and Shift+Tab stay
inside, Escape closes, focus returns to the opener.

Run: demo `BASE=http://127.0.0.1:<dev> node scripts/a11y-check.mjs` (exit 1 on any violation, `A11Y_FAST=1` skips the Tab walk);
api `E2E_API_PORT=.. E2E_WEB_PORT=.. ./scripts/api-e2e.sh "DATA_MODE=api node scripts/a11y-check.mjs"`.

## Before (RED), demo mode, current code
First honest run: 65 violations. After reviewing them, 38 were checker artefacts and were fixed in the script itself, not in the app:
- 21 NOTAB: the Tab walk cap was too low (a manual 150-press walk reaches every control) and it counted disabled buttons and
  React-remounted nodes. Fixed: cap by all focusable nodes, skip disabled, skip disconnected nodes.
- 15 LIVE: "Running" and "Working" status chips matched the busy-text pattern. Busy text now requires a trailing ellipsis.
- (the remaining 2 NOTAB were the disabled send buttons.)

Real app violations (27), all in dialogs:
- 23 NAME: inputs, textareas and range sliders inside `Field` wrappers with no programmatic label (agent-create, agent-edit,
  department-create, mentoring-session, mission-edit, mission-pause, model-add, model-playground, voice-settings,
  send-command, approval-decision, tools-permission).
- 2 TRAP + 2 ESC (mission-create, conversation-thread): disabled buttons carrying `tabindex="0"` (motion and Tip wrappers) matched the
  Modal focus selector, so the trap's "last element" was unfocusable; Tab left the dialog and Escape was lost.
- 2 FOCUS (merge-proposal, deploy-approval): `data-autofocus` was on a disabled button, so focus never moved in.

## Fixes (no visual change)
- `src/components/ui/Modal.tsx`: the focus selector excludes `[disabled]` for tabindex elements; autofocus skips disabled targets.
- `src/components/ui/Form.tsx`: `Field` gives its label text an id and names the first unnamed input, textarea, select, combobox or
  slider inside it with `aria-labelledby` (an explicit htmlFor, id, aria-label or aria-labelledby is left alone). The label text is
  wrapped in a span; layout is unchanged.

## After (GREEN)
- demo: 50 views, 53 dialogs, 0 violations (the run before the last script tweak showed 3 NOTAB on disabled send buttons; the
  checker now skips disabled controls, see the verify run below).
- api: 40 views, 53 dialogs, 0 violations in 90 s. No api-mode "before" number was measured (the first measurement was demo).

## Screenshots
Before/after of 3 pages, `web/docs/screenshots/improve-c16-{missions,settings,agents}-{before,after}.png`. Pixel diff (threshold 24):
251, 1 and 0 of 1.57 M pixels, i.e. only live animation.

## verify-all
Not added: the demo run takes about 140 s (over the 60 s budget) and the gate queue makes it longer. Documented above how to run it.
Suite result: verify-all on the lane dev server is green (build, crawl 77 views, deep crawl, 21 flows, auth flow, u1 flows, dialog smoke 106/106, dialog ids, help keys, fs guard). No server code changed, so server tests were not rerun.

## Concerns
- Dialogs are opened through the test hook with a generic props bag, not by clicking each real trigger, so dialogs that need
  specific data may render their "not found" variant in some cases (still checked for focus and Escape).
- The checker does not verify contrast, or that live regions announce the right wording.
- Disabled buttons that still carry `tabindex="0"` remain in the markup (harmless now); not changed.
