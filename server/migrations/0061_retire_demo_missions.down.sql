-- The migration ledger uses the same transaction timestamp as the retirement update.
update missions set deleted_at = null
where demo and deleted_at = (select applied_at from schema_migrations where version = 61);
