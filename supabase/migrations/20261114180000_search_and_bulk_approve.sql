-- Phase 3 search indexes + enhanced promotion + bulk approve of unique candidates.
-- D-010  One song row per work; additional editions attach via release_track.
-- D-008  Ambiguous candidates stay NEEDS_REVIEW for a human.

create extension if not exists pg_trgm;

create or replace function public.normalize_music_text(t text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    lower(
      trim(
        regexp_replace(
          normalize(coalesce(t, ''), NFKC),
          '[[:space:][:punct:]]+',
          ' ',
          'g'
        )
      )
    ),
    ''
  );
$$;

revoke all on function public.normalize_music_text(text) from public;
grant execute on function public.normalize_music_text(text) to anon, authenticated, service_role;

create index if not exists artist_name_trgm on public.artist using gin (name gin_trgm_ops);
create index if not exists artist_sort_trgm on public.artist using gin (name_sort gin_trgm_ops);
create index if not exists album_title_trgm on public.album using gin (title gin_trgm_ops);
create index if not exists song_title_trgm on public.song using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Promote a candidate. Also creates release + release_track when metadata
-- has a release MBID. SQL console (no JWT) is allowed for ops scripts.
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

    update public.media_asset
      set entity_type = 'ALBUM', entity_id = v_album_id
      where entity_type = 'CANDIDATE' and entity_id = p_id;
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

-- Attach a sibling recording (same work, other release) to an existing song.
create or replace function public.attach_candidate_release_to_song(
  p_id uuid,
  p_song_id uuid,
  p_canonical_candidate uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.music_candidate%rowtype;
  v_artist_id uuid;
  v_album_id uuid;
  v_release_id uuid;
  v_duration integer;
  v_release_mbid text;
  v_track integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into c from public.music_candidate where id = p_id for update;
  if not found then
    raise exception 'candidate not found';
  end if;
  if c.status in ('APPROVED', 'REJECTED', 'MERGED') then
    return;
  end if;

  -- Reuse approve's artist/album/release upserts by calling review after
  -- temporarily... instead inline the album/release path:
  perform 1;

  if c.artist_mbid is not null and c.artist_name is not null then
    select es.entity_id into v_artist_id
    from public.external_source es
    where es.source = 'musicbrainz' and es.entity_type = 'ARTIST' and es.external_id = c.artist_mbid
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

  if c.album_mbid is not null and c.album_name is not null then
    select es.entity_id into v_album_id
    from public.external_source es
    where es.source = 'musicbrainz' and es.entity_type = 'ALBUM' and es.external_id = c.album_mbid
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
  end if;

  v_release_mbid := nullif(c.metadata->>'release_mbid', '');
  begin
    v_duration := nullif(c.metadata->>'duration_ms', '')::integer;
  exception when others then
    v_duration := null;
  end;
  begin
    v_track := nullif(c.metadata->>'track_position', '')::integer;
  exception when others then
    v_track := null;
  end;

  if v_release_mbid is not null and v_album_id is not null then
    select es.entity_id into v_release_id
    from public.external_source es
    where es.source = 'musicbrainz' and es.entity_type = 'RELEASE' and es.external_id = v_release_mbid
    limit 1;
    if v_release_id is null then
      insert into public.release (album_id, title, country, released_on, status)
      values (
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

  if c.song_mbid is not null then
    insert into public.external_source (
      entity_type, entity_id, source, external_id, source_url,
      retrieved_at, provider_terms_url, status, metadata
    ) values (
      'SONG', p_song_id, 'musicbrainz', c.song_mbid,
      'https://musicbrainz.org/recording/' || c.song_mbid,
      now(), 'https://musicbrainz.org/doc/MusicBrainz_API', 'ACTIVE',
      jsonb_build_object('promoted_from', c.id, 'merged_into_song', p_song_id)
    )
    on conflict on constraint external_source_unique do nothing;
  end if;

  if v_release_id is not null then
    insert into public.release_track (
      release_id, song_id, disc_number, track_number, duration_ms
    ) values (
      v_release_id, p_song_id, 1, coalesce(v_track, 1), v_duration
    )
    on conflict do nothing;
  end if;

  update public.music_candidate
    set status = 'MERGED',
        duplicate_of = p_canonical_candidate,
        approved_artist_id = v_artist_id,
        approved_album_id = v_album_id,
        approved_song_id = p_song_id,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'review_flag', 'MERGED_ACROSS_RELEASES',
          'review_flag_reason', 'Same work on another release; attached as release_track'
        )
    where id = p_id;
end;
$$;

revoke all on function public.attach_candidate_release_to_song(uuid, uuid, uuid) from public;
grant execute on function public.attach_candidate_release_to_song(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Flag ambiguous collisions; auto-merge same work across releases;
-- approve every remaining unique candidate.
-- ---------------------------------------------------------------------------

create or replace function public.bulk_approve_unique_candidates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flagged int := 0;
  v_approved int := 0;
  v_merged int := 0;
  v_errors int := 0;
  v_err text;
  r record;
  canonical uuid;
  canonical_song uuid;
  sibling uuid;
  result jsonb;
  error_samples text[] := '{}';
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Ambiguous: same artist + title + album (or same artist name) with different MBIDs.
  update public.music_candidate c
    set ai_reason = 'AMBIGUOUS_TITLE',
        metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
          'review_flag', 'AMBIGUOUS_TITLE',
          'review_flag_reason', 'Same normalized artist+title on the same album (or artist name) with a different MBID'
        )
  where c.status = 'NEEDS_REVIEW'
    and (
      (
        c.candidate_kind = 'ARTIST'
        and exists (
          select 1 from public.music_candidate o
          where o.status = 'NEEDS_REVIEW'
            and o.candidate_kind = 'ARTIST'
            and o.id <> c.id
            and public.normalize_music_text(o.artist_name) = public.normalize_music_text(c.artist_name)
            and o.artist_mbid is distinct from c.artist_mbid
        )
      )
      or (
        c.candidate_kind = 'ALBUM'
        and exists (
          select 1 from public.music_candidate o
          where o.status = 'NEEDS_REVIEW'
            and o.candidate_kind = 'ALBUM'
            and o.id <> c.id
            and public.normalize_music_text(o.artist_name) = public.normalize_music_text(c.artist_name)
            and public.normalize_music_text(o.album_name) = public.normalize_music_text(c.album_name)
            and o.album_mbid is distinct from c.album_mbid
        )
      )
      or (
        c.candidate_kind = 'SONG'
        and exists (
          select 1 from public.music_candidate o
          where o.status = 'NEEDS_REVIEW'
            and o.candidate_kind = 'SONG'
            and o.id <> c.id
            and public.normalize_music_text(o.artist_name) = public.normalize_music_text(c.artist_name)
            and public.normalize_music_text(o.song_name) = public.normalize_music_text(c.song_name)
            and public.normalize_music_text(o.album_name) = public.normalize_music_text(c.album_name)
            and o.song_mbid is distinct from c.song_mbid
        )
      )
    );

  get diagnostics v_flagged = row_count;

  -- Same work on different releases: approve one canonical song, attach the rest as tracks.
  for r in
    select public.normalize_music_text(artist_name) as artist_norm,
           public.normalize_music_text(song_name) as title_norm,
           array_agg(id order by release_date nulls last, created_at, id) as ids
    from public.music_candidate
    where status = 'NEEDS_REVIEW'
      and candidate_kind = 'SONG'
      and coalesce(metadata->>'review_flag', '') is distinct from 'AMBIGUOUS_TITLE'
    group by 1, 2
    having count(*) > 1
       and count(distinct album_mbid) > 1
  loop
    canonical := r.ids[1];
    begin
      result := public.review_music_candidate(canonical, 'approve', null);
      v_approved := v_approved + 1;
      canonical_song := (result->>'song_id')::uuid;
      if canonical_song is not null then
        for sibling in select unnest(r.ids[2:])
        loop
          begin
            perform public.attach_candidate_release_to_song(sibling, canonical_song, canonical);
            v_merged := v_merged + 1;
          exception when others then
            v_errors := v_errors + 1;
            if array_length(error_samples, 1) is null or array_length(error_samples, 1) < 8 then
              error_samples := error_samples || (sibling::text || ': ' || sqlerrm);
            end if;
          end;
        end loop;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      if array_length(error_samples, 1) is null or array_length(error_samples, 1) < 8 then
        error_samples := error_samples || (canonical::text || ': ' || sqlerrm);
      end if;
    end;
  end loop;

  -- Approve remaining unique (non-flagged) candidates: artists, albums, then songs.
  for r in
    select id
    from public.music_candidate
    where status = 'NEEDS_REVIEW'
      and coalesce(metadata->>'review_flag', '') is distinct from 'AMBIGUOUS_TITLE'
    order by
      case candidate_kind when 'ARTIST' then 0 when 'ALBUM' then 1 else 2 end,
      created_at,
      id
  loop
    begin
      perform public.review_music_candidate(r.id, 'approve', null);
      v_approved := v_approved + 1;
    exception when others then
      v_errors := v_errors + 1;
      if array_length(error_samples, 1) is null or array_length(error_samples, 1) < 8 then
        error_samples := error_samples || (r.id::text || ': ' || sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'approved', v_approved,
    'merged_across_releases', v_merged,
    'left_for_review', (
      select count(*) from public.music_candidate
      where status = 'NEEDS_REVIEW'
    ),
    'flagged_ambiguous', (
      select count(*) from public.music_candidate
      where status = 'NEEDS_REVIEW'
        and metadata->>'review_flag' = 'AMBIGUOUS_TITLE'
    ),
    'errors', v_errors,
    'error_samples', to_jsonb(error_samples),
    'by_kind_approved', (
      select coalesce(jsonb_object_agg(candidate_kind, n), '{}'::jsonb)
      from (
        select candidate_kind, count(*) as n
        from public.music_candidate
        where status = 'APPROVED'
        group by 1
      ) s
    ),
    'by_kind_merged', (
      select coalesce(jsonb_object_agg(candidate_kind, n), '{}'::jsonb)
      from (
        select candidate_kind, count(*) as n
        from public.music_candidate
        where status = 'MERGED'
        group by 1
      ) s
    ),
    'left_reason_breakdown', (
      select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
      from (
        select coalesce(metadata->>'review_flag', coalesce(ai_reason, 'UNFLAGGED_NEEDS_REVIEW')) as reason,
               count(*) as n
        from public.music_candidate
        where status = 'NEEDS_REVIEW'
        group by 1
      ) s
    )
  );
end;
$$;

revoke all on function public.bulk_approve_unique_candidates() from public;
grant execute on function public.bulk_approve_unique_candidates() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public catalog search (substring + trigram; uses name_sort for romaji).
-- ---------------------------------------------------------------------------

create or replace function public.search_music(p_q text, p_limit integer default 40)
returns table (
  entity_kind text,
  entity_id uuid,
  title text,
  subtitle text,
  score real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select
      trim(coalesce(p_q, '')) as raw,
      public.normalize_music_text(p_q) as norm,
      least(greatest(coalesce(p_limit, 40), 1), 80) as lim
  ),
  artists as (
    select
      'ARTIST'::text as entity_kind,
      a.id as entity_id,
      a.name as title,
      nullif(coalesce(a.disambiguation, a.name_sort), '') as subtitle,
      greatest(
        similarity(a.name, q.raw),
        similarity(coalesce(a.name_sort, ''), q.raw),
        similarity(coalesce(public.normalize_music_text(a.name), ''), coalesce(q.norm, '')),
        similarity(coalesce(public.normalize_music_text(a.name_sort), ''), coalesce(q.norm, '')),
        case
          when q.raw <> '' and (
            a.name ilike '%' || q.raw || '%'
            or coalesce(a.name_sort, '') ilike '%' || q.raw || '%'
          ) then 0.92
          else 0
        end
      )::real as score
    from public.artist a
    cross join q
    where a.status = 'PUBLISHED'
      and q.raw <> ''
      and (
        a.name ilike '%' || q.raw || '%'
        or coalesce(a.name_sort, '') ilike '%' || q.raw || '%'
        or a.name % q.raw
        or coalesce(a.name_sort, '') % q.raw
      )
  ),
  albums as (
    select
      'ALBUM'::text,
      al.id,
      al.title,
      ar.name,
      greatest(
        similarity(al.title, q.raw),
        similarity(coalesce(ar.name, ''), q.raw),
        similarity(coalesce(ar.name_sort, ''), q.raw),
        similarity(coalesce(public.normalize_music_text(al.title), ''), coalesce(q.norm, '')),
        case
          when q.raw <> '' and (
            al.title ilike '%' || q.raw || '%'
            or coalesce(ar.name, '') ilike '%' || q.raw || '%'
            or coalesce(ar.name_sort, '') ilike '%' || q.raw || '%'
          ) then 0.9
          else 0
        end
      )::real
    from public.album al
    left join public.artist ar on ar.id = al.primary_artist_id
    cross join q
    where al.status = 'PUBLISHED'
      and q.raw <> ''
      and (
        al.title ilike '%' || q.raw || '%'
        or coalesce(ar.name, '') ilike '%' || q.raw || '%'
        or coalesce(ar.name_sort, '') ilike '%' || q.raw || '%'
        or al.title % q.raw
        or coalesce(ar.name, '') % q.raw
        or coalesce(ar.name_sort, '') % q.raw
      )
  ),
  songs as (
    select
      'SONG'::text,
      s.id,
      s.title,
      trim(both ' · ' from concat_ws(' · ', ar.name, al.title)),
      greatest(
        similarity(s.title, q.raw),
        similarity(coalesce(ar.name, ''), q.raw),
        similarity(coalesce(ar.name_sort, ''), q.raw),
        similarity(coalesce(al.title, ''), q.raw),
        similarity(coalesce(public.normalize_music_text(s.title), ''), coalesce(q.norm, '')),
        case
          when q.raw <> '' and (
            s.title ilike '%' || q.raw || '%'
            or coalesce(ar.name, '') ilike '%' || q.raw || '%'
            or coalesce(ar.name_sort, '') ilike '%' || q.raw || '%'
            or coalesce(al.title, '') ilike '%' || q.raw || '%'
          ) then 0.9
          else 0
        end
      )::real
    from public.song s
    left join public.artist ar on ar.id = s.primary_artist_id
    left join public.album al on al.id = s.primary_album_id
    cross join q
    where s.status = 'PUBLISHED'
      and q.raw <> ''
      and (
        s.title ilike '%' || q.raw || '%'
        or coalesce(ar.name, '') ilike '%' || q.raw || '%'
        or coalesce(ar.name_sort, '') ilike '%' || q.raw || '%'
        or coalesce(al.title, '') ilike '%' || q.raw || '%'
        or s.title % q.raw
        or coalesce(ar.name, '') % q.raw
        or coalesce(ar.name_sort, '') % q.raw
        or coalesce(al.title, '') % q.raw
      )
  )
  select *
  from (
    select * from artists
    union all
    select * from albums
    union all
    select * from songs
  ) hits
  where hits.score >= 0.15
  order by hits.score desc, hits.title
  limit (select lim from q);
$$;

revoke all on function public.search_music(text, integer) from public;
grant execute on function public.search_music(text, integer) to anon, authenticated, service_role;
