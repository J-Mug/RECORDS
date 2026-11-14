import { notFound } from "next/navigation";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { EmptyState, ErrorState } from "@/components/catalog/States";
import { AlbumCover } from "@/components/catalog/AlbumCover";
import { fetchAlbumCovers } from "@/lib/music/covers";
import { PlayButton } from "@/components/catalog/PlayButton";
import { SaveToWalkie } from "@/components/walkie/SaveToWalkie";
import {
  createPublicSupabaseClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/public";
import { formatDate, formatDuration } from "@/lib/music/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) return { title: "앨범 — RECORDS" };
  const supabase = createPublicSupabaseClient();
  const { data } = await supabase.from("album").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ? `${data.title} — RECORDS` : "앨범 — RECORDS" };
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) {
    return (
      <div className="catalog-shell">
        <CatalogNav />
        <main className="catalog-main">
          <ErrorState message="Supabase 환경변수가 설정되지 않았습니다." />
        </main>
      </div>
    );
  }
  const supabase = createPublicSupabaseClient();
  const { data: album, error } = await supabase
    .from("album")
    .select("id, title, first_released_on, primary_artist_id, artist:primary_artist_id (id, name)")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return (
      <div className="catalog-shell">
        <CatalogNav />
        <main className="catalog-main">
          <ErrorState message={error.message} />
        </main>
      </div>
    );
  }
  if (!album) notFound();

  const artist = (album as { artist?: { id: string; name: string } | { id: string; name: string }[] | null }).artist;
  const artistRow = Array.isArray(artist) ? artist[0] : artist;

  const { data: releases } = await supabase
    .from("release")
    .select("id, title, country, released_on")
    .eq("album_id", id)
    .eq("status", "PUBLISHED")
    .order("released_on", { ascending: true });

  const releaseIds = (releases ?? []).map((r) => r.id);
  const { data: tracks } = releaseIds.length
    ? await supabase
        .from("release_track")
        .select("release_id, track_number, duration_ms, song:song_id (id, title, duration_ms)")
        .in("release_id", releaseIds)
        .order("track_number")
    : { data: [] };

  type Track = {
    release_id: string;
    track_number: number;
    duration_ms: number | null;
    song: { id: string; title: string; duration_ms: number | null } | { id: string; title: string; duration_ms: number | null }[] | null;
  };
  const firstReleaseId = releaseIds[0];
  const firstTracks = ((tracks ?? []) as Track[]).filter((t) => t.release_id === firstReleaseId);

  const songIds = firstTracks
    .map((t) => (Array.isArray(t.song) ? t.song[0]?.id : t.song?.id))
    .filter(Boolean) as string[];
  const { data: videos } = songIds.length
    ? await supabase
        .from("song_external_video")
        .select("song_id, video_id")
        .eq("provider", "youtube")
        .eq("status", "ACTIVE")
        .in("song_id", songIds)
    : { data: [] };
  const videoBySong = new Map((videos ?? []).map((v) => [v.song_id, v.video_id]));
  const covers = await fetchAlbumCovers(supabase, [album.id]);
  const cover = covers.get(album.id);

  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <div className="entity-hero">
          <AlbumCover seed={album.id} size="lg" src={cover?.src} srcLg={cover?.srcLg} alt={`${album.title} cover`} showAttribution />
          <div>
            <p className="kicker">Album</p>
            <h1 className="admin-title">{album.title}</h1>
            <p className="admin-lead">
              {artistRow ? (
                <a href={`/artist/${artistRow.id}`}>{artistRow.name}</a>
              ) : (
                "아티스트 미상"
              )}
              {album.first_released_on ? ` · ${formatDate(album.first_released_on)}` : ""}
            </p>
          </div>
        </div>

        <section>
          <h2 className="catalog-section-title">수록곡</h2>
          {firstTracks.length ? (
            <ul className="track-list">
              {firstTracks.map((track) => {
                const song = Array.isArray(track.song) ? track.song[0] : track.song;
                if (!song) return null;
                return (
                  <li key={song.id} className="track-row-wrap">
                    <a className="track-row" href={`/song/${song.id}`}>
                      <span className="track-no">{track.track_number}</span>
                      <span>{song.title}</span>
                      <span className="track-dur">
                        {formatDuration(track.duration_ms ?? song.duration_ms)}
                      </span>
                    </a>
                    <PlayButton
                      track={{
                        songId: song.id,
                        title: song.title,
                        artistName: artistRow?.name ?? "",
                        videoId: videoBySong.get(song.id) ?? null,
                        coverUrl: cover?.src ?? null,
                      }}
                    />
                    <SaveToWalkie songId={song.id} compact />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="수록곡 정보가 아직 없습니다." />
          )}
        </section>
      </main>
    </div>
  );
}
