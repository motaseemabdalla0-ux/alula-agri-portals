-- ════════════════════════════════════════════════════════════════════════
--  بوابات مركز الزراعة — قاعدة البيانات المشتركة (Supabase)
--  الصق هذا الملف كاملاً في: SQL Editor ▸ New query ▸ Run
--  آمن لإعادة التشغيل: لا يحذف أي بيانات موجودة.
--
--  لا يرى أحد البيانات ولا يعدّلها إلا بعد تسجيل الدخول بحساب الفريق.
--  الزائر بدون دخول (anon) ممنوع من كل الجداول.
-- ════════════════════════════════════════════════════════════════════════

-- ── المزاد: الدفعات والبائعون والمشترون (كل سجل كاملاً في data) ──
create table if not exists public.auction_records (
  kind        text        not null check (kind in ('lots', 'sellers', 'buyers')),
  id          text        not null,
  rid         text        generated always as (data ->> 'rid') stored,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid(),
  primary key (kind, id)
);
-- رقم الدفعة / البائع / المشتري لا يتكرر
create unique index if not exists auction_records_rid_uq on public.auction_records (kind, rid);

-- ── بيانات ثابتة كبيرة (مقارنة موسم 2025) ──
create table if not exists public.app_blobs (
  key         text        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- ── استبيان إنتاج التمور والحمضيات ──
create table if not exists public.surveys (
  record_id   text        primary key,
  data        jsonb       not null,
  collector   text        generated always as (data ->> 'collector') stored,
  farmer      text        generated always as (data ->> 'farmer') stored,
  region      text        generated always as (data ->> 'region') stored,
  survey_date text        generated always as (data ->> 'surveyDate') stored,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid()
);

-- ── سجل كل إضافة وتعديل وحذف (من، متى، ماذا) ──
create table if not exists public.change_log (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  by_user uuid        default auth.uid(),
  tbl     text        not null,
  kind    text,
  rec_id  text,
  op      text        not null,
  data    jsonb
);

create or replace function public.touch_and_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  if tg_table_name = 'auction_records' then
    insert into change_log (tbl, kind, rec_id, op, data)
    values ('auction', coalesce(new.kind, old.kind), coalesce(new.id, old.id), lower(tg_op), case when tg_op = 'DELETE' then old.data else new.data end);
  elsif tg_table_name = 'surveys' then
    insert into change_log (tbl, rec_id, op, data)
    values ('survey', coalesce(new.record_id, old.record_id), lower(tg_op), case when tg_op = 'DELETE' then old.data else new.data end);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists auction_touch on public.auction_records;
create trigger auction_touch before insert or update or delete on public.auction_records
  for each row execute function public.touch_and_log();
drop trigger if exists survey_touch on public.surveys;
create trigger survey_touch before insert or update or delete on public.surveys
  for each row execute function public.touch_and_log();

-- رقم يتغيّر مع كل تعديل: الصفحات تسأل عنه كل 30 ثانية وتجلب البيانات فقط إذا تغيّر
create or replace function public.data_rev(p_tbl text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(max(id), 0) from change_log where tbl = p_tbl
$$;

-- ── الصلاحيات: حساب الفريق فقط ──
alter table public.auction_records enable row level security;
alter table public.app_blobs       enable row level security;
alter table public.surveys         enable row level security;
alter table public.change_log      enable row level security;

revoke all on public.auction_records, public.app_blobs, public.surveys, public.change_log from anon;
grant select, insert, update, delete on public.auction_records, public.app_blobs, public.surveys to authenticated;
grant select on public.change_log to authenticated;
grant usage, select on sequence public.change_log_id_seq to authenticated;
revoke all on function public.data_rev(text) from public, anon;
grant execute on function public.data_rev(text) to authenticated;

drop policy if exists team_all on public.auction_records;
create policy team_all on public.auction_records for all to authenticated using (true) with check (true);
drop policy if exists team_all on public.app_blobs;
create policy team_all on public.app_blobs for all to authenticated using (true) with check (true);
drop policy if exists team_all on public.surveys;
create policy team_all on public.surveys for all to authenticated using (true) with check (true);
drop policy if exists team_read on public.change_log;
create policy team_read on public.change_log for select to authenticated using (true);
