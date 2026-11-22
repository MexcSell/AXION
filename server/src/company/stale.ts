/**
 * c71 (P6): the c51 freshness rule of a task review (STALE_BEFORE_SQL in tasks/reviews.ts: a later attempt exists than the one the review was
 * written against, or the latest attempt started after the review) as a JOIN, for readers of many reviews at once. STALE_BEFORE_SQL runs three
 * correlated sub-selects per review row (about 9 index probes each: 140 ms of a 330 ms dimensions read at 16,000 reviews); this takes the
 * task's latest attempt once through a lateral join. Same truth table; test/c71-equivalence.test.ts compares the two review by review.
 * `r` is the alias of task_reviews. Use `STALE_JOINS(r)` in the FROM clause and `STALE_FLAG(r)` as a boolean expression.
 */
export const STALE_JOINS = (r = 'r') => `left join lateral (select x.attempt_no, x.started_at from task_attempts x where x.task_id = ${r}.task_id order by x.attempt_no desc limit 1) la on true
                  left join task_attempts ra on ra.id = ${r}.attempt_id`;
export const STALE_FLAG = (r = 'r') => `(la.attempt_no is not null and (coalesce(ra.attempt_no, 0) < la.attempt_no or (la.started_at is not null and ${r}.created_at < la.started_at)))`;
