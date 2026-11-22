# Cycle 28 review (independent, read-only; nothing was run)

Spec verdict: PASS. Quality verdict: PASS with one Important finding and four Minor ones.

## Palette (CommandPalette.tsx)
- On-open reset removed (L51-53); `reset` runs only from `AnimatePresence onExitComplete` (L156). First mount has q='' by initial state, so a first keystroke is never wiped. The focus timer is now cleaned up. Arrow keys and Escape (L142-151) are untouched.
- Enter (L145-150): with q non-empty and the help registry not loaded, it sets `pendingEnter` and calls `loadHelp()`. The `[helpReg]` effect (L138) runs `results[sel]` from the render that includes help, so it acts once, on the typed query. A second Enter while pending is ignored (no double action). With an empty q, or once loaded, it acts at once.
- Load failure: the catch (L148) runs the latest result and clears the flag. `loadHelp` caches the rejected promise (`pending ??=`, help/load.ts:15), so a later Enter also resolves through the catch. It is not stuck.
- Reopen shows an empty query, except within the 200 ms exit animation (declared by the implementer: `onExitComplete` does not fire when an exit is cancelled, so the old query is kept). Acceptable: rare, benign, and the old query stays visible and selectable. A cleaner variant would reset on the close transition.

### Important
- I1. `pendingEnter` is not cleared on close. Enter, then Escape or a click on a result, then the registry arrives: the effect (L138) runs `results[sel]` on a closed palette. That is a surprise action, or a double action after a click. The window is the lazy chunk load, normally after the idle preloader has already fetched it, so this is rare. Fix: clear `pendingEnter` in `reset` and in the Escape/backdrop handlers, or check `open` in the effect.

### Minor
- M1. Typing within the 20 ms focus timer (L53) goes to the body. This is unchanged from before; autoFocus would close it.
- M2. The pending-Enter effect (L138) and the catch path trust `sel` and `latest`. If the user presses arrows while pending, they get what they selected, which is fine.

## Test (item 2)
- `scripts/c28-palette-fast.mjs` types from a MutationObserver as soon as the input exists, then checks that the query survives, that Enter navigates, and that a reopen starts empty. It does exercise the first-open ordering. The 5/5 RED / 0/5 GREEN figures in the report are plausible, but I could not rerun them. I did not confirm independently that React processes the discrete input event before the passive effect flushes; trust the recorded RED.
- flows.mjs is unchanged (not in the diff), so no flows check was weakened. The 0/21 under load was honestly reported as a non-reproduction under load (0/20 before as well).
- a11y-check: the added probe holds only the revisions request (`holdRevisions`), other probes continue as before. Nothing weakened.

## Sign-out (item 3)
- `versions.cancel()` added (events.ts:142). This covers the debounce timer, the same as the other keyed refreshes. The check (c28-signout-refresh.mjs) has a control with the stream open (1) and a post-cleanup count (0), so it is sound.
- Minor M3: an HTTP request already in flight is not aborted by `cancel`. This is the same for every other refresh in the list, so it is out of scope. The tick only re-triggers hook reads.

## LiveStatus (item 4)
- OrgHistory:158 and Mentoring:143, 166 use `LiveStatus` with the same className and style. It renders a div with role=status and adds no visual styling. Behaviour is identical for sighted users.

## Other changes (item 5)
- The only additions are `versionProposalsTick()` (a read-only export) and scripts. Nothing else changed behaviour.
- Minor M4: the report notes that two other flows steps flake under load (hierarchy click, archive trash icon); they need their own cycle.
