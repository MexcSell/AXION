# Lessons

One line per cycle: what it taught and whether PROCESS.md changed.

- C1 (A1): a new writer of shared state makes old read-then-lock paths race. Whenever a feature adds a writer, list the existing writers of the same table and give them all one lock-then-read path. PROCESS step 4 now asks for this.
