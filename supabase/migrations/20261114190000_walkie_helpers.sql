-- Phase 4 Walkie helpers
-- Walkie is a private warehouse: owner-only RLS already exists.
-- These constraints prevent moving an item into another user's section,
-- and provide save / reorder entry points used by the app and tests.

alter table public.walkie_section
  add constraint walkie_section_name_len
  check (char_length(btrim(name)) between 1 and 60);

alter table public.walkie_item
  add constraint walkie_item_note_len
  check (note is null or char_length(note) <= 2000);

create or replace function public.enforce_walkie_item_section()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.section_id is not null and not exists (
    select 1
    from public.walkie_section s
    where s.id = new.section_id
      and s.user_id = new.user_id
  ) then
    raise exception 'section does not belong to user' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists walkie_item_section_owner on public.walkie_item;
create trigger walkie_item_section_owner
  before insert or update of section_id, user_id
  on public.walkie_item
  for each row execute function public.enforce_walkie_item_section();

-- Save a published song to the current user's Walkie. Duplicate adds are no-ops.
create or replace function public.save_to_walkie(
  p_song_id uuid,
  p_section_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_item public.walkie_item%rowtype;
  v_order integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.song s
    where s.id = p_song_id and s.status = 'PUBLISHED'
  ) then
    raise exception 'song not found';
  end if;

  if p_section_id is not null and not exists (
    select 1 from public.walkie_section s
    where s.id = p_section_id and s.user_id = uid
  ) then
    raise exception 'section does not belong to user' using errcode = '42501';
  end if;

  select * into v_item
  from public.walkie_item
  where user_id = uid and song_id = p_song_id;

  if found then
    return jsonb_build_object('created', false, 'item', to_jsonb(v_item));
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_order
  from public.walkie_item
  where user_id = uid
    and section_id is not distinct from p_section_id;

  insert into public.walkie_item (user_id, song_id, section_id, sort_order)
  values (uid, p_song_id, p_section_id, v_order)
  returning * into v_item;

  return jsonb_build_object('created', true, 'item', to_jsonb(v_item));
end;
$$;

revoke all on function public.save_to_walkie(uuid, uuid) from public;
grant execute on function public.save_to_walkie(uuid, uuid) to authenticated;

-- Move items into a section (null = unsectioned) and set sort_order from array order.
create or replace function public.move_and_reorder_walkie_items(
  p_section_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  i integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_section_id is not null and not exists (
    select 1 from public.walkie_section s
    where s.id = p_section_id and s.user_id = uid
  ) then
    raise exception 'section does not belong to user' using errcode = '42501';
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as item_id
    where not exists (
      select 1 from public.walkie_item w
      where w.id = item_id and w.user_id = uid
    )
  ) then
    raise exception 'item does not belong to user' using errcode = '42501';
  end if;

  for i in 1 .. array_length(p_item_ids, 1) loop
    update public.walkie_item
      set section_id = p_section_id,
          sort_order = i - 1
      where id = p_item_ids[i]
        and user_id = uid;
  end loop;
end;
$$;

revoke all on function public.move_and_reorder_walkie_items(uuid, uuid[]) from public;
grant execute on function public.move_and_reorder_walkie_items(uuid, uuid[]) to authenticated;
