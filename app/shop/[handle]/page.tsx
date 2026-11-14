import { CatalogNav } from "@/components/catalog/CatalogNav";
import { ShopBoard } from "@/components/shop/ShopBoard";
import { createPublicSupabaseClient, getSupabasePublicConfig } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const config = getSupabasePublicConfig();
  if (!config.ready) return { title: "숍 — RECORDS" };
  const supabase = createPublicSupabaseClient();
  const { data: profile } = await supabase.from("profiles").select("id, display_name").eq("handle", handle).maybeSingle();
  if (!profile) return { title: "숍 — RECORDS" };
  const { data: shop } = await supabase.from("shop").select("name").eq("user_id", profile.id).maybeSingle();
  return { title: `${shop?.name ?? profile.display_name} — RECORDS` };
}

export default async function ShopPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <p className="kicker">Public window</p>
        <ShopBoard handle={handle} />
      </main>
    </div>
  );
}
