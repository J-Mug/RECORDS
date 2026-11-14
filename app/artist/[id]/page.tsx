import { notFound } from "next/navigation";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { EmptyState, ErrorState } from "@/components/catalog/States";
import { PlaceholderCover } from "@/components/catalog/PlaceholderCover";
import {
  createPublicSupabaseClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/public";
import { formatDate } from "@/lib/music/format";

export const dynamic = "force-dynamic";

type Artist = {
  id: string;
  name: string;
  name_sort: string | null;
  disambiguation: string | null;
};
type Album = { id: string; title: string; first_released_on: string | null };
type Song = { id: string; title: string; primary_album_id: string | null };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) return { title: "아티스트 — RECORDS" };
  const supabase = createPublicSupabaseClient();
  const { data } = await supabase.from("artist").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — RECORDS` : "아티스트 — RECORDS" };
}

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { data: artist, error } = await supabase
    .from("artist")
    .select("id, name, name_sort, disambiguation")
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
  if (!artist) notFound();
  const row = artist as Artist;

  const [{ data: albums }, { data: songs }] = await Promise.all([
    supabase
      .from("album")
      .select("id, title, first_released_on")
      .eq("primary_artist_id", id)
      .eq("status", "PUBLISHED")
      .order("first_released_on", { ascending: true }),
    supabase
      .from("song")
      .select("id, title, primary_album_id")
      .eq("primary_artist_id", id)
      .eq("status", "PUBLISHED")
      .order("title")
      .limit(40),
  ]);

  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <div className="entity-hero">
          <PlaceholderCover seed={row.id} size="lg" />
          <div>
            <p className="kicker">Artist</p>
            <h1 className="admin-title">{row.name}</h1>
            <p className="admin-lead">
              {[row.name_sort, row.disambiguation].filter(Boolean).join(" · ") || "J-POP artist"}
            </p>
          </div>
        </div>

        <section>
          <h2 className="catalog-section-title">앨범</h2>
          {albums?.length ? (
            <ul className="card-grid">
              {(albums as Album[]).map((album) => (
                <li key={album.id}>
                  <a className="catalog-card" href={`/album/${album.id}`}>
                    <PlaceholderCover seed={album.id} />
                    <strong>{album.title}</strong>
                    <span className="admin-sub">{formatDate(album.first_released_on)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="연결된 앨범이 아직 없습니다." />
          )}
        </section>

        <section>
          <h2 className="catalog-section-title">곡</h2>
          {songs?.length ? (
            <ul className="track-list">
              {(songs as Song[]).map((song, index) => (
                <li key={song.id}>
                  <a className="track-row" href={`/song/${song.id}`}>
                    <span className="track-no">{index + 1}</span>
                    <span>{song.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="연결된 곡이 아직 없습니다." />
          )}
        </section>
      </main>
    </div>
  );
}
