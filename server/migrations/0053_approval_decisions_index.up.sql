-- c71 (P6): approval_decisions had no index on approval_id. GET /company/dimensions reads
-- `(select min(decided_at) from approval_decisions where approval_id = r.id)` once per approval request: a sequential scan of the
-- whole table per approval, quadratic (2.8 s of a 3.1 s read at 25,000 tasks in 8,333 missions). Also serves the join in GET /company/scorecard
-- and the approvals list. (approval_id, decided_at): the min() is answered from the index alone. Adds no column and changes no input of any metric.
create index if not exists approval_decisions_approval on approval_decisions (approval_id, decided_at);
