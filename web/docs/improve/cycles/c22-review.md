# Cycle 22 review (long conversation threads load fast), branch c22-long-thread-perf

Reviewed: worktree /home/luca/AXION-w20 at 917d412 (app code at 15ef55c), diff f169636..917d412, brief, report, PROCESS.md safety rules. Read only; nothing was run.

**Spec verdict: PASS.** The 2a thresholds are met and stated with load. 2b is green apart from one known pre-existing flake. 2c long tasks are listed before and after. 3: covered by api-stage6, api-improve and verify-all.

**Quality verdict: PASS with one Important fix** (minimap row observation, a one-line change). There are no Critical findings. The batching core is correct.

## 1. Correctness of batching (web/src/api/missionControl.ts)

**Reducers are unchanged.** The messageCreated and receipt bodies inside `flushMissionControlEvents` (:308-348; `known`/`base`/`early`/`mine` at :328-332, receipt at :335-342) match the removed per-event code line for line. Each queued event reads the `byMission` produced by the previous one (`entry = byMission[mid]` and the `thread()` helper re-read per event). Order within a batch is arrival order, so:
- receipt-before-message and receipt-after-message behave exactly as before;
- an unknown id is still a no-op;
- the `mine` and `earlyReceipts` paths are unchanged.

**Every other writer flushes first.** `patchEntry` (:52) calls `flushMissionControlEvents()` and then `setState`, with `f` reading the post-flush state. Every other writer goes through `patchEntry`/`patchThread`:
- fetchPart :116/:119/:122/:129, retryPart :148;
- openThread :204/:208/:220, loadOlder :229/:232/:234, rereadThread :247;
- taskAction :356, settle :372, sendMissionMessage :411/:422.

The consequences:
- **openThread:** events queued during the page load are applied with `loading: true` (into `early`) before the merge.
- **Gap reset:** queued events are applied before the reset, which is the same order as before.
- **settle:** a queued event copy of my own post is applied while the local message is still pending, so it is held in `mine`. settle then finds it.

**Readers that look at state before flushing** (openThread :199, loadOlder :227, sendMissionMessage `findThread`/`th.messages`, refreshLoadedMissionControl) check only `messages`/`loading`/`hasMore`/`nextBefore`/thread existence. Conversation events never change these, so the reads are not stale.

**forget and clearMissionControl drop the queue.** `forget` (:179) calls `dropQueued(mid)`. `clearMissionControl` (:185) calls `dropQueued()`, which empties the queue and clears the timer (:302-305). On sign-out or user change, `useServerSync` cleanup (events.ts:146) runs `stop()` (EventSource closed) before `clearMissionControl()`, and `setMcUser` runs after that. So no batch from an old session can be applied to a new one, and `meId` at flush equals `meId` at arrival. Queue entries need no generation of their own. A late event for a forgotten mission falls into `refresh` (no-op, because `requested` was cleared) or is skipped by `thread()`, as before.

**Timer:** a module-level `setTimeout(60)` (:293), cleared on flush and on drop. It is not tied to a component, so there is no unmount leak. Choosing `setTimeout` over rAF is right: a hidden tab still updates, with background throttling of about 1 s.

**No re-entrancy.** The flush writes with `useMC.setState` directly, not `patchEntry`, and there is no `useMC.subscribe` listener that writes back.

**One benign difference.** The old receipt path went through `patchEntry`, which wrote `byMission[mid] = {}` for a mission not in the store. The batched path writes nothing for it. This is harmless, and arguably better.

**Fast path in `upsert` (:73-76)** is equivalent to the full path whenever `list` is ascending by `bySeq` with pending messages last. That holds for every stored list: each list is built by `upsert`, or by appending a pending local message (:422), or by filtering one (settle). In the fast-path case the new id is absent, so the full path would `set` the same object and the stable sort would put it last. The callers:
- **Live flush :333:** fast path.
- **settle :376/:379:** fast path only when no pending message is at the tail.
- **openThread `upsert(page, newer)`:** the page is reversed to ascending.
- **rereadThread:** in the gap branch the incoming messages are pending and have no `seq`, so the fast path is skipped. The normal branch passes the whole page.
- **loadOlder:** a single older message has `seq < tail`, so the fast path is skipped.

**No lost or duplicated messages:** the same dedupe by id and the same `known`/`count` logic apply.

## 2. Memoisation
- **`ChatBubble` (ChatView.tsx:52)** depends on its props plus `useAuth` accounts and, now, `useAgentsCatalog()` (:35). That covers renames and avatars.
  - `applyAgentCatalog` mutates `AGENT_BY_ID` in place only from `loadAgents` (api/agents.ts:41). Its version bump follows at :43, and there are no in-place agent edits in demo mode.
  - There is no theme hook in the bubble, RobotAvatar or UserAvatar; theming is CSS.
  - The store never mutates messages: demo `patchMessage` (store/data.ts:102) and chat `patch` (store/chat.ts:69) copy them, and receipts copy only the matching message.
  - The keys are complete.
- **`Block` in ThreadMinimap.tsx:197** takes only primitives, so its key is complete. `i` changes on prepend and re-renders, which is correct.
- **Formatters (format.ts:16-17)** give the same output as `toLocale*String([], …)`. The app has no locale or time-zone setting; the only `toLocale*` uses elsewhere are unrelated. The one difference is that a time-zone change at runtime is not picked up until reload (**Nit**).

## 3. Demo mode, scroll, draft
Demo mode never calls `onMissionControlEvent`, so batching is inert there. verify-all on 15ef55c finished with no FAIL lines, and the earlier Hierarchy FAIL also failed on the base (1 of 3), which is the same fixed-500 ms wait. The draft, pinned-bottom and paging-anchor checks pass (api-c22 and api-stage6).

### Important
**I1. The minimap no longer observes rows that change at constant length** (ThreadMinimap.tsx:81-85).
- The "observe new rows" effect is keyed on `deps` = `` `${shown.length}:${view}:${!!typing}` `` (ChatView.tsx:281). The old effect depended on `measure`, which changes with `msgs`, so every row was observed after every change.
- Rows now go unobserved in three cases:
  - **(a) settle** swaps `local-N` for the server message. The key changes, giving a new DOM node at the same length. This is the api-mode send, and with an image attachment the `<img>` loads afterwards.
  - **(b) Switching agents in the Conversations tab** between two threads that both show 50 rows. `<Messenger>` is not keyed (pages/Missions.tsx:192), so the same ChatThreadView and scroller are reused.
  - **(c) A gap reset** that replaces 50 rows with 50 others.
- In each case a later size change of those rows (image load, font swap) no longer re-measures the minimap. Its blocks then drift until the next message, which contradicts "minimap behaves as before". No check covers it.
- The detached rows from (b) also stay observed, and so retained, until unmount (**Minor**).
- **Fix:** key that effect on `msgs` (or `measure`). The WeakSet makes repeat passes cheap, and the observer is still never rebuilt. Optionally `unobserve` rows that are no longer in the DOM.

### Minor
- **M1. The "N new" counter can over-count when a flush and an older page land in one commit.**
  - `loadOlder`'s `patchThread` flushes and then prepends in the same synchronous block, so React 19 renders both store writes together. `messages.length` grows by k + 50 and `lastId` changes.
  - `setNewCount(n + (messages.length - prevLen))` (ChatView.tsx:219) then adds the 50 prepended rows. It needs a message queued in the 60 ms before the older page answers.
  - The effect is a cosmetic counter only. **Fix:** count the messages after `prevLast`'s index.
- **M2. Neighbouring rows lose some layout animation** (`presenceAffectsLayout={false}` and the memo). This touches the owner's "animated UI" rule. It is disclosed in the report and acceptable for the gain, but it should be recorded in LESSONS or LOG.
- **M3. No unit test of the flush or the fast path, and no live-burst assertion.** Nothing checks, on the live page before reload, that all N burst messages appear once and in order. The batched path rests on code reading plus api-stage6: live receipts at :112, the held own-message, and the gap test at :265-303. **Suggestion:** add a vitest for `upsert` fast-path equivalence and for flush ordering (receipt before and after its message, early/mine), or a live-burst check in api-c22.

## 4. Measurement and threshold honesty
**The method is sound for the stated threshold.**
- POST bursts go to the open thread, then reload → commit → interactive, where interactive means the composer takes focus and the newest text is inside the thread viewport (api-c22.mjs:71-93).
- There are 3 timed reps plus 1 traced rep that is not counted, and load is recorded per rep.
- After a reload only the newest page (50) mounts. So the "1,000" figure measures the old page's backlog drain plus the cold load, not rendering 1,000 rows. That matches the brief's wording and the api-stage6 stall.

**The numbers are honest.**
- **N=130:** 1.9 / 2.2 / 2.3 s at load 22–24 on 5d5c8ce, and 1.6–1.8 s at load 14–15 on the final HEAD. The 0.7 s margin over an idle floor of about 2 s is disclosed.
- **N=1,000:** 2.4–2.8 s, against more than 120 s three times before.
- **Long tasks** are listed before and after.

**The residual live freeze at 1,000 is disclosed.** There are 11.5 s of long tasks during the burst, and each 60 ms batch costs 0.4–1.6 s. It belongs in the QUEUE as a follow-up (adaptive flush, or windowing coordinated with lane w6), not as a spec failure.

**2b:** the one red api-stage6 run (92/94, "the server created the next version" / "Versions lists v(n+1)") is the same flake recorded in c01-report.md:319-323, in the designer-01 Edit dialog, with no thread code involved. "PASS, with one red run" is fair. Integration still needs a green run.

## 5. api-c22.mjs
The checks assert real DOM behaviour:
- scrollHeight pins to the bottom;
- the `.mm-block` count equals the `[data-mid]` count;
- the draft value survives a reload;
- the anchor shift is ≤ 4 px with unique ids.

They run only on rep 1, after the idle reload.

**Minor M4:** the script never exits non-zero on a FAIL check or a page error, and it does not compare against the 3 s / 5 s thresholds. It is an on-demand tool and not in api-e2e.sh's default list, so this is acceptable. Still, it should follow the c21 convention: `process.exitCode = 1` on any FAIL or page error, with optional threshold flags.

## Safety rules
- api-stage6.mjs is untouched, and no assertion or timeout was loosened.
- No migrations, auth, visibility or audit code was changed. The numbers are measured.
