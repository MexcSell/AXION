# Lessons

One line per cycle: what it taught and whether PROCESS.md changed.

- C1 (A1): a new writer of shared state makes old read-then-lock paths race. Whenever a feature adds a writer, list the existing writers of the same table and give them all one lock-then-read path. PROCESS step 4 now asks for this.
- C2 (B1): the live API runs from the working tree, so restart it only when the tree is clean (between cycles), never while another implementer has uncommitted work. Process step 11 updated.
- C3 (C1): until agents execute, real missions never produce finished tasks, so measurement features can be proven only in server tests. They add little visible value now. Favour governance flows people can use today (structure changes, version proposals) and code health. Measurement is limited to the scaffolding already built. Backlog order changed.
- Lanes (parallel worktrees): symlinked node_modules sit outside Vite's fs.allow, so fonts return 403 in a lane's dev server and .gitignore's 'node_modules/' misses symlinks. Lane setup needs a Vite fs.allow override that is never committed, plus 'node_modules' without the slash in .gitignore (done). The same api-stage6 agent-edit check flaked in c01, c02 and c04, so H4 should go next.
- Lanes: 'git stash' is shared by every worktree of a repo. A lane's 'stash pop' applied another lane's stash (w3 and w5, undone by w3). Rule: lanes never use git stash; LANES.md updated.
- c07: lanes must never load pages from live ports, even read-only, and heavy host load (14 lanes) makes page.reload timeouts look like regressions. Verify on the integration tree at merge time and keep the 3-slot gate for every lane (w2–w5 started before it existed).
