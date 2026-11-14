import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { ShopCommentText } from "@/components/shop/ShopCommentText";

type ProfileRef = { handle: string; display_name: string };
type ShopRef = {
  id: string;
  name: string;
  user_id: string;
  visibility?: string;
  owner?: ProfileRef | ProfileRef[] | null;
  profiles?: ProfileRef | ProfileRef[] | null;
};
type Row = {
  id: string;
  note: string | null;
  shop: ShopRef | ShopRef[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function DisplayedShops({ songId }: { songId: string }) {
  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase
    .from("shop_item")
    .select(
      "id, note, shop:shop_id (id, name, user_id, visibility, owner:user_id (handle, display_name))",
    )
    .eq("song_id", songId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <section className="displayed-shops">
        <h2 className="catalog-section-title">이 곡을 진열한 숍</h2>
        <p className="admin-error">숍 목록을 불러오지 못했습니다.</p>
      </section>
    );
  }

  const rows = ((data ?? []) as Row[])
    .map((row) => {
      const shop = one(row.shop);
      const owner = one(shop?.owner) ?? one(shop?.profiles);
      return shop && owner ? { id: row.id, note: row.note, shop, owner } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <section className="displayed-shops">
      <h2 className="catalog-section-title">이 곡을 진열한 숍</h2>
      {rows.length === 0 ? (
        <p className="admin-sub">아직 이 곡을 진열한 숍이 없습니다.</p>
      ) : (
        <ul className="displayed-shops-list">
          {rows.map((row) => (
            <li key={row.id} className="displayed-shops-item">
              <a href={`/shop/${row.owner.handle}`}>
                <strong>{row.shop.name}</strong>
                <span className="admin-sub">@{row.owner.handle}</span>
              </a>
              {row.note ? <ShopCommentText comment={row.note} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
