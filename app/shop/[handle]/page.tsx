import { CatalogNav } from "@/components/catalog/CatalogNav";
import { ShopBoard } from "@/components/shop/ShopBoard";
import { loadShopPage, type ShopPageData } from "@/lib/shop/load";
import { createPublicSupabaseClient, getSupabasePublicConfig } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

function unavailable(handle: string): ShopPageData {
  return {
    handle,
    notFound: false,
    error: "Supabase 환경변수가 설정되지 않았습니다.",
    shop: null,
    owner: null,
    items: [],
    videos: {},
    covers: {},
    igPosts: [],
  };
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) return { title: "숍 — RECORDS" };
  const data = await loadShopPage(createPublicSupabaseClient(), handle);
  if (data.notFound || !data.shop) return { title: "숍 — RECORDS" };
  return { title: `${data.shop.name} — RECORDS` };
}

export default async function ShopPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const config = getSupabasePublicConfig();
  const initial = config.ready ? await loadShopPage(createPublicSupabaseClient(), handle) : unavailable(handle);
  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <p className="kicker">Public window</p>
        <ShopBoard handle={handle} initial={initial} />
      </main>
    </div>
  );
}
