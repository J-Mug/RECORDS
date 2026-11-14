-- Phase 2: admin role, candidate source tracking, review RPC
-- D-008  Candidates never auto-publish; humans approve via review_music_candidate.
-- D-006  CAA URLs may be stored as media_asset references; cached stays false.

-- ---------------------------------------------------------------------------
-- Profile role (admin gate). Users cannot escalate their own role.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow SQL console / service role (no JWT) to set role.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role is distinct from 'user' and not public.is_admin() then
      new.role := 'user';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role and not public.is_admin() then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update on public.profiles
  for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------------------
-- Candidate MBID tracking + duplicate detection
-- ---------------------------------------------------------------------------

alter table public.music_candidate
  add column if not exists candidate_kind text not null default 'SONG',
  add column if not exists artist_mbid text,
  add column if not exists album_mbid text,
  add column if not exists song_mbid text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'music_candidate_kind_check'
      and conrelid = 'public.music_candidate'::regclass
  ) then
    alter table public.music_candidate
      add constraint music_candidate_kind_check
      check (candidate_kind in ('ARTIST', 'ALBUM', 'SONG'));
  end if;
end $$;

create unique index if not exists music_candidate_mb_artist_uidx
  on public.music_candidate (source, artist_mbid)
  where candidate_kind = 'ARTIST' and artist_mbid is not null;

create unique index if not exists music_candidate_mb_album_uidx
  on public.music_candidate (source, album_mbid)
  where candidate_kind = 'ALBUM' and album_mbid is not null;

create unique index if not exists music_candidate_mb_song_uidx
  on public.music_candidate (source, song_mbid)
  where candidate_kind = 'SONG' and song_mbid is not null;

create index if not exists music_candidate_kind_idx
  on public.music_candidate (candidate_kind, status);

-- ---------------------------------------------------------------------------
-- Admin can read candidates; writes go through the review RPC.
-- ---------------------------------------------------------------------------

grant select on public.music_candidate to authenticated;

drop policy if exists music_candidate_admin_select on public.music_candidate;
create policy music_candidate_admin_select on public.music_candidate
  for select to authenticated
  using (public.is_admin());

-- Admin may see non-ACTIVE reference artwork (CAA URLs pending rights review).
drop policy if exists media_asset_admin_select on public.media_asset;
create policy media_asset_admin_select on public.media_asset
  for select to authenticated
  using (public.is_admin());

drop policy if exists external_source_admin_select on public.external_source;
create policy external_source_admin_select on public.external_source
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Human review: approve promotes into artist / album / song.
-- ---------------------------------------------------------------------------

create or replace function public.review_music_candidate(
  p_id uuid,
  p_action text,
  p_merge_into uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.music_candidate%rowtype;
  v_artist_id uuid;
  v_album_id uuid;
  v_song_id uuid;
  v_duration integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject', 'merge') then
    raise exception 'invalid action';
  end if;

  select * into c from public.music_candidate where id = p_id for update;
  if not found then
    raise exception 'candidate not found';
  end if;

  if c.status in ('APPROVED', 'REJECTED', 'MERGED') then
    raise exception 'candidate already reviewed';
  end if;

  if p_action = 'reject' then
    update public.music_candidate
      set status = 'REJECTED',
          reviewed_at = now(),
          reviewed_by = auth.uid()
      where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'REJECTED');
  end if;

  if p_action = 'merge' then
    if p_merge_into is null or p_merge_into = p_id then
      raise exception 'merge target required';
    end if;
    if not exists (select 1 from public.music_candidate t where t.id = p_merge_into) then
      raise exception 'merge target not found';
    end if;
    update public.music_candidate
      set status = 'MERGED',
          duplicate_of = p_merge_into,
          reviewed_at = now(),
          reviewed_by = auth.uid()
      where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'MERGED');
  end if;

  -- approve
  if c.artist_mbid is not null and c.artist_name is not null then
    select es.entity_id into v_artist_id
    from public.external_source es
    where es.source = 'musicbrainz'
      and es.entity_type = 'ARTIST'
      and es.external_id = c.artist_mbid
    limit 1;

    if v_artist_id is null then
      insert into public.artist (name, name_sort, disambiguation, status)
      values (
        c.artist_name,
        nullif(c.metadata->>'name_sort', ''),
        nullif(c.metadata->>'artist_disambiguation', ''),
        'PUBLISHED'
      )
      returning id into v_artist_id;

      insert into public.external_source (
        entity_type, entity_id, source, external_id, source_url,
        retrieved_at, provider_terms_url, status, metadata
      ) values (
        'ARTIST',
        v_artist_id,
        'musicbrainz',
        c.artist_mbid,
        'https://musicbrainz.org/artist/' || c.artist_mbid,
        now(),
        'https://musicbrainz.org/doc/MusicBrainz_API',
        'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set
        entity_id = excluded.entity_id,
        retrieved_at = now(),
        updated_at = now();
    end if;
  end if;

  if c.candidate_kind in ('ALBUM', 'SONG')
     and c.album_mbid is not null
     and c.album_name is not null then
    select es.entity_id into v_album_id
    from public.external_source es
    where es.source = 'musicbrainz'
      and es.entity_type = 'ALBUM'
      and es.external_id = c.album_mbid
    limit 1;

    if v_album_id is null then
      insert into public.album (title, primary_artist_id, first_released_on, status)
      values (c.album_name, v_artist_id, c.release_date, 'PUBLISHED')
      returning id into v_album_id;

      insert into public.external_source (
        entity_type, entity_id, source, external_id, source_url,
        retrieved_at, provider_terms_url, status, metadata
      ) values (
        'ALBUM',
        v_album_id,
        'musicbrainz',
        c.album_mbid,
        'https://musicbrainz.org/release-group/' || c.album_mbid,
        now(),
        'https://musicbrainz.org/doc/MusicBrainz_API',
        'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set
        entity_id = excluded.entity_id,
        retrieved_at = now(),
        updated_at = now();
    end if;

    -- Retarget CAA URL references to the canonical album. Do not cache files.
    update public.media_asset
      set entity_type = 'ALBUM',
          entity_id = v_album_id
      where entity_type = 'CANDIDATE'
        and entity_id = p_id;
  end if;

  if c.candidate_kind = 'SONG'
     and c.song_mbid is not null
     and c.song_name is not null then
    select es.entity_id into v_song_id
    from public.external_source es
    where es.source = 'musicbrainz'
      and es.entity_type = 'SONG'
      and es.external_id = c.song_mbid
    limit 1;

    if v_song_id is null then
      begin
        v_duration := nullif(c.metadata->>'duration_ms', '')::integer;
      exception when others then
        v_duration := null;
      end;

      insert into public.song (
        title, primary_artist_id, primary_album_id, duration_ms, status
      ) values (
        c.song_name, v_artist_id, v_album_id, v_duration, 'PUBLISHED'
      )
      returning id into v_song_id;

      insert into public.external_source (
        entity_type, entity_id, source, external_id, source_url,
        retrieved_at, provider_terms_url, status, metadata
      ) values (
        'SONG',
        v_song_id,
        'musicbrainz',
        c.song_mbid,
        'https://musicbrainz.org/recording/' || c.song_mbid,
        now(),
        'https://musicbrainz.org/doc/MusicBrainz_API',
        'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set
        entity_id = excluded.entity_id,
        retrieved_at = now(),
        updated_at = now();
    end if;
  end if;

  update public.music_candidate
    set status = 'APPROVED',
        approved_artist_id = v_artist_id,
        approved_album_id = v_album_id,
        approved_song_id = v_song_id,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'APPROVED',
    'artist_id', v_artist_id,
    'album_id', v_album_id,
    'song_id', v_song_id
  );
end;
$$;

revoke all on function public.review_music_candidate(uuid, text, uuid) from public;
grant execute on function public.review_music_candidate(uuid, text, uuid) to authenticated, service_role;
