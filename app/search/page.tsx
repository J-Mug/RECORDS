import { Suspense } from "react";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { EmptyState, ErrorState, LoadingState } from "@/components/catalog/States";
import { PlaceholderCover } from "@/components/catalog/PlaceholderCover";
import { SaveToWalkie } from "@/components/walkie/SaveToWalkie";
import {
  createPublicSupabaseClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "검색 — RECORDS" };

type Hit = {
  entity_kind: "ARTIST" | "ALBUM" | "SONG";
  entity_id: string;
  title: string;
  subtitle: string | null;
  score: number;
};

function hrefFor(hit: Hit) {
  if (hit.entity_kind === "ARTIST") return `/artist/${hit.entity_id}`;
  if (hit.entity_kind === "ALBUM") return `/album/${hit.entity_id}`;
  return `/song/${hit.entity_id}`;
}

async function SearchResults({ q }: { q: string }) {
  const config = getSupabasePublicConfig();
  if (!config.ready) {
    return <ErrorState message="Supabase 환경변수가 설정되지 않았습니다." />;
  }
  if (!q) {
    return (
      <EmptyState
        title="검색어를 입력하세요."
        body="아티스트, 앨범, 곡 제목, 로마자 표기를 모두 찾을 수 있습니다."
      />
    );
  }
  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.rpc("search_music", { p_q: q, p_limit: 40 });
    if (error) return <ErrorState message={error.message} />;
    const hits = (data ?? []) as Hit[];
    if (!hits.length) {
      return (
        <EmptyState
          title="일치하는 결과가 없습니다."
          body={`“${q}”와 비슷한 제목이나 로마자 표기를 다시 검색해 보세요.`}
        />
      );
    }
    const groups: Record<string, Hit[]> = { ARTIST: [], ALBUM: [], SONG: [] };
    for (const hit of hits) groups[hit.entity_kind]?.push(hit);
    const labels = { ARTIST: "아티스트", ALBUM: "앨범", SONG: "곡" } as const;
    return (
      <div className="search-groups">
        {(Object.keys(labels) as Array<keyof typeof labels>).map((kind) =>
          groups[kind].length ? (
            <section key={kind}>
              <h2 className="catalog-section-title">{labels[kind]}</h2>
              <ul className="search-list">
                {groups[kind].map((hit) => (
                  <li key={`${hit.entity_kind}-${hit.entity_id}`} className="search-hit">
                    <a className="search-row" href={hrefFor(hit)}>
                      <PlaceholderCover seed={hit.entity_id} size="sm" />
                      <span>
                        <strong>{hit.title}</strong>
                        {hit.subtitle ? <span className="admin-sub">{hit.subtitle}</span> : null}
                      </span>
                      <span className="kind-pill">{hit.entity_kind}</span>
                    </a>
                    {hit.entity_kind === "SONG" ? <SaveToWalkie songId={hit.entity_id} compact /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </div>
    );
  } catch (err) {
    return <ErrorState message={(err as Error).message} />;
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  return (
    <div className="catalog-shell">
      <CatalogNav initialQuery={q} />
      <main className="catalog-main">
        <p className="kicker">Search</p>
        <h1 className="admin-title">{q ? `“${q}” 검색 결과` : "음악을 찾아보세요."}</h1>
        <Suspense fallback={<LoadingState />}>
          <SearchResults q={q} />
        </Suspense>
      </main>
    </div>
  );
}
