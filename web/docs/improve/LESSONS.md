# Lessons

One line per cycle: what it taught and whether PROCESS.md changed.

- C1 (A1): a new writer of shared state makes old read-then-lock paths race. Whenever a feature adds a writer, list the existing writers of the same table and give them all one lock-then-read path. PROCESS step 4 now asks for this.
- C2 (B1): the live API runs from the working tree, so restart it only when the tree is clean (between cycles), never while another implementer has uncommitted work. Process step 11 updated.
- C3 (C1): until agents execute, real missions never produce finished tasks, so measurement features can be proven only in server tests. They add little visible value now. Favour governance flows people can use today (structure changes, version proposals) and code health. Measurement is limited to the scaffolding already built. Backlog order changed.
