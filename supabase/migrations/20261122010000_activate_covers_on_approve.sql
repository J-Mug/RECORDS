-- When a candidate is approved, Cover Art Archive hotlinks stored on the
-- candidate (or its sibling album candidate) must become public ACTIVE
-- quotation-only assets on the published album. The previous update only
-- reassigned entity_id and left status as NEEDS_REVIEW, so covers never
-- appeared on the site.

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
  v_release_id uuid;
  v_duration integer;
  v_release_mbid text;
  v_track integer;
begin
  if auth.uid() is not null and not public.is_admin() then
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
      set status = 'REJECTED', reviewed_at = now(), reviewed_by = auth.uid()
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

  begin
    v_duration := nullif(c.metadata->>'duration_ms', '')::integer;
  exception when others then
    v_duration := null;
  end;
  v_release_mbid := nullif(c.metadata->>'release_mbid', '');
  begin
    v_track := nullif(c.metadata->>'track_position', '')::integer;
  exception when others then
    v_track := null;
  end;

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
        'ARTIST', v_artist_id, 'musicbrainz', c.artist_mbid,
        'https://musicbrainz.org/artist/' || c.artist_mbid,
        now(), 'https://musicbrainz.org/doc/MusicBrainz_API', 'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set entity_id = excluded.entity_id, retrieved_at = now(), updated_at = now();
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
        'ALBUM', v_album_id, 'musicbrainz', c.album_mbid,
        'https://musicbrainz.org/release-group/' || c.album_mbid,
        now(), 'https://musicbrainz.org/doc/MusicBrainz_API', 'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set entity_id = excluded.entity_id, retrieved_at = now(), updated_at = now();
    end if;

    -- Promote Cover Art Archive references onto the published album so they
    -- become publicly visible (ACTIVE, quotation-only, never cached).
    -- Also pick up a cover stored on the related ALBUM candidate when a SONG
    -- is approved first.
    update public.media_asset
      set entity_type = 'ALBUM',
          entity_id = v_album_id,
          status = 'ACTIVE',
          rights_type = 'QUOTATION_ONLY',
          cached = false,
          attribution_required = true,
          attribution_text = coalesce(nullif(attribution_text, ''), 'Cover: Cover Art Archive')
      where asset_type = 'ALBUM_COVER'
        and entity_type = 'CANDIDATE'
        and entity_id in (
          p_id,
          (
            select mc.id
            from public.music_candidate mc
            where mc.candidate_kind = 'ALBUM'
              and mc.album_mbid is not distinct from c.album_mbid
              and mc.source = 'musicbrainz'
            order by mc.created_at
            limit 1
          )
        )
        and not exists (
          select 1
          from public.media_asset existing
          where existing.entity_type = 'ALBUM'
            and existing.entity_id = v_album_id
            and existing.asset_type = 'ALBUM_COVER'
            and existing.status = 'ACTIVE'
        );
  end if;

  if v_release_mbid is not null and v_album_id is not null then
    select es.entity_id into v_release_id
    from public.external_source es
    where es.source = 'musicbrainz'
      and es.entity_type = 'RELEASE'
      and es.external_id = v_release_mbid
    limit 1;

    if v_release_id is null then
      insert into public.release (
        album_id, title, country, released_on, status
      ) values (
        v_album_id,
        nullif(c.metadata->>'release_title', ''),
        nullif(c.metadata->>'release_country', ''),
        c.release_date,
        'PUBLISHED'
      )
      returning id into v_release_id;

      insert into public.external_source (
        entity_type, entity_id, source, external_id, source_url,
        retrieved_at, provider_terms_url, status, metadata
      ) values (
        'RELEASE', v_release_id, 'musicbrainz', v_release_mbid,
        'https://musicbrainz.org/release/' || v_release_mbid,
        now(), 'https://musicbrainz.org/doc/MusicBrainz_API', 'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set entity_id = excluded.entity_id, retrieved_at = now(), updated_at = now()
      returning entity_id into v_release_id;
    end if;
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
        'SONG', v_song_id, 'musicbrainz', c.song_mbid,
        'https://musicbrainz.org/recording/' || c.song_mbid,
        now(), 'https://musicbrainz.org/doc/MusicBrainz_API', 'ACTIVE',
        jsonb_build_object('promoted_from', c.id)
      )
      on conflict on constraint external_source_unique
      do update set entity_id = excluded.entity_id, retrieved_at = now(), updated_at = now();
    end if;
  end if;

  if v_release_id is not null and v_song_id is not null then
    insert into public.release_track (
      release_id, song_id, disc_number, track_number, duration_ms
    ) values (
      v_release_id, v_song_id, 1, coalesce(v_track, 1), v_duration
    )
    on conflict do nothing;
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
    'song_id', v_song_id,
    'release_id', v_release_id
  );
end;
$$;

revoke all on function public.review_music_candidate(uuid, text, uuid) from public;
grant execute on function public.review_music_candidate(uuid, text, uuid) to authenticated, service_role;
