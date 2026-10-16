export const initial = `
create table raw_records (
  id integer primary key,
  source text not null,
  machine_id text not null,
  location text not null,
  byte_offset integer not null,
  session_id text,
  raw text not null,
  unparsed integer not null default 0,
  unique (source, location, byte_offset)
);
create index raw_records_session on raw_records (session_id);

create table sessions (
  id text primary key,
  source text not null,
  machine_id text not null,
  project_dir text,
  started_at text,
  ended_at text,
  event_count integer not null default 0,
  title text,
  excluded integer not null default 0
);

create table events (
  id text primary key,
  raw_id integer references raw_records (id),
  source text not null,
  machine_id text not null,
  session_id text not null,
  project_dir text,
  timestamp text,
  role text not null,
  kind text not null,
  content text,
  content_redacted text,
  tool_name text,
  tool_input text,
  tool_input_redacted text,
  tool_output text,
  tool_output_redacted text,
  files_touched text,
  attachments text,
  unparsed integer not null default 0
);
create index events_session_time on events (session_id, timestamp);
create index events_time on events (timestamp);

create virtual table events_fts using fts5 (
  content_redacted,
  tool_name,
  content = 'events',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

create trigger events_fts_insert after insert on events begin
  insert into events_fts (rowid, content_redacted, tool_name) values (new.rowid, new.content_redacted, new.tool_name);
end;
create trigger events_fts_delete after delete on events begin
  insert into events_fts (events_fts, rowid, content_redacted, tool_name) values ('delete', old.rowid, old.content_redacted, old.tool_name);
end;
create trigger events_fts_update after update on events begin
  insert into events_fts (events_fts, rowid, content_redacted, tool_name) values ('delete', old.rowid, old.content_redacted, old.tool_name);
  insert into events_fts (rowid, content_redacted, tool_name) values (new.rowid, new.content_redacted, new.tool_name);
end;

create table ingest_state (
  adapter text not null,
  key text not null,
  byte_offset integer not null,
  mtime text,
  extra text,
  primary key (adapter, key)
);

create table imports (
  id integer primary key,
  path text,
  sha256 text unique,
  imported_at text,
  counts text
);

create table links (
  from_id text,
  to_id text,
  kind text,
  created_at text
);

create table decisions (
  id text primary key,
  session_id text,
  event_id text,
  statement text,
  rationale text,
  alternatives text,
  status text check (status in ('proposed', 'confirmed', 'dismissed')),
  machine_id text,
  created_at text
);
`;
