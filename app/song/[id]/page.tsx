import { notFound } from "next/navigation";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { ErrorState } from "@/components/catalog/States";
import { AlbumCover } from "@/components/catalog/AlbumCover";
import { fetchAlbumCovers } from "@/lib/music/covers";
import { PlayButton } from "@/components/catalog/PlayButton";
import { SaveToWalkie } from "@/components/walkie/SaveToWalkie";
import { DisplayedShops } from "@/components/shop/DisplayedShops";
import {
  createPublicSupabaseClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/public";
import { formatDuration } from "@/lib/music/format";
import { youtubeSearchUrl } from "@/lib/music/youtube";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) return { title: "곡 — RECORDS" };
  const supabase = createPublicSupabaseClient();
  const { data } = await supabase.from("song").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ? `${data.title} — RECORDS` : "곡 — RECORDS" };
}

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { data: song, error } = await supabase
    .from("song")
    .select(
      "id, title, duration_ms, primary_artist_id, primary_album_id, artist:primary_artist_id (id, name), album:primary_album_id (id, title)",
    )
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
  if (!song) notFound();

  const artistRaw = (song as { artist?: { id: string; name: string } | { id: string; name: string }[] | null }).artist;
  const albumRaw = (song as { album?: { id: string; title: string } | { id: string; title: string }[] | null }).album;
  const artist = Array.isArray(artistRaw) ? artistRaw[0] : artistRaw;
  const album = Array.isArray(albumRaw) ? albumRaw[0] : albumRaw;

  const { data: videos } = await supabase
    .from("song_external_video")
    .select("video_id, title, is_official, source_url")
    .eq("song_id", id)
    .eq("provider", "youtube")
    .eq("status", "ACTIVE")
    .order("is_official", { ascending: false });
  const video = videos?.[0] ?? null;
  const covers = await fetchAlbumCovers(supabase, [album?.id ?? song.primary_album_id]);
  const cover = covers.get(album?.id ?? song.primary_album_id ?? "");

  const { data: appearances } = await supabase
    .from("release_track")
    .select("track_number, release:release_id (id, title, country, album_id, album:album_id (id, title))")
    .eq("song_id", id);

  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <div className="entity-hero">
          <AlbumCover seed={album?.id ?? song.id} size="lg" src={cover?.src} srcLg={cover?.srcLg} alt={album ? `${album.title} cover` : ""} showAttribution />
          <div>
            <p className="kicker">Song</p>
            <h1 className="admin-title">{song.title}</h1>
            <p className="admin-lead">
              {artist ? <a href={`/artist/${artist.id}`}>{artist.name}</a> : "아티스트 미상"}
              {album ? (
                <>
                  {" · "}
                  <a href={`/album/${album.id}`}>{album.title}</a>
                </>
              ) : null}
              {song.duration_ms ? ` · ${formatDuration(song.duration_ms)}` : ""}
            </p>
            <div className="hero-actions" style={{ justifyContent: "flex-start", marginBottom: 0 }}>
              <PlayButton
                track={{
                  songId: song.id,
                  title: song.title,
                  artistName: artist?.name ?? "",
                  videoId: video?.video_id ?? null,
                  coverUrl: cover?.src ?? null,
                }}
              />
              <SaveToWalkie songId={song.id} />
              {!video ? (
                <a
                  className="btn btn-ghost"
                  href={youtubeSearchUrl(artist?.name ?? "", song.title)}
                  target="_blank"
                  rel="noreferrer"
                >
                  YouTube에서 찾기
                </a>
              ) : null}
            </div>
            {video ? (
              <p className="admin-sub" style={{ marginTop: 12 }}>
                MusicBrainz URL 관계에서 연결된 YouTube 영상
                {video.is_official ? " (공식 관계)" : ""}
              </p>
            ) : (
              <p className="admin-sub" style={{ marginTop: 12 }}>
                MusicBrainz에 연결된 YouTube 영상이 없어 검색 링크로 안내합니다. 자동 크롤링은 하지 않습니다.
              </p>
            )}
          </div>
        </div>

        {appearances && appearances.length > 1 ? (
          <section>
            <h2 className="catalog-section-title">수록 앨범</h2>
            <ul className="track-list">
              {appearances.map((row, index) => {
                const release = Array.isArray(row.release) ? row.release[0] : row.release;
                const albumField = release && typeof release === "object" ? (release as { album?: unknown }).album : null;
                const relAlbum = Array.isArray(albumField) ? albumField[0] : albumField;
                if (!relAlbum || typeof relAlbum !== "object" || !("id" in relAlbum)) return null;
                const typed = relAlbum as { id: string; title: string };
                return (
                  <li key={`${typed.id}-${index}`}>
                    <a className="track-row" href={`/album/${typed.id}`}>
                      <span>{typed.title}</span>
                      <span className="track-dur">Track {row.track_number}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <DisplayedShops songId={song.id} />
      </main>
    </div>
  );
}
