-- Retire sample missions through the same visibility boundary as a deleted mission.
-- Keep their revision, conversation and audit history for rollback.
update missions set deleted_at = now() where demo and deleted_at is null;
