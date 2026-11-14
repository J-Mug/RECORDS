-- RECORDS MVP1 core schema
-- Based on 03_DOMAIN_MODEL.md, 04_MUSIC_DATA_ARCHITECTURE.md, 05_ARTWORK_AND_RIGHTS.md
--
-- Guardrails:
--   D-010  Songs are stored once; Walkie/Shop items reference song ids.
--   D-011  album = release group; release = a specific edition.
--   D-004  Artwork lives in media_asset, not album.cover_url.
--   D-006  Do not auto-cache third-party artwork (cached defaults to false).
--   D-008  music_candidate never auto-publishes; humans approve.
--   D-012  Region is sido / sigungu only. No precise location.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.candidate_status as enum (
  'PENDING',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'MERGED'
);

create type public.music_record_status as enum (
  'DRAFT',
  'PUBLISHED',
  'BLOCKED',
  'REMOVED'
);

create type public.external_source_status as enum (
  'ACTIVE',
  'INACTIVE',
  'BLOCKED',
  'NEEDS_REVIEW'
);

create type public.media_asset_type as enum (
  'ALBUM_COVER',
  'ARTIST_IMAGE',
  'SONG_THUMBNAIL',
  'USER_UPLOAD',
  'SHOP_IMAGE'
);

create type public.media_source_type as enum (
  'COVER_ART_ARCHIVE',
  'APPLE',
  'SPOTIFY',
  'LICENSED',
  'USER_UPLOAD',
  'OFFICIAL',
  'PLACEHOLDER'
);

create type public.media_asset_status as enum (
  'ACTIVE',
  'BLOCKED',
  'REMOVED',
  'NEEDS_REVIEW'
);

create type public.rights_type as enum (
  'LICENSED',
  'QUOTATION_ONLY',
  'USER_PRIVATE',
  'UNAVAILABLE'
);

create type public.content_status as enum (
  'DRAFT',
  'PUBLISHED',
  'REPORTED',
  'UNDER_REVIEW',
  'ACTIVE',
  'BLOCKED',
  'REMOVED'
);

create type public.shop_visibility as enum (
  'PUBLIC',
  'FOLLOWERS',
  'PRIVATE'
);

create type public.entity_kind as enum (
  'ARTIST',
  'ALBUM',
  'RELEASE',
  'SONG',
  'SHOP',
  'PROFILE',
  'CANDIDATE'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users / profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  display_name text not null,
  bio text,
  -- Broad region only (광역시/도, 시/군/구). Never store precise coordinates or addresses.
  region_sido text,
  region_sigungu text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9._]{2,30}$'),
  constraint profiles_handle_unique unique (handle)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Canonical music metadata
-- ---------------------------------------------------------------------------

create table public.genre (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_ko text,
  description text,
  created_at timestamptz not null default now()
);

create table public.artist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_sort text,
  disambiguation text,
  status public.music_record_status not null default 'PUBLISHED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger artist_set_updated_at
  before update on public.artist
  for each row execute function public.set_updated_at();

-- album maps to a MusicBrainz release group
create table public.album (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  primary_artist_id uuid references public.artist (id) on delete set null,
  first_released_on date,
  status public.music_record_status not null default 'PUBLISHED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger album_set_updated_at
  before update on public.album
  for each row execute function public.set_updated_at();

-- release is a specific edition (CD, vinyl, Japan edition, remaster, …)
create table public.release (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.album (id) on delete cascade,
  title text,
  format text,
  country text,
  barcode text,
  catalog_number text,
  edition_label text,
  released_on date,
  status public.music_record_status not null default 'PUBLISHED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger release_set_updated_at
  before update on public.release
  for each row execute function public.set_updated_at();

-- song maps to a MusicBrainz recording
create table public.song (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  primary_artist_id uuid references public.artist (id) on delete set null,
  primary_album_id uuid references public.album (id) on delete set null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  isrc text,
  status public.music_record_status not null default 'PUBLISHED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger song_set_updated_at
  before update on public.song
  for each row execute function public.set_updated_at();

create table public.song_genre (
  song_id uuid not null references public.song (id) on delete cascade,
  genre_id uuid not null references public.genre (id) on delete cascade,
  primary key (song_id, genre_id)
);

create table public.release_track (
  release_id uuid not null references public.release (id) on delete cascade,
  song_id uuid not null references public.song (id) on delete cascade,
  disc_number integer not null default 1 check (disc_number >= 1),
  track_number integer not null check (track_number >= 1),
  duration_ms integer,
  primary key (release_id, disc_number, track_number)
);

create unique index release_track_song_unique
  on public.release_track (release_id, song_id);

-- Provider identifiers (MusicBrainz, YouTube, Spotify, Apple, …)
create table public.external_source (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id uuid not null,
  source text not null,
  external_id text not null,
  source_url text,
  retrieved_at timestamptz,
  provider_terms_url text,
  status public.external_source_status not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_source_unique unique (source, entity_type, external_id)
);

create trigger external_source_set_updated_at
  before update on public.external_source
  for each row execute function public.set_updated_at();

create index external_source_entity_idx
  on public.external_source (entity_type, entity_id);

-- Ingestion candidates. AI may propose; only humans set APPROVED / REJECTED / MERGED.
create table public.music_candidate (
  id uuid primary key default gen_random_uuid(),
  source text,
  source_url text,
  artist_name text,
  album_name text,
  song_name text,
  release_date date,
  youtube_video_id text,
  ai_confidence numeric(5, 4),
  ai_reason text,
  duplicate_of uuid references public.music_candidate (id) on delete set null,
  approved_artist_id uuid references public.artist (id) on delete set null,
  approved_album_id uuid references public.album (id) on delete set null,
  approved_song_id uuid references public.song (id) on delete set null,
  status public.candidate_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index music_candidate_status_idx on public.music_candidate (status);

create table public.song_external_video (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.song (id) on delete cascade,
  provider text not null default 'youtube',
  video_id text not null,
  channel_id text,
  title text,
  is_official boolean not null default false,
  source_url text,
  status public.external_source_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint song_external_video_unique unique (provider, video_id)
);

create index song_external_video_song_idx on public.song_external_video (song_id);

-- ---------------------------------------------------------------------------
-- Walkie (private warehouse) and Shop (public window)
-- ---------------------------------------------------------------------------

create table public.walkie_section (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger walkie_section_set_updated_at
  before update on public.walkie_section
  for each row execute function public.set_updated_at();

create index walkie_section_user_idx on public.walkie_section (user_id, sort_order);

create table public.walkie_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.song (id) on delete restrict,
  section_id uuid references public.walkie_section (id) on delete set null,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walkie_item_unique unique (user_id, song_id)
);

create trigger walkie_item_set_updated_at
  before update on public.walkie_item
  for each row execute function public.set_updated_at();

create index walkie_item_section_idx on public.walkie_item (section_id, sort_order);

create table public.shop (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null,
  introduction text,
  visibility public.shop_visibility not null default 'PUBLIC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger shop_set_updated_at
  before update on public.shop
  for each row execute function public.set_updated_at();

create table public.shop_item (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  song_id uuid not null references public.song (id) on delete restrict,
  -- TODAYS_PICK / FAVORITES / RECOMMEND / COLLECTION, or a custom shelf name
  shelf text not null default 'FAVORITES',
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_item_unique unique (shop_id, song_id)
);

create trigger shop_item_set_updated_at
  before update on public.shop_item
  for each row execute function public.set_updated_at();

create index shop_item_shop_idx on public.shop_item (shop_id, shelf, sort_order);

-- ---------------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------------

-- 0.5 to 5.0 inclusive, in 0.5 steps
create table public.rating (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type public.entity_kind not null,
  entity_id uuid not null,
  score numeric(2, 1) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rating_score_range check (score >= 0.5 and score <= 5.0),
  constraint rating_score_step check ((score * 2) = trunc(score * 2)),
  constraint rating_entity_kind check (entity_type in ('SONG', 'ALBUM', 'ARTIST')),
  constraint rating_unique unique (user_id, entity_type, entity_id)
);

create trigger rating_set_updated_at
  before update on public.rating
  for each row execute function public.set_updated_at();

create index rating_entity_idx on public.rating (entity_type, entity_id);

create table public.review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type public.entity_kind not null,
  entity_id uuid not null,
  body text not null,
  status public.content_status not null default 'PUBLISHED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_entity_kind check (entity_type in ('SONG', 'ALBUM', 'ARTIST')),
  constraint review_body_not_empty check (char_length(btrim(body)) > 0)
);

create trigger review_set_updated_at
  before update on public.review
  for each row execute function public.set_updated_at();

create index review_entity_idx on public.review (entity_type, entity_id, status);

create table public.follow (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follow_no_self check (follower_id <> following_id)
);

create index follow_following_idx on public.follow (following_id);

-- ---------------------------------------------------------------------------
-- Rights-aware media
-- ---------------------------------------------------------------------------

create table public.media_asset (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id uuid not null,
  asset_type public.media_asset_type not null,
  source_type public.media_source_type not null,
  source_url text,
  original_url text,
  rights_type public.rights_type,
  rights_owner text,
  license_type text,
  license_source text,
  attribution_required boolean not null default false,
  attribution_text text,
  -- Default false: do not automatically self-host third-party artwork (D-006).
  cached boolean not null default false,
  cache_expires_at timestamptz,
  status public.media_asset_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger media_asset_set_updated_at
  before update on public.media_asset
  for each row execute function public.set_updated_at();

create index media_asset_entity_idx
  on public.media_asset (entity_type, entity_id, asset_type);

-- ---------------------------------------------------------------------------
-- Signup hook: profile + empty shop
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'handle', 'user_' || substr(replace(new.id::text, '-', ''), 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', '새 사용자')
  );
  insert into public.shop (user_id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', '새 사용자') || '의 Shop'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Grants (RLS is the actual access control)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all routines in schema public to service_role;

grant select on
  public.genre,
  public.artist,
  public.album,
  public.release,
  public.song,
  public.song_genre,
  public.release_track,
  public.external_source,
  public.song_external_video,
  public.media_asset,
  public.profiles,
  public.shop,
  public.shop_item,
  public.rating,
  public.review,
  public.follow
to anon;

grant select, insert, update, delete on
  public.profiles,
  public.walkie_section,
  public.walkie_item,
  public.shop,
  public.shop_item,
  public.rating,
  public.review,
  public.follow
to authenticated;

grant select on
  public.genre,
  public.artist,
  public.album,
  public.release,
  public.song,
  public.song_genre,
  public.release_track,
  public.external_source,
  public.song_external_video,
  public.media_asset
to authenticated;

-- music_candidate: service_role / admin only (no grants to anon or authenticated)

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.genre enable row level security;
alter table public.artist enable row level security;
alter table public.album enable row level security;
alter table public.release enable row level security;
alter table public.song enable row level security;
alter table public.song_genre enable row level security;
alter table public.release_track enable row level security;
alter table public.external_source enable row level security;
alter table public.music_candidate enable row level security;
alter table public.song_external_video enable row level security;
alter table public.walkie_section enable row level security;
alter table public.walkie_item enable row level security;
alter table public.shop enable row level security;
alter table public.shop_item enable row level security;
alter table public.rating enable row level security;
alter table public.review enable row level security;
alter table public.follow enable row level security;
alter table public.media_asset enable row level security;

-- Catalog: published / active rows are readable. Writes go through the service role.
create policy genre_select on public.genre
  for select to anon, authenticated using (true);

create policy artist_select_published on public.artist
  for select to anon, authenticated using (status = 'PUBLISHED');

create policy album_select_published on public.album
  for select to anon, authenticated using (status = 'PUBLISHED');

create policy release_select_published on public.release
  for select to anon, authenticated
  using (status = 'PUBLISHED');

create policy song_select_published on public.song
  for select to anon, authenticated using (status = 'PUBLISHED');

create policy song_genre_select on public.song_genre
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.song s
      where s.id = song_id and s.status = 'PUBLISHED'
    )
  );

create policy release_track_select on public.release_track
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.release r
      where r.id = release_id and r.status = 'PUBLISHED'
    )
  );

create policy external_source_select_active on public.external_source
  for select to anon, authenticated using (status = 'ACTIVE');

create policy song_external_video_select_active on public.song_external_video
  for select to anon, authenticated using (status = 'ACTIVE');

create policy media_asset_select_active on public.media_asset
  for select to anon, authenticated using (status = 'ACTIVE');

-- music_candidate has RLS enabled and no policies for anon/authenticated.

-- Profiles
create policy profiles_select on public.profiles
  for select to anon, authenticated using (true);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Walkie is a private warehouse: owner only.
create policy walkie_section_owner on public.walkie_section
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy walkie_item_owner on public.walkie_item
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Shop is a public window, with optional follower / private visibility.
create policy shop_select_visible on public.shop
  for select to anon, authenticated
  using (
    visibility = 'PUBLIC'
    or auth.uid() = user_id
    or (
      visibility = 'FOLLOWERS'
      and exists (
        select 1 from public.follow f
        where f.following_id = user_id
          and f.follower_id = auth.uid()
      )
    )
  );

create policy shop_insert_own on public.shop
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy shop_update_own on public.shop
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy shop_delete_own on public.shop
  for delete to authenticated
  using (auth.uid() = user_id);

create policy shop_item_select_visible on public.shop_item
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.shop s
      where s.id = shop_id
        and (
          s.visibility = 'PUBLIC'
          or s.user_id = auth.uid()
          or (
            s.visibility = 'FOLLOWERS'
            and exists (
              select 1 from public.follow f
              where f.following_id = s.user_id
                and f.follower_id = auth.uid()
            )
          )
        )
    )
  );

create policy shop_item_insert_own on public.shop_item
  for insert to authenticated
  with check (
    exists (
      select 1 from public.shop s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

create policy shop_item_update_own on public.shop_item
  for update to authenticated
  using (
    exists (
      select 1 from public.shop s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shop s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

create policy shop_item_delete_own on public.shop_item
  for delete to authenticated
  using (
    exists (
      select 1 from public.shop s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

-- Ratings: readable, owner-written
create policy rating_select on public.rating
  for select to anon, authenticated using (true);

create policy rating_insert_own on public.rating
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy rating_update_own on public.rating
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy rating_delete_own on public.rating
  for delete to authenticated
  using (auth.uid() = user_id);

-- Reviews: published (and non-removed) are public; owners manage their own
create policy review_select_published_or_own on public.review
  for select to anon, authenticated
  using (
    status in ('PUBLISHED', 'ACTIVE')
    or auth.uid() = user_id
  );

create policy review_insert_own on public.review
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy review_update_own on public.review
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy review_delete_own on public.review
  for delete to authenticated
  using (auth.uid() = user_id);

-- Follows
create policy follow_select on public.follow
  for select to anon, authenticated using (true);

create policy follow_insert_own on public.follow
  for insert to authenticated
  with check (auth.uid() = follower_id);

create policy follow_delete_own on public.follow
  for delete to authenticated
  using (auth.uid() = follower_id);
