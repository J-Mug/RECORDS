-- Phase 5 Shop helpers
-- Shop is a public window. Items may only be added from the owner's Walkie.
-- Walkie notes are never copied onto shop_item.note (that column is the public comment).

alter table public.shop
  add constraint shop_name_len
  check (char_length(btrim(name)) between 1 and 80);

alter table public.shop
  add constraint shop_introduction_len
  check (introduction is null or char_length(introduction) <= 500);

alter table public.shop_item
  add constraint shop_item_note_len
  check (note is null or char_length(note) <= 280);

-- Displayed songs must already be in the shop owner's Walkie.
create or replace function public.enforce_shop_item_from_walkie()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select s.user_id into owner_id
  from public.shop s
  where s.id = new.shop_id;

  if owner_id is null then
    raise exception 'shop not found' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.walkie_item w
    where w.user_id = owner_id
      and w.song_id = new.song_id
  ) then
    raise exception 'song is not in the owner walkie' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists shop_item_from_walkie on public.shop_item;
create trigger shop_item_from_walkie
  before insert or update of shop_id, song_id
  on public.shop_item
  for each row execute function public.enforce_shop_item_from_walkie();

-- Display a Walkie song on the current user's public Shop.
-- p_comment is an optional public caption and is never taken from walkie_item.note.
create or replace function public.display_on_shop(
  p_song_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_shop public.shop%rowtype;
  v_item public.shop_item%rowtype;
  v_order integer;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.walkie_item w
    where w.user_id = uid and w.song_id = p_song_id
  ) then
    raise exception 'song is not in the owner walkie' using errcode = '42501';
  end if;

  select * into v_shop
  from public.shop
  where user_id = uid;

  if not found then
    raise exception 'shop not found';
  end if;

  select * into v_item
  from public.shop_item
  where shop_id = v_shop.id and song_id = p_song_id;

  if found then
    return jsonb_build_object('created', false, 'item', to_jsonb(v_item));
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_order
  from public.shop_item
  where shop_id = v_shop.id;

  insert into public.shop_item (shop_id, song_id, shelf, note, sort_order)
  values (v_shop.id, p_song_id, 'FAVORITES', v_comment, v_order)
  returning * into v_item;

  return jsonb_build_object('created', true, 'item', to_jsonb(v_item));
end;
$$;

revoke all on function public.display_on_shop(uuid, text) from public;
grant execute on function public.display_on_shop(uuid, text) to authenticated;

-- Reorder the current user's shop items; sort_order follows array order.
create or replace function public.reorder_shop_items(p_item_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_shop_id uuid;
  i integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into v_shop_id
  from public.shop
  where user_id = uid;

  if v_shop_id is null then
    raise exception 'shop not found';
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as item_id
    where not exists (
      select 1 from public.shop_item si
      where si.id = item_id and si.shop_id = v_shop_id
    )
  ) then
    raise exception 'item does not belong to user' using errcode = '42501';
  end if;

  for i in 1 .. array_length(p_item_ids, 1) loop
    update public.shop_item
      set sort_order = i - 1
      where id = p_item_ids[i]
        and shop_id = v_shop_id;
  end loop;
end;
$$;

revoke all on function public.reorder_shop_items(uuid[]) from public;
grant execute on function public.reorder_shop_items(uuid[]) to authenticated;
