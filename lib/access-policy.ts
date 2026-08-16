// Row-level security policies (F01-T04, tech_infrastructure.md §9).
//
// The rules live in Postgres, not in the app: a respondent can read and write
// their own `answers`, `answer_snapshots` and individual `opsp_drafts` rows;
// the cohort facilitator gets cohort-wide read; and nobody but the cohort
// facilitator can read an `is_private` row, including the reader's own. The
// policies resolve the current actor from the transaction setting
// `app.respondent_id`, which lib/access.ts sets per request. Because a
// facilitator is just a respondent row with `is_facilitator = true`, acting as
// the facilitator means running as that respondent id.
//
// FORCE ROW LEVEL SECURITY is the load-bearing piece: the application connects
// as the very role that owns these tables, and without FORCE the owner
// bypasses the policies entirely, making them decorative. With FORCE, even a
// future developer who writes a raw `select` against the answers table instead
// of going through the query helpers still cannot cross respondents or read a
// private note. RLS is the guarantee that cannot be forgotten; the helpers are
// the convenience on top.

export const ACCESS_UP_SQL = `
create function app_current_respondent() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.respondent_id', true), '')::uuid
$$;

-- Is the current respondent the facilitator of the cohort that owns
-- "owner_id"'s answers? True only when both rows share a cohort and the
-- current respondent is flagged as that cohort's facilitator.
create function app_is_facilitator_of_respondent(owner_id uuid) returns boolean
language sql stable
as $$
  select exists (
    select 1
      from respondents reader
      join respondents owner on owner.cohort_id = reader.cohort_id
     where reader.id = app_current_respondent()
       and owner.id = owner_id
       and reader.is_facilitator
  )
$$;

-- Is the current respondent the facilitator of "target_cohort"?
create function app_is_facilitator_of_cohort(target_cohort uuid) returns boolean
language sql stable
as $$
  select exists (
    select 1
      from respondents reader
     where reader.id = app_current_respondent()
       and reader.cohort_id = target_cohort
       and reader.is_facilitator
  )
$$;

alter table answers enable row level security;
alter table answers force row level security;

create policy answers_own_read on answers
  for select
  using (respondent_id = app_current_respondent() and not is_private);

create policy answers_facilitator_read on answers
  for select
  using (app_is_facilitator_of_respondent(respondent_id));

create policy answers_own_insert on answers
  for insert
  with check (respondent_id = app_current_respondent());

create policy answers_own_update on answers
  for update
  using (respondent_id = app_current_respondent())
  with check (respondent_id = app_current_respondent());

create policy answers_own_delete on answers
  for delete
  using (respondent_id = app_current_respondent());

alter table answer_snapshots enable row level security;
alter table answer_snapshots force row level security;

create policy snapshots_own_read on answer_snapshots
  for select
  using (respondent_id = app_current_respondent());

create policy snapshots_facilitator_read on answer_snapshots
  for select
  using (app_is_facilitator_of_respondent(respondent_id));

create policy snapshots_own_insert on answer_snapshots
  for insert
  with check (respondent_id = app_current_respondent());

alter table opsp_drafts enable row level security;
alter table opsp_drafts force row level security;

create policy drafts_own_read on opsp_drafts
  for select
  using (owner_type = 'individual' and owner_id = app_current_respondent());

create policy drafts_own_insert on opsp_drafts
  for insert
  with check (owner_type = 'individual' and owner_id = app_current_respondent());

create policy drafts_own_update on opsp_drafts
  for update
  using (owner_type = 'individual' and owner_id = app_current_respondent())
  with check (owner_type = 'individual' and owner_id = app_current_respondent());

create policy drafts_facilitator_read on opsp_drafts
  for select
  using (app_is_facilitator_of_cohort(cohort_id));

-- A respondent must be able to write and re-save their own private note
-- (autosave, editing before submit), yet must never read it back. Postgres RLS
-- refuses to UPDATE or DELETE a row the writer cannot SELECT, so a plain
-- upsert of a private row under the respondent's own RLS fails 42501. This
-- single-purpose, security-definer function owned by the migration role (a
-- superuser, which bypasses RLS) is the only writer allowed to touch a private
-- row. It is deliberately narrow: the caller can only ever write their own
-- respondent_id (enforced against the same 'app.respondent_id' GUC the policies
-- read), so no respondent ever inherits read access to private rows, which is
-- exactly the "deny reads, including the reader's own" guarantee kept whole.
create function app_upsert_own_answer(
  p_id uuid,
  p_respondent_id uuid,
  p_question_id text,
  p_value jsonb,
  p_is_private boolean,
  p_confidence smallint
) returns void
language plpgsql
security definer
as $$
begin
  if p_respondent_id is distinct from app_current_respondent() then
    raise exception 'app_upsert_own_answer rejected: not your row'
      using errcode = '42501';
  end if;
  insert into answers (id, respondent_id, question_id, value, is_private, confidence)
  values (p_id, p_respondent_id, p_question_id, p_value, p_is_private, p_confidence)
  on conflict (respondent_id, question_id)
  do update set value = excluded.value,
                is_private = excluded.is_private,
                confidence = excluded.confidence,
                updated_at = now();
end;
$$;
`;

export const ACCESS_DOWN_SQL = `
drop function if exists app_upsert_own_answer(uuid, uuid, text, jsonb, boolean, smallint);
drop policy if exists answers_own_delete on answers;
drop policy if exists answers_own_update on answers;
drop policy if exists answers_own_insert on answers;
drop policy if exists answers_facilitator_read on answers;
drop policy if exists answers_own_read on answers;
drop policy if exists snapshots_own_insert on answer_snapshots;
drop policy if exists snapshots_facilitator_read on answer_snapshots;
drop policy if exists snapshots_own_read on answer_snapshots;
drop policy if exists drafts_facilitator_read on opsp_drafts;
drop policy if exists drafts_own_update on opsp_drafts;
drop policy if exists drafts_own_insert on opsp_drafts;
drop policy if exists drafts_own_read on opsp_drafts;

alter table answers no force row level security;
alter table answers disable row level security;
alter table answer_snapshots no force row level security;
alter table answer_snapshots disable row level security;
alter table opsp_drafts no force row level security;
alter table opsp_drafts disable row level security;

drop function if exists app_is_facilitator_of_cohort(uuid);
drop function if exists app_is_facilitator_of_respondent(uuid);
drop function if exists app_current_respondent();
`;