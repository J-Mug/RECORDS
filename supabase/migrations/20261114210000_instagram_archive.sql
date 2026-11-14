-- Instagram @iruli.l archive (Plan A)
-- Public-readable posts. Admin-only writes. Never stores or publishes slide images.
-- Matching may attach a catalog song/artist; unmatched posts become review candidates
-- and never auto-publish catalog rows.

create table public.instagram_post (
  id uuid primary key default gen_random_uuid(),
  shortcode text not null,
  ig_url text not null,
  posted_at timestamptz not null,
  artist text,
  song text,
  album text,
  topic text,
  caption text,
  hashtags text[] not null default '{}'::text[],
  sources text[] not null default '{}'::text[],
  youtube_url text,
  musicbrainz_id text,
  song_id uuid references public.song (id) on delete set null,
  artist_id uuid references public.artist (id) on delete set null,
  match_status text not null default 'UNMATCHED',
  candidate_id uuid references public.music_candidate (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_post_shortcode_unique unique (shortcode),
  constraint instagram_post_match_status_check
    check (match_status in ('MATCHED_SONG', 'MATCHED_ARTIST', 'UNMATCHED', 'NEEDS_REVIEW'))
);

create trigger instagram_post_set_updated_at
  before update on public.instagram_post
  for each row execute function public.set_updated_at();

create index instagram_post_posted_idx on public.instagram_post (posted_at desc);
create index instagram_post_song_idx on public.instagram_post (song_id);
create index instagram_post_artist_idx on public.instagram_post (artist_id);
create index instagram_post_status_idx on public.instagram_post (match_status);

create unique index if not exists music_candidate_instagram_url_uidx
  on public.music_candidate (source, source_url)
  where source = 'instagram_iruli' and source_url is not null;

grant select on public.instagram_post to anon, authenticated;
grant select, insert, update, delete on public.instagram_post to authenticated;

alter table public.instagram_post enable row level security;

create policy instagram_post_select_public on public.instagram_post
  for select to anon, authenticated
  using (true);

create policy instagram_post_admin_insert on public.instagram_post
  for insert to authenticated
  with check (public.is_admin());

create policy instagram_post_admin_update on public.instagram_post
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy instagram_post_admin_delete on public.instagram_post
  for delete to authenticated
  using (public.is_admin());

-- Admin may create review candidates (never auto-approved).
drop policy if exists music_candidate_admin_insert on public.music_candidate;
create policy music_candidate_admin_insert on public.music_candidate
  for insert to authenticated
  with check (public.is_admin());

grant insert on public.music_candidate to authenticated;

create or replace function public.sync_instagram_post(p_post jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shortcode text;
  v_ig_url text;
  v_posted_at timestamptz;
  v_artist_name text;
  v_song_name text;
  v_album_name text;
  v_topic text;
  v_caption text;
  v_hashtags text[];
  v_sources text[];
  v_youtube text;
  v_mbid text;
  v_song_id uuid;
  v_artist_id uuid;
  v_status text := 'UNMATCHED';
  v_candidate_id uuid;
  v_kind text;
  v_candidate_status public.candidate_status;
  v_iruli uuid;
  v_shop_id uuid;
  v_section_id uuid;
  v_order integer;
  v_comment text;
  v_song_hits integer;
  v_artist_hits integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_shortcode := nullif(btrim(p_post->>'ig_shortcode'), '');
  v_ig_url := nullif(btrim(p_post->>'ig_url'), '');
  if v_shortcode is null or v_ig_url is null then
    raise exception 'ig_shortcode and ig_url are required';
  end if;

  begin
    v_posted_at := (p_post->>'posted_at')::timestamptz;
  exception when others then
    raise exception 'invalid posted_at';
  end;
  if v_posted_at is null then
    raise exception 'posted_at is required';
  end if;

  v_artist_name := nullif(btrim(p_post->>'artist'), '');
  v_song_name := nullif(btrim(p_post->>'song'), '');
  v_album_name := nullif(btrim(p_post->>'album'), '');
  v_topic := nullif(btrim(p_post->>'topic'), '');
  v_caption := nullif(p_post->>'caption', '');
  v_youtube := nullif(btrim(p_post->>'youtube_url'), '');
  v_mbid := nullif(btrim(p_post->>'musicbrainz_id'), '');

  if jsonb_typeof(p_post->'hashtags') = 'array' then
    select coalesce(array_agg(x), '{}'::text[])
      into v_hashtags
      from jsonb_array_elements_text(p_post->'hashtags') as x;
  else
    v_hashtags := '{}'::text[];
  end if;
  if jsonb_typeof(p_post->'sources') = 'array' then
    select coalesce(array_agg(x), '{}'::text[])
      into v_sources
      from jsonb_array_elements_text(p_post->'sources') as x;
  else
    v_sources := '{}'::text[];
  end if;

  -- MusicBrainz id first (recording or artist).
  if v_mbid is not null then
    select es.entity_id into v_song_id
    from public.external_source es
    where es.source = 'musicbrainz'
      and es.entity_type = 'SONG'
      and es.external_id = v_mbid
    limit 1;
    if v_song_id is not null then
      select s.primary_artist_id into v_artist_id
      from public.song s
      where s.id = v_song_id;
      v_status := 'MATCHED_SONG';
    else
      select es.entity_id into v_artist_id
      from public.external_source es
      where es.source = 'musicbrainz'
        and es.entity_type = 'ARTIST'
        and es.external_id = v_mbid
      limit 1;
      if v_artist_id is not null then
        v_status := 'MATCHED_ARTIST';
        if v_song_name is not null then
          select count(*) into v_song_hits
          from public.song s
          where s.primary_artist_id = v_artist_id
            and s.status = 'PUBLISHED'
            and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name);
          if v_song_hits = 1 then
            select s.id into v_song_id
            from public.song s
            where s.primary_artist_id = v_artist_id
              and s.status = 'PUBLISHED'
              and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name);
            v_status := 'MATCHED_SONG';
          elsif v_song_hits > 1 then
            v_status := 'NEEDS_REVIEW';
            v_song_id := null;
          end if;
        end if;
      end if;
    end if;
  end if;

  -- Normalized name match when MBID did not resolve a song.
  if v_status is distinct from 'MATCHED_SONG' and v_song_name is not null and v_artist_name is not null then
    select count(*) into v_song_hits
    from public.song s
    join public.artist a on a.id = s.primary_artist_id
    where s.status = 'PUBLISHED'
      and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name)
      and (
        public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
        or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
      );

    if v_song_hits = 1 then
      select s.id, s.primary_artist_id into v_song_id, v_artist_id
      from public.song s
      join public.artist a on a.id = s.primary_artist_id
      where s.status = 'PUBLISHED'
        and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name)
        and (
          public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
          or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
        );
      v_status := 'MATCHED_SONG';
    elsif v_song_hits > 1 and v_album_name is not null then
      select count(*) into v_song_hits
      from public.song s
      join public.artist a on a.id = s.primary_artist_id
      left join public.album al on al.id = s.primary_album_id
      where s.status = 'PUBLISHED'
        and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name)
        and (
          public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
          or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
        )
        and public.normalize_music_text(al.title) = public.normalize_music_text(v_album_name);
      if v_song_hits = 1 then
        select s.id, s.primary_artist_id into v_song_id, v_artist_id
        from public.song s
        join public.artist a on a.id = s.primary_artist_id
        left join public.album al on al.id = s.primary_album_id
        where s.status = 'PUBLISHED'
          and public.normalize_music_text(s.title) = public.normalize_music_text(v_song_name)
          and (
            public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
            or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
          )
          and public.normalize_music_text(al.title) = public.normalize_music_text(v_album_name);
        v_status := 'MATCHED_SONG';
      elsif v_song_hits > 1 then
        v_status := 'NEEDS_REVIEW';
        v_song_id := null;
      else
        v_status := 'NEEDS_REVIEW';
        v_song_id := null;
      end if;
    elsif v_song_hits > 1 then
      v_status := 'NEEDS_REVIEW';
      v_song_id := null;
    end if;
  end if;

  if v_status not in ('MATCHED_SONG') and v_artist_id is null and v_artist_name is not null then
    select count(*) into v_artist_hits
    from public.artist a
    where a.status = 'PUBLISHED'
      and (
        public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
        or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
      );
    if v_artist_hits = 1 then
      select a.id into v_artist_id
      from public.artist a
      where a.status = 'PUBLISHED'
        and (
          public.normalize_music_text(a.name) = public.normalize_music_text(v_artist_name)
          or public.normalize_music_text(a.name_sort) = public.normalize_music_text(v_artist_name)
        );
      if v_status is distinct from 'NEEDS_REVIEW' then
        v_status := 'MATCHED_ARTIST';
      end if;
    elsif v_artist_hits > 1 and v_status is distinct from 'MATCHED_SONG' then
      v_status := 'NEEDS_REVIEW';
      v_artist_id := null;
    end if;
  end if;

  insert into public.instagram_post (
    shortcode, ig_url, posted_at, artist, song, album, topic, caption,
    hashtags, sources, youtube_url, musicbrainz_id, song_id, artist_id, match_status
  )
  values (
    v_shortcode, v_ig_url, v_posted_at, v_artist_name, v_song_name, v_album_name,
    v_topic, v_caption, v_hashtags, v_sources, v_youtube, v_mbid,
    v_song_id, v_artist_id, v_status
  )
  on conflict (shortcode) do update set
    ig_url = excluded.ig_url,
    posted_at = excluded.posted_at,
    artist = excluded.artist,
    song = excluded.song,
    album = excluded.album,
    topic = excluded.topic,
    caption = excluded.caption,
    hashtags = excluded.hashtags,
    sources = excluded.sources,
    youtube_url = excluded.youtube_url,
    musicbrainz_id = excluded.musicbrainz_id,
    song_id = excluded.song_id,
    artist_id = excluded.artist_id,
    match_status = excluded.match_status
  returning candidate_id into v_candidate_id;

  -- Unmatched / ambiguous posts become human-review candidates. Never approve here.
  if v_status in ('UNMATCHED', 'NEEDS_REVIEW') then
    v_kind := case when v_song_name is null then 'ARTIST' else 'SONG' end;
    v_candidate_status := case when v_status = 'NEEDS_REVIEW' then 'NEEDS_REVIEW' else 'PENDING' end;
    if v_candidate_id is null then
      select id into v_candidate_id
      from public.music_candidate
      where source = 'instagram_iruli' and source_url = v_ig_url
      limit 1;
    end if;
    if v_candidate_id is null then
      insert into public.music_candidate (
        source, source_url, artist_name, album_name, song_name,
        candidate_kind, status, song_mbid, metadata
      )
      values (
        'instagram_iruli',
        v_ig_url,
        v_artist_name,
        v_album_name,
        v_song_name,
        v_kind,
        v_candidate_status,
        case when v_kind = 'SONG' then v_mbid else null end,
        jsonb_build_object('ig_shortcode', v_shortcode, 'ig_url', v_ig_url, 'topic', v_topic)
      )
      returning id into v_candidate_id;
    else
      update public.music_candidate
        set artist_name = v_artist_name,
            album_name = v_album_name,
            song_name = v_song_name,
            candidate_kind = v_kind,
            status = case
              when status in ('APPROVED', 'REJECTED', 'MERGED') then status
              else v_candidate_status
            end,
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('ig_shortcode', v_shortcode, 'topic', v_topic)
        where id = v_candidate_id;
    end if;
    update public.instagram_post
      set candidate_id = v_candidate_id
      where shortcode = v_shortcode;
  end if;

  -- Matched songs go into the iruli Walkie section and public shop.
  if v_status = 'MATCHED_SONG' and v_song_id is not null then
    select p.id into v_iruli
    from public.profiles p
    where p.handle = 'iruli';
    if v_iruli is null then
      raise exception 'iruli profile is missing';
    end if;
    select s.id into v_shop_id from public.shop s where s.user_id = v_iruli;
    if v_shop_id is null then
      raise exception 'iruli shop is missing';
    end if;

    select id into v_section_id
    from public.walkie_section
    where user_id = v_iruli and name = '이루릴 아카이브'
    limit 1;
    if v_section_id is null then
      insert into public.walkie_section (user_id, name, sort_order)
      values (v_iruli, '이루릴 아카이브', 0)
      returning id into v_section_id;
    end if;

    if not exists (
      select 1 from public.walkie_item w
      where w.user_id = v_iruli and w.song_id = v_song_id
    ) then
      select coalesce(max(sort_order), -1) + 1 into v_order
      from public.walkie_item
      where user_id = v_iruli and section_id = v_section_id;
      insert into public.walkie_item (user_id, song_id, section_id, sort_order)
      values (v_iruli, v_song_id, v_section_id, v_order);
    else
      update public.walkie_item
        set section_id = v_section_id
        where user_id = v_iruli and song_id = v_song_id and section_id is distinct from v_section_id;
    end if;

    v_comment := left(coalesce(v_topic, ''), 280);
    if v_comment = '' then
      v_comment := null;
    end if;

    if not exists (
      select 1 from public.shop_item si
      where si.shop_id = v_shop_id and si.song_id = v_song_id
    ) then
      insert into public.shop_item (shop_id, song_id, shelf, note, sort_order)
      values (v_shop_id, v_song_id, 'COLLECTION', v_comment, 0);
    else
      update public.shop_item
        set note = v_comment
        where shop_id = v_shop_id and song_id = v_song_id;
    end if;

    -- Keep the archive window in posted_at order (newest first).
    with ranked as (
      select si.id,
        row_number() over (
          order by coalesce((
            select max(p.posted_at)
            from public.instagram_post p
            where p.song_id = si.song_id
          ), si.created_at) desc
        ) - 1 as rn
      from public.shop_item si
      where si.shop_id = v_shop_id
    )
    update public.shop_item si
      set sort_order = ranked.rn
      from ranked
      where si.id = ranked.id;
  end if;

  return (
    select jsonb_build_object(
      'shortcode', shortcode,
      'match_status', match_status,
      'song_id', song_id,
      'artist_id', artist_id,
      'candidate_id', candidate_id
    )
    from public.instagram_post
    where shortcode = v_shortcode
  );
end;
$$;

revoke all on function public.sync_instagram_post(jsonb) from public;
grant execute on function public.sync_instagram_post(jsonb) to authenticated, service_role;
