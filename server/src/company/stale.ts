/**
 * THE freshness rule of a task review (c51), in its two SQL forms. THEY MUST CHANGE TOGETHER: edit one and you edit the other, and run
 * test/c71-stale-truth.test.ts (a truth table over every branch, both forms against the rule written out in JS).
 *
 * The rule: a review is STALE (before attempt N) when the task has a later attempt than the one the review was written against, or when the latest
 * attempt started (database time) after the review was created. Evaluated in SQL so only the database clock is compared. `r` is the alias of task_reviews.
 *
 *  1. STALE_BEFORE_SQL: per row, a correlated sub-select (null when fresh). For one task's reviews (GET /tasks/:id/reviews) and any per-row reader.
 *  2. STALE_JOINS + STALE_FLAG: batch, one lateral join on the task's latest attempt. For readers of many reviews (scorecard, dimensions). The aliases `la`
 *     and `ra` are fixed: a caller must not already use them.
 */
export const STALE_BEFORE_SQL = (r = 'r') => `(select la.attempt_no from task_attempts la where la.task_id = ${r}.task_id
    and la.attempt_no = (select max(x.attempt_no) from task_attempts x where x.task_id = ${r}.task_id)
    and (coalesce((select ra.attempt_no from task_attempts ra where ra.id = ${r}.attempt_id), 0) < la.attempt_no or (la.started_at is not null and ${r}.created_at < la.started_at)))`;

/* c71 (P6), the batch form below: STALE_BEFORE_SQL runs three correlated sub-selects per review row (about 9 index probes each: 140 ms of a 330 ms dimensions read at 16,000 reviews); this takes the task's latest attempt once. */
export const STALE_JOINS = (r = 'r') => `left join lateral (select x.attempt_no, x.started_at from task_attempts x where x.task_id = ${r}.task_id order by x.attempt_no desc limit 1) la on true
                  left join task_attempts ra on ra.id = ${r}.attempt_id`;
export const STALE_FLAG = (r = 'r') => `(la.attempt_no is not null and (coalesce(ra.attempt_no, 0) < la.attempt_no or (la.started_at is not null and ${r}.created_at < la.started_at)))`;
