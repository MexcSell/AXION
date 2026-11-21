-- Stage 6 task 3: durable conversations. Messages and receipts are append-only.
create table conversation_threads (
  id text primary key default ('th-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
  tenant_id text not null references tenants(id),
  scope text not null check (scope in ('mission','direct')),
  mission_id text references missions(id) on delete cascade,
  kind text not null check (kind in ('agent-agent','human-agent','gm','admin','agent-direct')),
  a text not null,                                       -- participant: instance id, agent id or 'human'
  b text not null,
  owner_user_id text references users(id),               -- direct channels only
  created_at timestamptz not null default now(),
  check (a < b collate "C"),
  check ((scope = 'mission') = (mission_id is not null))
);
create unique index conversation_threads_pair on conversation_threads (coalesce(mission_id, ''), coalesce(owner_user_id, ''), a, b);
create index conversation_threads_mission on conversation_threads (mission_id);

create table messages (
  id bigserial primary key,
  thread_id text not null references conversation_threads(id) on delete cascade,
  seq int not null,
  author_kind text not null check (author_kind in ('human','agent','system')),
  author_id text not null,                               -- user id, agent instance id, or 'system'
  recipient text not null default '',                    -- instance id, 'human', 'human:<id>' or ''
  kind text not null check (kind in ('delegation','report','consult','command','reply','question','ack','result','system')),
  body text not null check (char_length(body) <= 8000),
  task_id text,
  reply_to text,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (thread_id, seq)
);

create table message_receipts (
  id bigserial primary key,
  message_id bigint not null references messages(id) on delete cascade,
  state text not null check (state in ('queued','delivered','acknowledged')),
  at timestamptz not null default now()
);
create index message_receipts_message on message_receipts (message_id, id);

create table message_attachments (
  id bigserial primary key,
  message_id bigint not null references messages(id) on delete cascade,
  upload_id text references uploads(id),                 -- null for simulated fixture attachments
  name text not null,
  kind text not null,
  size text not null default ''
);
create index message_attachments_message on message_attachments (message_id);

create table thread_reads (
  thread_id text not null references conversation_threads(id) on delete cascade,
  user_id text not null references users(id),
  last_seq int not null default 0,
  primary key (thread_id, user_id)
);

-- Same rule as 0007: the only DELETE allowed is the cascade of a demo purge (axion.purge_demo, set by clearDemo).
create trigger messages_no_update before update or delete on messages for each row execute function instances_append_only();
create trigger messages_no_truncate before truncate on messages for each statement execute function instances_append_only();
create trigger message_receipts_no_update before update or delete on message_receipts for each row execute function instances_append_only();
create trigger message_receipts_no_truncate before truncate on message_receipts for each statement execute function instances_append_only();
